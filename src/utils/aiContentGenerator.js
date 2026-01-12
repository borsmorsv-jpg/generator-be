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
CONTRAST & READABILITY RULES (CRITICAL)
=====================
You MUST ensure high contrast between text and background:
1. If the user wants a DARK THEME:
   - --color-background MUST be dark (e.g., #000000, #1A1A1A)
   - --color-text MUST be very light (e.g., #FFFFFF, #F5F5F5)
   - --color-primary/--color-accent must be vibrant but readable on dark.
2. If the user wants a LIGHT THEME:
   - --color-background MUST be light (e.g., #FFFFFF, #F8F9FA)
   - --color-text MUST be dark (e.g., #1A1A1A, #333333)
3. Ensure WCAG AAA compliance: the contrast ratio should be high enough for perfect readability.

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
- --color-text
- --font-sans
- --radius-md
- --shadow-md

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
