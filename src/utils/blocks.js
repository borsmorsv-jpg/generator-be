import { db } from '../db/connection.js';
import { blocks } from '../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { downloadAndUnzipBlock } from './zipHandler.js';
import OpenAI from 'openai';
import * as fal from '@fal-ai/serverless-client';
import * as sass from 'sass';
import nunjucks from 'nunjucks';
import fs from 'fs/promises';
import path from 'path';
import { PRICE_FOR_PROMPTS_FALAI } from '../config/constants.js';

const openai = new OpenAI({
	apiKey: process.env.OPEN_AI_KEY,
});

fal.config({
	credentials: process.env.FAL_KEY,
});

const generateImageWithFal = async (prompt) => {
	try {
		const result = await fal.subscribe('fal-ai/flux/schnell', {
			input: {
				prompt: prompt,
				image_size: 'landscape_16_9',
				num_inference_steps: 4,
				num_images: 1,
			},
		});
		const image = result.images[0];
		const megapixels = (image.width * image.height) / 1000000;
		const cost = megapixels * PRICE_FOR_PROMPTS_FALAI.perMegaPixel;

		return { url: image.url, cost: cost };
	} catch (error) {
		return {
			url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=600`,
			cost: 0,
		};
	}
};

const processImages = async (content, variables) => {
	let totalFalCost = 0;
	for (const [key, value] of Object.entries(content)) {
		const varDef = variables[key];

		if (varDef?.type === 'image' && value?.href && !value.href.startsWith('http')) {
			const { url, cost } = await generateImageWithFal(value.href);
			content[key].href = url;
			totalFalCost += cost;
		}

		if (varDef?.type === 'array' && Array.isArray(value?.values)) {
			for (const item of value.values) {
				for (const [itemKey, itemValue] of Object.entries(item)) {
					if (itemValue?.href && !itemValue.href.startsWith('http')) {
						const { url, cost } = await generateImageWithFal(itemValue.href);
						item[itemKey].href = url;
						totalFalCost += cost;
					}
				}
			}
		}
	}
	return { content, totalFalCost };
};

// ==================== БАЗОВЫЕ ОПЕРАЦИИ ====================

export const getBlockByType = async (type) => {
	const [block] = await db
		.select()
		.from(blocks)
		.where(and(eq(blocks.category, type), eq(blocks.isActive, true)))
		.orderBy(sql`RANDOM()`)
		.limit(1);

	if (!block) {
		throw new Error(`No active block found for type: ${type}`);
	}

	const unzippedBlock = await downloadAndUnzipBlock(block.archiveUrl);

	return {
		category: block.category,
		id: block.id,
		...unzippedBlock,
	};
};

export const generateBlockContent = async (
	variables,
	blockCategory,
	prompt,
	country,
	language,
	templatePages = null,
) => {
	const filteredVariables = Object.entries(variables).filter(([name, v]) => v.type !== 'nav');

	const variablesDescription = filteredVariables
		.map(([name, v]) => `- ${name} (type: ${v.type})`)
		.join('\n');

	const navInstruction = templatePages
		? `
=====================
NAVIGATION LABELS
=====================
Generate translated navigation labels for these pages:
${templatePages.map((p) => `- "${p.title}" (path: ${p.path})`).join('\n')}

Add to your response:
"navigationLabels": ["Translated Label 1", "Translated Label 2", ...]

Labels must be in ${language}, short (1-3 words), natural for website navigation.
`
		: '';

	const systemPrompt = `You are a CONTENT generator for website blocks.

STRICT LOCALIZATION & CONTEXT RULES:
- Language: ${language}
- Country: ${country}

Your task:
- Generate content variables for the block type: ${blockCategory}
- DO NOT generate navigation structure — it will be provided separately
- DO NOT generate any CSS, styles, or design tokens
- Generate NATURAL, human-readable text

${navInstruction}
=====================
CONTENT VARIABLES RULES
=====================
GENERAL RULES:
1. TEXT VARIABLES: {"variableName": {"value": "text content"}}
2. IMAGE VARIABLES: {"variableName": {"href": "detailed image description for AI image generation", "alt": "alt text"}}
3. LINK VARIABLES: {"variableName": {"value": null, "href": "url", "label": "text"}}
4. ARRAY VARIABLES: 
   For array variables, fill the "values" array with complete objects.
   Each object in the array should contain all its nested fields.

ARRAY VARIABLES RULES (apply to ALL arrays):
- Fill the "values" array with complete objects
- Each object in the array should contain ALL its nested fields
- For nested fields, follow the same rules:
  * Text fields: {"fieldName": {"value": "text"}}
  * Image fields: {"fieldName": {"href": "image description", "alt": "alt text"}}
  * Link fields: {"fieldName": {"value": null, "href": "url", "label": "text"}}
  * Array fields: Apply these same rules recursively

VARIABLES TO FILL:
${variablesDescription}

=====================
OUTPUT FORMAT
=====================
Return a FLAT JSON object where each key is the variable name.

EXAMPLES:

Example 1: Array named "cards":
{
  "cards": {
    "type": "array",
    "values": [
      {
        "image": {"href": "modern office design with plants", "alt": "Office design"},
        "title": {"value": "Office Design"},
        "description": {"value": "Ergonomic workspace solutions"},
        "link": {"value": null, "href": "#", "label": "Learn More"}
      },
      {
        "image": {"href": "team collaboration meeting", "alt": "Team meeting"},
        "title": {"value": "Team Collaboration"},
        "description": {"value": "Spaces for effective teamwork"},
        "link": {"value": null, "href": "#", "label": "Learn More"}
      }
    ]
  }
}

Example 2: Array named "products":
{
  "products": {
    "type": "array",
    "values": [
      {
        "productImage": {"href": "modern laptop on desk", "alt": "Laptop product"},
        "productName": {"value": "Pro Laptop"},
        "price": {"value": "$999"},
        "features": {
          "type": "array",
          "values": [
            {"feature": {"value": "16GB RAM"}},
            {"feature": {"value": "512GB SSD"}},
            {"feature": {"value": "14-inch Display"}}
          ]
        }
      }
    ]
  }
}

Example 3: Array named "testimonials":
{
  "testimonials": {
    "type": "array",
    "values": [
      {
        "avatar": {"href": "smiling business person", "alt": "Customer avatar"},
        "name": {"value": "John Smith"},
        "position": {"value": "CEO at Company"},
        "quote": {"value": "Excellent service!"}
      }
    ]
  }
}${
		templatePages
			? `,
  "navigationLabels": ["Label 1", "Label 2"]`
			: ''
	}

IMPORTANT: Apply array rules to ANY array variable regardless of its name.
For array items, include ALL required fields from the definition.
Do NOT use "type" field inside array items unless specified in definition.

Return ONLY valid JSON. All text in ${language}.
`;

	const completion = await openai.chat.completions.create({
		model: 'gpt-5-mini',
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: prompt || 'Create professional website content' },
		],
		temperature: 1,
	});

	const content = completion.choices[0].message.content;
	const jsonMatch = content.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error('AI did not return valid JSON');
	}

	let result = JSON.parse(jsonMatch[0]);
	const { totalFalCost, content: updatedContent } = await processImages(result, variables);
	result = updatedContent;

	return [
		result,
		{
			promptTokens: completion.usage.prompt_tokens,
			completionTokens: completion.usage.completion_tokens,
			totalTokens: completion.usage.total_tokens,
			totalFalCost: totalFalCost,
		},
	];
};

export const prepareBlock = async (block, prompt, country, language, navigation = null) => {
	try {
		if (block.hasError) {
			throw new Error(block.error);
		}
		const [aiContent, tokens] = await generateBlockContent(
			block.definition.variables,
			block.category,
			prompt,
			country,
			language,
		);

		console.log('aiContent', aiContent);

		const variables = navigation ? { ...aiContent, navigation } : aiContent;

		return { ...block, variables, tokens };
	} catch (error) {
		return {
			...block,
			hasError: true,
			error: error?.message,
		};
	}
};

export const getBlocks = async (blocksList = []) => {
	const results = await Promise.allSettled(
		blocksList.map(async (blockDef) => {
			const baseBlock = {
				type: blockDef.type,
				category: blockDef.type,
			};
			try {
				const block = await getBlockByType(blockDef.type);
				return {
					...block,
					...baseBlock,
				};
			} catch (error) {
				return {
					...baseBlock,
					hasError: true,
					error: error?.message,
				};
			}
		}),
	);

	return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
};

export const prepareGlobalBlocks = async (
	globalBlocks,
	templatePages,
	prompt,
	country,
	language,
) => {
	let navigationLabels = null;

	const results = await Promise.allSettled(
		globalBlocks.map(async (block) => {
			try {
				if (block.hasError) {
					throw new Error(block.error);
				}

				const needsNavLabels = !navigationLabels && block.definition.variables.navigation;

				const [aiContent, tokens] = await generateBlockContent(
					block.definition.variables,
					block.category,
					prompt,
					country,
					language,
					needsNavLabels ? templatePages : null,
				);

				if (aiContent.navigationLabels) {
					navigationLabels = aiContent.navigationLabels;
					delete aiContent.navigationLabels;
				}

				const navigation = {
					type: 'nav',
					value: templatePages.map((page, index) => ({
						href: page.path === '/' ? './index.html' : `.${page.path}.html`,
						label: navigationLabels?.[index] || page.title,
						active: false,
					})),
				};

				const variables = { ...aiContent, navigation };
				console.log('aiContent', aiContent);
				// const html = nunjucks.renderString(block.html, variables);

				return { ...block, variables, tokens };
			} catch (error) {
				return {
					...block,
					hasError: true,
					error: error?.message,
				};
			}
		}),
	);

	return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
};

const scopeCss = (scss, blockId) => {
	try {
		const replacedScss = scss.replace(/#_blockId/g, `#${blockId}`);
		const result = sass.compileString(replacedScss);
		return `
			/*!CSS-BLOCK:${blockId}:START!*/
				${result.css}
			/*!CSS-BLOCK:${blockId}:END!*/
		`;
	} catch (error) {
		console.error(`${blockId}:`, error);
		return scss;
	}
};

const scopeHtml = (block, blockId) => {
	try {
		const fallbackHTML = `<div id="${blockId}" class="generation-block-error">Failed to render ${block.blockType}</div>`;

		const result = block.hasError
			? fallbackHTML
			: nunjucks.renderString(block.html, {
					...block.variables,
					_blockId: blockId,
				});
		return `<!-- !HTML-BLOCK:${blockId}:START! -->${result}<!-- !HTML-BLOCK:${blockId}:END! -->`;
	} catch (error) {
		console.error(`${blockId}:`, error);
		return block;
	}
};

export const buildPageHtml = (page, globalCss, language, country, seo = {}) => {
	const filledBlocks = page.blocks.map((block, blockIndex) => {
		const id = `${block.blockType}-${blockIndex}`;
		return {
			...block,
			scopedCss: scopeCss(block.css, id),
			html: scopeHtml(block, id),
		};
	});
	const blocksHtml = filledBlocks.map((b) => b.html).join('\n');
	const blocksCss = filledBlocks.map((b) => b.scopedCss).join('\n');
	const cssVariables = Object.entries(globalCss || {})
		.map(([key, value]) => `${key}: ${value};`)
		.join('\n    ');

	return `<!DOCTYPE html>
<html lang="${language}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="index, follow">
    <meta name="geo.region" content="${country.toUpperCase()}">
    <meta name="geo.placename" content="${country.toUpperCase()}">
    <meta name="content-language" content="${language}">
    
    <title>${seo.title || page.title}</title>
    <meta name="description" content="${seo.description || ''}">
    <meta name="keywords" content="${seo.keywords || ''}">
    
    <meta property="og:title" content="${seo.ogTitle || seo.title || page.title}">
    <meta property="og:description" content="${seo.ogDescription || seo.description || ''}">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="${language}_${country.toUpperCase()}">
    
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${seo.ogTitle || seo.title || page.title}">
    <meta name="twitter:description" content="${seo.ogDescription || seo.description || ''}">
    
    <style>
        :root {
            ${cssVariables}
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
       
        body {
            font-family: var(--font-body, sans-serif);
            color: var(--color-text, #333);
            background-color: var(--color-background, #fff);
            line-height: var(--line-height-normal, 1.6);
        }
        
        ${blocksCss}
    </style>
</head>
<body>
    ${blocksHtml}
</body>
</html>`;
};

export const buildSitePages = (pages, globalCss, language, country, seoPages) => {
	return pages.map((page, pageIndex) => {
		const seo = seoPages[pageIndex];
		const pageHasErrors = page?.blocks?.some((block) => block.hasError);
		const blocks = page?.blocks?.map((block, blockIndex) => {
			return {
				blockId: block.id,
				isGlobal: block.isGlobal,
				blockType: block.blockType,
				generationBlockId: `${block.blockType}-${blockIndex}`,
				definition: block.definition,
				variables: block.variables,
				hasError: block?.hasError,
				css: block.css,
				html: block.html,
			};
		});

		return {
			...page,
			blocks,
			pageHasErrors,
			filename: page.path === '/' ? 'index.html' : `${page.path.replace('/', '')}.html`,
			html: buildPageHtml(page, globalCss, language, country, seo),
		};
	});
};

export const generateTheme = async (prompt) => {
	const cssThemePath = path.join(process.cwd(), 'src/const/css-theme.txt');
	const cssVariablesText = await fs.readFile(cssThemePath, 'utf-8');

	const systemPrompt = `You are a web designer. Create a CSS theme.

Website description: ${prompt}

CSS variables to generate (with descriptions):
${cssVariablesText}

Return JSON with all variables and their CSS values. Example:
{
  "--color-primary": "#3b82f6",
  "--font-heading": "'Inter', sans-serif"
}

Return only JSON.`;

	const completion = await openai.chat.completions.create({
		model: 'gpt-5-mini',
		messages: [
			{
				role: 'system',
				content: systemPrompt,
			},
			{
				role: 'user',
				content: prompt,
			},
		],
		temperature: 1,
	});

	const content = completion.choices[0].message.content;
	const jsonMatch = content.match(/\{[\s\S]*\}/);

	if (!jsonMatch) {
		throw new Error('AI did not return valid JSON for theme');
	}

	let theme;
	try {
		theme = JSON.parse(jsonMatch[0]);
	} catch (e) {
		throw new Error('Failed to parse theme JSON from AI response');
	}

	return {
		theme,
		tokens: {
			totalPromptTokens: completion.usage.prompt_tokens,
			totalCompletionTokens: completion.usage.completion_tokens,
			totalTokens: completion.usage.total_tokens,
		},
	};
};

export const flatPageBlocks = (pages) => {
	return pages.reduce((flatBlocks, page, pageIndex) => {
		const pageBlocks = (page?.layout ?? []).map((blockDef, blockIndex) => ({
			blockIndex: blockIndex,
			pageIndex: pageIndex,
			...blockDef,
		}));

		return [...flatBlocks, ...pageBlocks];
	}, []);
};

export const generateAllPagesSeo = async (pages, prompt, language, country) => {
	const systemPrompt = `Generate SEO attributes for multiple website pages.

Language: ${language}
Country: ${country}
Pages: ${pages.map((p) => p.title).join(', ')}

Return JSON array where each object has:
{
    "title": "SEO Title (50-60 chars)",
    "description": "Meta description (150-160 chars)",
    "keywords": "keyword1, keyword2, keyword3",
    "ogTitle": "Title for social media",
    "ogDescription": "Description for social media",
}

Return format:
{
    "pages": [
        { "title": "Page1 SEO", "description": "...", ... },
        { "title": "Page2 SEO", "description": "...", ... }
    ]
}`;

	try {
		const completion = await openai.chat.completions.create({
			model: 'gpt-5-mini',
			messages: [
				{ role: 'system', content: systemPrompt },
				{
					role: 'user',
					content: `Pages: ${pages.map((p) => p.title).join('\n')}\n\nPrompt: ${prompt}`,
				},
			],
			temperature: 1,
			response_format: { type: 'json_object' },
		});

		const result = JSON.parse(completion.choices[0].message.content);

		const seoResults = pages.map((page, index) => ({
			pageTitle: page.title,
			...(result.pages[index] || {
				title: page.title,
				description: `${page.title} services in ${country}`,
				keywords: `${page.title}, ${country}`,
				ogTitle: page.title,
				ogDescription: `${page.title} in ${country}`,
			}),
		}));

		return [
			seoResults,
			{
				totalPromptTokens: completion.usage.prompt_tokens,
				totalCompletionTokens: completion.usage.completion_tokens,
				totalTokens: completion.usage.total_tokens,
			},
		];
	} catch (error) {
		const fallbackSeo = pages.map((page) => ({
			title: `${page.title} | ${country}`,
			description: `${page.title} services in ${country}`,
			keywords: `${page.title.toLowerCase().replace(/\s+/g, ', ')}, ${country}`,
			ogTitle: page.title,
			ogDescription: `${page.title} in ${country}`,
		}));

		return [fallbackSeo, { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0 }];
	}
};
