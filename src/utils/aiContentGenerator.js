import OpenAI from 'openai';
import * as fal from '@fal-ai/serverless-client';

const openai = new OpenAI({
	apiKey: process.env.OPEN_AI_KEY,
});

fal.config({
	credentials: process.env.FAL_KEY,
});

async function generateImageWithFal(prompt) {
	try {
		const result = await fal.subscribe('fal-ai/flux/schnell', {
			input: {
				prompt: prompt,
				image_size: 'landscape_16_9',
				num_inference_steps: 4,
				num_images: 1,
			},
		});

		console.log('Image result', result);

		return result.images[0].url;
	} catch (error) {
		console.error('Fal.ai error:', error);
		return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=600`;
	}
}

export async function generateAIContent(prompt, variables, blockCategory, country, language) {
	const variablesDescription = variables
		.map((v) => `- ${v.name} (type: ${v.type}, required: ${v.required})`)
		.join('\n');
	const systemPrompt = `
You are a content AND visual style generator for website blocks.

STRICT LOCALIZATION RULES:
- Language: ${language} (Generate ALL text content in this language)
- Country: ${country} (Adapt terminology, currency, and cultural context for this country)

Your task:
- Generate content variables for the block
- Generate SEO Meta-tags (title, description, keywords) tailored to the ${country}
- ALSO generate CSS design tokens based on the user's prompt

Block type: ${blockCategory}

=====================
CONTENT VARIABLES
=====================
Variables to fill:
${variablesDescription}

Follow these rules for content variables:
1. For "text" type:
   {"variableName": {"value": "text"}}

2. For "image" type:
   {"variableName": {"value": null, "src": "descriptive image name", "alt": "alt text"}}

3. For "link" type:
   {"variableName": {"value": null, "href": "url or #anchor", "label": "link text"}}

=====================
SEO & LOCALIZATION
=====================
You MUST generate a "meta" object. 
- Use local SEO practices for ${country}.
- Include relevant keywords that people in ${country} would use for this industry.
- Format any prices/currencies according to ${country} standards (e.g., $100 for USA, 100 € for Germany, etc.).

=====================
DESIGN VARIABLES (CSS)
=====================
You MUST also generate a "theme" object that overrides CSS variables.

Allowed CSS variables to override:
- --color-primary
- --color-secondary
- --color-accent
- --color-background
- --color-surface
- --color-text
- --font-sans
- --radius-md
- --shadow-md

CRITICAL READABILITY RULES — MUST BE FOLLOWED EVERY TIME:

1. --color-text MUST have very strong contrast against BOTH:
   - --color-background (main page background)
   - --color-surface     (cards, sections, modals, etc.)

   Recommended:
   - Dark theme / dark backgrounds → --color-text: #f0f0f0 – #ffffff (or #e2e8f0, #ddd)
   - Light theme / light backgrounds → --color-text: #111111 – #333333 (or #1a1a1a, #222)

2. --color-surface rules:
   - In dark theme: should be darker or slightly lighter than --color-background, but still dark (#1a1a1a – #2d2d2d – #333333)
   - In light theme: should be lighter or slightly darker than --color-background, but still light (#f8f9fa – #ffffff – #f0f0f0)
   - NEVER use --color-surface that makes text unreadable when overlaid with --color-text

3. Forbidden combinations:
   - light text (#aaa–#fff) on light background/surface (#ddd–#fff)
   - dark text (#000–#666) on dark background/surface (#111–#444)
   - low contrast (WCAG AA < 4.5:1 or AAA < 7:1 strongly preferred)

4. Typical safe combinations (examples):
   Dark mode:
   --color-background: "#0f0f0f" / "#111111" / "#121212"
   --color-surface:    "#1a1a1a" / "#1e293b" / "#2d2d2d" / "#172554"
   --color-text:       "#f0f0f0" / "#e2e8f0" / "#e5e5e5" / "#ffffff"

   Light mode:
   --color-background: "#ffffff" / "#f8f9fa" / "#fafafa"
   --color-surface:    "#ffffff" / "#f0f0f0" / "#fefefe" / "#f9f9f9"
   --color-text:       "#111111" / "#1a1a1a" / "#222222" / "#0f0f0f"

5. If user asks for dark theme / dark mode / тёмна тема → dark --color-background + darker/lighter --color-surface + light --color-text
   If user asks for light theme / світла тема → light --color-background + light --color-surface + dark --color-text

6. --color-primary, --color-secondary, --color-accent — use for buttons, links, highlights. They should have good contrast with --color-text and --color-surface when used as backgrounds.

7. Do NOT invent new CSS variables. Do NOT remove variables.

Rules for design variables:
- Colors must be valid HEX values
- Font must be a realistic web-safe or Google Font family
- Design must match the user's intent, mood, and industry
- Do NOT invent new CSS variables
- Do NOT remove variables

RESPONSE FORMAT:

Return ONLY valid JSON.
CRITICAL: Do NOT include any comments (like // or /* */) inside the JSON code.
All text values must be in ${language}.

1. All content variables MUST be returned at the ROOT level
2. Design tokens MUST be returned inside a "theme" object

Example:

{
  "meta": {
    "title": "SEO title for ${country}",
    "description": "SEO description",
    "keywords": "keyword1, keyword2, local-keyword",
    "og_locale": "appropriate locale code for ${country}"
  },
  "title": { "value": "..." },
  "subtitle": { "value": "..." },
  "ctaButton": { "label": "...", "href": "#", "value": null },

  "theme": {
    "--color-primary": "#xxxxxx",
    "--color-accent": "#xxxxxx"
  }
}

=====================
DESIGN GUIDELINES
=====================
Examples:
- SaaS / Startup → blue, purple, clean, modern
- Coffee shop → warm browns, beige, cozy
- Luxury brand → dark backgrounds, gold accents
- Kids / playful → bright colors, rounded corners

Keep content concise and professional.
`;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: prompt || 'Create professional website content' },
		],
		temperature: 0.7,
	});
	const content = completion.choices[0].message.content;
	const jsonMatch = content.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error('AI did not return valid JSON');
	}

	const result = JSON.parse(jsonMatch[0]);

	for (const varName of Object.keys(result)) {
		const variable = variables.find((v) => v.name === varName);
		if (variable?.type === 'image') {
			const description = result[varName].src || `${blockCategory} ${varName}`;
			console.log(`Generating image for ${varName}: ${description}`);
			result[varName].src = await generateImageWithFal(description);
		}
	}

	return [
		result,
		{
			promptTokens: completion.usage.prompt_tokens,
			completionTokens: completion.usage.completion_tokens,
			totalTokens: completion.usage.total_tokens,
		},
	];
}
