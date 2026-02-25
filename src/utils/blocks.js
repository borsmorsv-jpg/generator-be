import { db } from '../db/connection.js';
import { blocks } from '../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { downloadAndUnzipBlock } from './zipHandler.js';
import * as sass from 'sass';
import nunjucks from 'nunjucks';
import fs from 'fs/promises';
import path from 'path';
import { fal, openai } from '../lib/AiClients.js';

const generateImageWithFal = async (prompt, zip) => {
	try {
		const { data } = await fal.run('fal-ai/flux/schnell', {
			input: {
				// prompt: `TRANSPARENT PNG LOGO: ${prompt}. Minimalist, vector, solid colors, no background`,
				prompt: prompt,
				negative_prompt: 'background, text, gradient, shadow, realistic, photo',
				image_size: 'square_hd',
				num_inference_steps: 4,
				guidance_scale: 3.5,
				sync_mode: true,
			},
		});

		const image = data.images[0];
		const fileName = `img_${Math.random().toString(36).substring(7)}.png`;
		const zipPath = `images/${fileName}`;

		const response = await fetch(image.url);
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		zip.addFile(zipPath, buffer);

		const cost = ((image.width * image.height) / 1000000) * 0.0039;

		return {
			url: zipPath,
			base64: response.url,
			cost: Number(cost.toFixed(4)),
			size: `${image.width}x${image.height}`,
		};
	} catch (error) {
		return {
			url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&format=png`,
			cost: 0,
			error: true,
		};
	}
};

const processImages = async (content, variables, zip) => {
	let totalFalCost = 0;
	for (const [key, value] of Object.entries(content)) {
		const varDef = variables[key];

		if (varDef?.type === 'image' && value?.href && !value.href.startsWith('http')) {
			const { url, base64, cost } = await generateImageWithFal(value.href, zip);
			content[key].href = url;
			content[key].href64 = base64;
			totalFalCost += cost;
		}

		if (varDef?.type === 'array' && Array.isArray(value?.values)) {
			for (const item of value.values) {
				for (const [itemKey, itemValue] of Object.entries(item)) {
					if (itemValue?.href && !itemValue.href.startsWith('http')) {
						const { url, base64, cost } = await generateImageWithFal(
							itemValue.href,
							zip,
						);
						item[itemKey].href = url;
						item[itemKey].href64 = base64;
						totalFalCost += cost;
					}
				}
			}
		}
	}
	return { content, totalFalCost };
};

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
	zip,
) => {
	const variablesDescription = buildVariablesDescription(variables);
	const expectedShape = buildExpectedShape(variables);

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
STRUCTURE TO FILL (from this block's definition)
=====================
${variablesDescription}

Use exactly these variable names and structure. Format:
- text: {"variableName": {"value": "content"}}
- image: {"variableName": {"href": "image description for AI", "alt": "alt text"}}
- link: {"variableName": {"href": "url", "label": "text"}}
- anchor: {"variableName": {"href": "url", "label": "text"}}
- anchors: {"variableName": {"value": []}}
- array: {"variableName": {"type": "array", "values": [{ ...each key from above list... }, ...]}}

!!! IMPORTANT: 
If a variable has type "block", you MUST NOT modify it, add content to it, or expand it. 
Keep the "block" object exactly as provided in the structure below.

=====================
EXPECTED SHAPE (fill with real content, 3–5 items for arrays)
=====================
${expectedShape}
${
	templatePages
		? `
If navigation labels were requested above, add to your JSON: "navigationLabels": ["Label 1", "Label 2", ...]`
		: ''
}

Return ONLY valid JSON. All text in ${language}. No empty strings.
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
	const { totalFalCost, content: updatedContent } = await processImages(result, variables, zip);
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

export const prepareBlock = async (block, prompt, country, language, navigation = null, zip) => {
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
			null,
			zip,
		);

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
	zip,
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
					zip,
				);

				if (aiContent.navigationLabels) {
					navigationLabels = aiContent.navigationLabels;
					delete aiContent.navigationLabels;
				}

				const navigation = {
					type: 'nav',
					value:
						templatePages?.length > 1
							? templatePages.map((page, index) => ({
									href: page.path === '/' ? './index.html' : `.${page.path}.html`,
									label: navigationLabels?.[index] || page.title,
									active: false,
								}))
							: [],
				};

				const variables = { ...aiContent, navigation };
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

const scopeHtml = (block, blockId, variables) => {
	try {
		const fallbackHTML = `<div id="${blockId}" class="generation-block-error">Failed to render ${block.blockType}</div>`;

		const result = block.hasError
			? fallbackHTML
			: nunjucks.renderString(block.html, {
					...variables,
					_blockId: blockId,
				});
		return `<!-- !HTML-BLOCK:${blockId}:START! -->${result}<!-- !HTML-BLOCK:${blockId}:END! -->`;
	} catch (error) {
		console.error(`${blockId}:`, error);
		return block;
	}
};

export const buildPageHtml = (page, globalCss, language, country, seo = {}, isPreview = false) => {
	const filledBlocks = page.blocks.map((block, blockIndex) => {
		const id = `${block.blockType}-${blockIndex}`;

		const originalVariables = block.variables;
		const previewVariables = replaceHrefWithHref64(block.variables);
		return {
			...block,
			scopedCss: scopeCss(block.css, id),
			html: scopeHtml(block, id, originalVariables),
			previewHtml: scopeHtml(block, id, previewVariables),
		};
	});
	const blocksHtml = filledBlocks.map((b) => b.html).join('\n');
	const blocksPreviewHtml = filledBlocks.map((b) => b.previewHtml).join('\n');
	const blocksCss = filledBlocks.map((b) => b.scopedCss).join('\n');
	const cssVariables = Object.entries(globalCss || {})
		.map(([key, value]) => `${key}: ${value};`)
		.join('\n    ');

	return {
		html: getHtmlPageTemplate({
			seo,
			page,
			country,
			language,
			blocksCss,
			blocksHtml,
			cssVariables,
		}),
		previewHtml: getHtmlPageTemplate({
			seo,
			page,
			country,
			language,
			blocksCss,
			blocksHtml: blocksPreviewHtml,
			cssVariables,
		}),
	};
};

const getHtmlPageTemplate = ({
	seo,
	page,
	country,
	language,
	cssVariables,
	blocksCss,
	blocksHtml,
}) => {
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

export const buildSitePages = (pages, globalCss, language, country) => {
	return pages.map((page) => {
		const pageHasErrors = page?.blocks?.some((block) => block.hasError);
		const blocks = page?.blocks?.map((block, blockIndex) => {
			return {
				blockId: block.id || block.blockId,
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

		const { html, previewHtml } = buildPageHtml(page, globalCss, language, country, page.seo);

		return {
			...page,
			blocks,
			pageHasErrors,
			filename: page.path === '/' ? 'index.html' : `${page.path.replace('/', '')}.html`,
			html,
			previewHtml,
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

const replaceHrefWithHref64 = (value) => {
	if (!value || typeof value !== 'object') return value;

	if (Array.isArray(value)) {
		return value.map((item) => replaceHrefWithHref64(item));
	}

	const newValue = { ...value };

	for (const key in newValue) {
		if (Object.hasOwn(newValue, key)) {
			newValue[key] = replaceHrefWithHref64(newValue[key]);
		}
	}

	if ('href' in newValue && 'href64' in newValue) {
		newValue.href = newValue.href64;
	}

	return newValue;
};

function buildVariablesDescription(variables) {
	const lines = [];
	for (const [name, v] of Object.entries(variables)) {
		if (v?.type === 'nav') continue;
		if (v?.type === 'array' && Array.isArray(v.values) && v.values[0]) {
			const itemKeys = Object.entries(v.values[0])
				.filter(([, field]) => typeof field === 'object' && field?.type)
				.map(([k, field]) => `${k} (${field.type})`);
			lines.push(`- ${name} (type: array). Each item: ${itemKeys.join(', ')}`);
		} else {
			const desc = v?.description ? ` — ${v.description}` : '';
			lines.push(`- ${name} (type: ${v?.type ?? 'text'})${desc}`);
		}
	}
	return lines.join('\n');
}

function buildExpectedShape(variables) {
	const out = {};
	for (const [name, v] of Object.entries(variables)) {
		if (v?.type === 'nav') continue;
		if (v?.type === 'array' && Array.isArray(v.values) && v.values[0]) {
			const item = {};
			for (const [k, field] of Object.entries(v.values[0])) {
				if (typeof field !== 'object' || !field?.type) continue;
				if (field.type === 'text') item[k] = { value: '...' };
				else if (field.type === 'image') item[k] = { href: '...', alt: '...' };
				else if (field.type === 'link')
					item[k] = { value: null, href: '...', label: '...' };
				else item[k] = { value: '...' };
			}
			out[name] = { type: 'array', values: [item, { ...JSON.parse(JSON.stringify(item)) }] };
		} else if (v?.type === 'image') {
			out[name] = { href: '...', alt: '...' };
		} else if (v?.type === 'link') {
			out[name] = { value: null, href: '...', label: '...' };
		} else if (v?.type === 'anchor') {
			out[name] = { href: '...', label: '...' };
		} else if (v?.type === 'anchors') {
			out[name] = { value: [] };
		} else if (v?.type === 'block') {
			out[name] = {  
                blockType: v.blockType || '...' 
            };
		} else {
			out[name] = { value: '...' };
		}
	}
	return JSON.stringify(out, null, 2);
}


const getRandomAndRemove = (array, currentId, currentBlockIndex) => {
	const filteredArray = array.filter(
		(item) => item.block.id !== currentId || item.blockIndex !== currentBlockIndex,
	);

	if (filteredArray.length === 0) return { updatedArray: array, selectedItem: null };
	const randomIndex = Math.floor(Math.random() * filteredArray.length);
	const selectedItem = filteredArray[randomIndex];
	const updatedArray = array.filter((item) => !(
		item.block.id === selectedItem.block.id && item.blockIndex === selectedItem.blockIndex
	));
	return { updatedArray, selectedItem };
}

const getFreeBlocks = (blocks) => {
	return blocks.map((block, blockIndex) => ({
						block,
						blockIndex,
					}))
					.filter(
						(blockInfo) =>
							blockInfo.block.category !== 'header' && blockInfo.block.category !== 'footer',
					);
} 

export const fillAnchors = (pages, targetPage = '') => {
	try{
		return pages.map((page) => {
				if (targetPage && page.filename !== targetPage) {
					return page;
				}

				let freeBlocks = getFreeBlocks(page.blocks)
				const startBlocksLength = freeBlocks.length;
				const allAnchors = new Map();

				const fillVars = (newBlock, key, result) => {
						const href = `#${result.selectedItem.block.category}-${result.selectedItem.blockIndex}`;
						const label = newBlock.variables[key].label;
						newBlock.variables[key].href = href;
						allAnchors.set(href, label);
						freeBlocks = result.updatedArray;
				}

				const updatedBlocks = page.blocks.map((block, blockIndexGlobal) => {
					let newBlock = JSON.parse(JSON.stringify(block));

					if (startBlocksLength >= 1 && newBlock.definition.variables) {
						Object.entries(newBlock.definition.variables).forEach(([key, values]) => {
							if (values.type === 'anchor') {
								if (!newBlock.variables[key]) {
                                	return;
                            	}
								const isOnlyCurrentBlockLeft = freeBlocks.length === 1 && 
									freeBlocks[0].block.id === newBlock.id && 
									freeBlocks[0].blockIndex === blockIndexGlobal;
								if(startBlocksLength > 1 && (isOnlyCurrentBlockLeft || freeBlocks.length === 0)){
										freeBlocks = getFreeBlocks(page.blocks);
								}

								let result = getRandomAndRemove(freeBlocks, newBlock.id, blockIndexGlobal);

								if(!result.selectedItem && startBlocksLength === 1){
									newBlock.variables[key].href = "";
									newBlock.variables[key].label = "";
									return
								}

								fillVars(newBlock, key, result);
							}
						});
					} 
					return newBlock;
				});
				
				const uniqueAnchorsList = Array.from(allAnchors.entries()).map(([href, label]) => ({
					href,
					label,
				}));

				updatedBlocks.forEach((block) => {
					Object.entries(block.definition.variables).forEach(([key, val]) => {
						if (val.type === 'anchors') {
							block.variables[key].value = uniqueAnchorsList;
						}
					});
				});

				return { ...page, blocks: updatedBlocks };
			});
	} catch(err){
		console.error("Error in fillAnchors function: ", err)
		return pages
	}
	
};

