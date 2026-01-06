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

	const systemPrompt = `You are a content generator for website blocks. Generate realistic, professional content based on the user's request.

Block type: ${blockCategory}
Variables to fill:
${variablesDescription}

Return ONLY a valid JSON object. Follow these rules for each variable type:

1. For "text" type:
   {"variableName": {"value": "your text content here"}}

2. For "image" type:
   {"variableName": {"value": null, "src": "descriptive image name", "alt": "alternative text"}}

3. For "link" type:
   {"variableName": {"value": null, "href": "url or #anchor", "label": "link text"}}

Example response:
{
  "title": {"value": "Transform Your Business Today"},
  "logo": {"value": null, "src": "modern tech company logo", "alt": "Company Logo"},
  "navItem1": {"value": null, "href": "#about", "label": "About Us"},
  "navItem2": {"value": null, "href": "#services", "label": "Services"},
  "heroText": {"value": "We help businesses grow with innovative solutions"}
}

Important: 
- Generate content appropriate for ${blockCategory} blocks
- Make links meaningful and contextual
- Keep text concise and professional`;

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

	return result;
}
