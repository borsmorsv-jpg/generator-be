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

export async function generateAIContent(prompt, variables, blockCategory) {
	const variablesDescription = variables
		.map((v) => `- ${v.name} (type: ${v.type}, required: ${v.required})`)
		.join('\n');
	const systemPrompt = `
You are a content AND visual style generator for website blocks.

Your task:
- Generate content variables for the block
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

1. All content variables MUST be returned at the ROOT level
2. Design tokens MUST be returned inside a "theme" object

Example:

{
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