export const expandedDefinition = async (blockDef, level = 0, rootVariables = {}, currentParent = null, maxLevel = 5, rootKey = "") => {
    if (level > maxLevel) return { newVariables: rootVariables, usedKeys: [], contents: [] };

    if (level === 0) {
        Object.assign(rootVariables, JSON.parse(JSON.stringify(blockDef.variables || {})));
    }

    let allUsedKeys = [];
    let allContents = [];

    const currentVars = blockDef.variables || {};
    const entries = Object.entries(currentVars).filter(([_, v]) => v.type === "block");

    for (const [key, value] of entries) {
		const currentRootKey = level === 0 ? key : rootKey;

        allUsedKeys.push({ level, key, rootKey: currentRootKey });
        const childBlockInfo = await getBlockByType(value.blockType);
        
        if (!childBlockInfo) {
            console.warn(`[Warning] There no block for type: ${value.blockType}`);
            continue;
        }

        let targetRef = (level === 0) ? rootVariables[key] : (currentParent ? currentParent[key] : null);
        if (!targetRef) continue;

        targetRef.block = {}; 
        
		allContents.push({
            level,
            key,
            content: { html: childBlockInfo.html, css: childBlockInfo.css }
        });

        const childVars = childBlockInfo.definition.variables || {};
        
        for (const [cKey, cValue] of Object.entries(childVars)) {
            if (cValue.type !== "block") {
                const flatName = `${cKey}${currentRootKey}${key}${level}`;
                rootVariables[flatName] = JSON.parse(JSON.stringify(cValue));
            }
        }

        const nextInnerBlocks = Object.entries(childVars).filter(([_, v]) => v.type === "block");

        if (nextInnerBlocks.length > 0) {
           const [firstInnerKey, firstInnerValue] = nextInnerBlocks[0];

			targetRef.block = {
				[firstInnerKey]: JSON.parse(JSON.stringify(firstInnerValue))
			};

            const res = await expandedDefinition(
                childBlockInfo.definition,
                level + 1,
                rootVariables,
                targetRef.block, 
                maxLevel,
				currentRootKey
            );

            allUsedKeys = [...allUsedKeys, ...res.usedKeys];
            allContents = [...allContents, ...res.contents];
        }

        if (level > 0) break;
    }

    return { newVariables: rootVariables, usedKeys: allUsedKeys, contents: allContents };
};

export const transformToStructuredBlocks = (pages) => {
    return pages.map((page) => {
		const newBlocks = page.blocks.map((preparedBlock) => {
			if(preparedBlock.isGlobal){
				return preparedBlock
			}
			const additionalInfo = preparedBlock.additionalInfo;
			if(!additionalInfo || additionalInfo.usedKeys.length === 0 || additionalInfo.contents.length === 0){
				return preparedBlock
			}
			const {usedKeys, contents} = additionalInfo;
			const variables = preparedBlock.variables;
			const allSuffixes = usedKeys.map(uk => `${uk.rootKey}${uk.key}${uk.level}`);
			const blockContainers = usedKeys.map(({ level, key, rootKey }) => {
				const suffix = `${rootKey}${key}${level}`;
				const blockData = { blockVars: {} };

				Object.keys(variables).forEach(fullKey => {
					if (fullKey.endsWith(suffix)) {
						let realVarName = fullKey.slice(0, -suffix.length);
						if (realVarName.endsWith(key) && realVarName !== key) {
							realVarName = realVarName.slice(0, -key.length);
						}

						if (realVarName) {
							blockData.blockVars[realVarName] = JSON.parse(JSON.stringify(variables[fullKey]));
						}
					}
				});

				let originalVar = preparedBlock.definition?.variables?.[rootKey];;

				if(level !== 0){
					for (let i = 1; i <= level; i++) {
						const step = usedKeys.find(uk => uk.level === i);
						if (step && originalVar?.block?.[step.key]) {
							originalVar = originalVar.block[step.key];
						} else {
							originalVar = null;
							break;
						}
					}
				}
			
				blockData.originalType = originalVar?.blockType;

				if (originalVar?.block && typeof originalVar.block === 'object') {
					Object.keys(originalVar.block).forEach(subKey => {
						let cleanSubKey = subKey;
						if (cleanSubKey.endsWith(key) && cleanSubKey !== key) {
							cleanSubKey = cleanSubKey.slice(0, -key.length);
						}
						if (!blockData.blockVars[cleanSubKey]) {
							blockData.blockVars[cleanSubKey] = { type: "block" };
						}
					});
				}

				const contentMatch = contents.find(c => c.level === level && c.key === key);
				if (contentMatch?.content?.css) {
					preparedBlock.css += "\n" + contentMatch.content.css;
				}

				return { level, key, data: blockData, templateHtml: contentMatch?.content?.html || "" };
			});

			const sortedContainers = [...blockContainers].sort((a, b) => b.level - a.level);

			sortedContainers.forEach(container => {
				const blockId = `${container.key}${container.level}`;
				const renderedHtml = scopeHtml(
					{ html: container.templateHtml, blockType: container.data.originalType },
					blockId,
					container.data.blockVars
				);

				container.data.htmlContent = renderedHtml;

				if (container.level > 0) {
					const parent = sortedContainers.find(p => 
						p.level === container.level - 1 && 
						p.data.blockVars.hasOwnProperty(container.key)
					);

					if (parent) {
						if (typeof parent.data.blockVars[container.key] !== 'object') {
							parent.data.blockVars[container.key] = {};
						}
						parent.data.blockVars[container.key].htmlContent = renderedHtml;
					}
				}
			});

		const result = {};

			Object.keys(variables).forEach(key => {
				const isSuffixed = allSuffixes.some(s => key.endsWith(s));
				
				if (!isSuffixed) {
					const originalVar = variables[key];
					const rootMatch = sortedContainers.find(c => c.level === 0 && c.key === key);
					
					if (rootMatch) {
						result[key] = {
							type: "block",
							blockType: rootMatch.data.originalType,
							htmlContent: rootMatch.data.htmlContent,
							variables: rootMatch.data.blockVars 
						};
					} else {
						result[key] = JSON.parse(JSON.stringify(originalVar));
					}
				}
			});
		return { ...preparedBlock, variables: result };
	})
	return {...page, blocks: newBlocks}
	})
};