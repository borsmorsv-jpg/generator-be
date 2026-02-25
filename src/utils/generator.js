import {
	buildSitePages,
	flatPageBlocks,
	generateTheme,
	getBlockByType,
	getBlocks,
	prepareBlock,
	prepareGlobalBlocks,
} from './blocks.js';
import { PRICE_FOR_PROMPTS_OPENAI } from '../config/constants.js';
import dayjs from 'dayjs';
import {generatePagesWithAI} from "./pages.js";

export const generateSite = async ({ currentTokens, template, prompt, country, language, zip }) => {
	const tokensInfo = {
		totalPromptTokens: currentTokens.totalPromptTokens ?? 0,
		totalCompletionTokens: currentTokens.totalCompletionTokens ?? 0,
		totalTokens: currentTokens.totalTokens ?? 0,
		totalFalCost: currentTokens.totalFalCost ?? 0,
	};

	const populatePagesWithContent = async (template, pages) => {
		const tokens = {
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalTokens: 0,
			totalFalCost: 0,
		};

		const globalBlocks = await getBlocks(template?.definition?.globals?.blocks);
		const preparedGlobalBlocks = await prepareGlobalBlocks(
			globalBlocks,
			pages,
			prompt,
			country,
			language,
			zip,
		);
		preparedGlobalBlocks.forEach((b) => {
			tokens.totalPromptTokens += b.tokens?.promptTokens ?? 0;
			tokens.totalCompletionTokens += b.tokens?.completionTokens ?? 0;
			tokens.totalTokens += b.tokens?.totalTokens ?? 0;
			tokens.totalFalCost += b.tokens?.totalFalCost ?? 0;
		});

		const globalBlocksMap = new Map(preparedGlobalBlocks.map((b) => [b.category, b]));

		const pagesBlocks = flatPageBlocks(pages);
		const generatedBlocks = await Promise.allSettled(
			pagesBlocks.map(async (blockDef) => {
				const isGlobal = globalBlocksMap.has(blockDef.type);
				const baseInfo = {
					pageIndex: blockDef.pageIndex,
					blockType: blockDef.type,
					isGlobal,
					hasError: false,
				};

				try {
					if (isGlobal) {
						const block = globalBlocksMap.get(blockDef.type);
						return {
							...baseInfo,
							...block,
						};
					} else {
						const block = await getBlockByType(blockDef.type);
						const preparedBlock = await prepareBlock(block, prompt, country, language, null, zip);

						tokens.totalPromptTokens += preparedBlock.tokens.promptTokens;
						tokens.totalCompletionTokens += preparedBlock.tokens.completionTokens;
						tokens.totalTokens += preparedBlock.tokens.totalTokens;
						tokens.totalFalCost += preparedBlock.tokens.totalFalCost;

						return {
							hasError: false,
							...baseInfo,
							...preparedBlock,
						};
					}
				} catch (error) {
					return {
						...baseInfo,
						error: error.message,
						hasError: true,
					};
				}
			}),
		);
		const pagesWithBlocks = generatedBlocks.map((blockResult) => blockResult.value);
		const populatedPages = pages.reduce((acc, page, pageIndex) => {
			const blocks = pagesWithBlocks.filter((block) => block.pageIndex === pageIndex);
			return [
				...acc,
				{
					...page,
					blocks,
				},
			];
		}, []);

		return {
			pages: populatedPages,
			tokens,
		};
	};

	const populateTheme = async () => {
		const { theme: generatedTheme, tokens: themeTokens } = await generateTheme(prompt);

		return {
			theme: generatedTheme,
			tokens: themeTokens,
		};
	};

	const { pages: generatedPages, tokens: seoTokens } = await generatePagesWithAI({
		prompt,
		pages: template.definition.pages,
		country,
		language
	});

	const final = await Promise.all([
		populateTheme(prompt),
		populatePagesWithContent(template, generatedPages),
	]);

	const [
		{ theme: generatedTheme, tokens: themeTokens },
		{ pages, tokens: pagesTokens },
	] = final;

	tokensInfo.totalPromptTokens +=
		themeTokens.totalPromptTokens + pagesTokens.totalPromptTokens + seoTokens.totalPromptTokens;
	tokensInfo.totalCompletionTokens +=
		themeTokens.totalCompletionTokens +
		pagesTokens.totalCompletionTokens +
		seoTokens.totalCompletionTokens;

	tokensInfo.totalTokens +=
		themeTokens.totalTokens + pagesTokens.totalTokens + seoTokens.totalTokens;
	tokensInfo.totalFalCost += pagesTokens.totalFalCost;

	const globalCss = {
		...generatedTheme,
		...(template?.definition?.globals?.css || {}),
	};

	const openAiInputPrice =
		tokensInfo.totalPromptTokens * (PRICE_FOR_PROMPTS_OPENAI.input / 1000000);
	const openAiOutputPrice =
		tokensInfo.totalCompletionTokens * (PRICE_FOR_PROMPTS_OPENAI.output / 1000000);
	const openAiTotalPrice = openAiInputPrice + openAiOutputPrice;

	const sitePages = buildSitePages(pages, globalCss, language, country);
	const siteConfigDetailed = {
		pages: sitePages?.map((page) => ({
			title: page.title,
			path: page.path,
			filename: page.filename,
			blocks: page.blocks,
		})),
		generatedTheme: globalCss,
	};

	return {
		tokens: {
			...tokensInfo,
			openAiInputPrice,
			openAiOutputPrice,
			openAiTotalPrice,
		},
		sitePages,
		siteConfigDetailed,
		previews: sitePages.map((page) => ({
			html: page.previewHtml,
			filename: page.filename,
			hasErrors: page.pageHasErrors,
		})),
		siteConfig: siteConfigDetailed?.pages?.map((page) => ({
			...page,
			blocks: page?.blocks?.map((block) => ({
				blockId: block.blockId,
				isGlobal: block.isGlobal,
				blockType: block.blockType,
				generationBlockId: block.generationBlockId,
				hasError: block.hasError,
			})),
		})),
	};
};

export const generateSitemapXml = (sitePages, domain = "http://localhost:3000") => {
	try {
		let baseUrl;

		try {
			if (!domain) throw new Error('Domain is empty');
			const urlObj = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
			baseUrl = urlObj.href.endsWith('/') ? urlObj.href : `${urlObj.href}/`;
		} catch (e) {
			console.error('Domain is not a valid URL');
			throw new Error(
				`Sitemap generation failed: Invalid domain "${domain}". Details: ${e.message}`,
			);
		}
		const timestamp = dayjs().format('YYYY-MM-DDTHH:mm:ssZ');

		const urlEntries = sitePages
			.map((page) => {
				const cleanPath =
					page.path === '/' ? '' : page.path.replace(/^\//, '').replace(/\.html$/, '');
				const loc = `${baseUrl}${cleanPath}`;

				const imageUrls = [];
				page.blocks.forEach((block) => {
					if (!block.variables) return;

					const findImagesRecursive = (obj) => {
						if (!obj || typeof obj !== 'object') return;
						if (obj.href && (obj.type === 'image' || obj.alt)) {
							imageUrls.push({
								loc: obj.href,
								caption: obj.alt || obj.value || '',
							});
						}
						Object.values(obj).forEach((value) => {
							if (Array.isArray(value)) {
								value.forEach((item) => findImagesRecursive(item));
							} else if (typeof value === 'object') {
								findImagesRecursive(value);
							}
						});
					};
					findImagesRecursive(block.variables);
				});

				const imagesXml = imageUrls
					.map(
						(img) => `    <image:image>
      <image:loc>${img.loc}</image:loc>
      <image:caption>${img.caption.replace(/[<>&"']/g, '')}</image:caption>
    </image:image>`,
					)
					.join('\n');

				return `  <url>
    <loc>${loc}</loc>
    <lastmod>${timestamp}</lastmod>
    <changefreq>${page.path === '/' ? 'daily' : 'monthly'}</changefreq>
    <priority>${page.path === '/' ? '1.0' : '0.8'}</priority>
${imagesXml}
  </url>`;
			})
			.join('\n');

		return {
			siteMapBody: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urlEntries}
</urlset>`,
			hasError: false,
			errorMessage: null,
		};
	} catch (error) {
		return {
			siteMapBody: null,
			hasError: true,
			errorMessage: error.message,
		};
	}
};

export const generateNginxConfig = ({ serverName, rootDir } = {}) => {
	const cleanServerName = serverName
		? serverName.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
		: '';
	const effectiveServerName = cleanServerName.length > 0 ? cleanServerName : '_';
	const effectiveRootDir = rootDir?.trim() || '/var/www/html';

	return `server {
	listen 80;
	server_name ${effectiveServerName};

	# Adjust root to the folder where you unpacked the site
	root ${effectiveRootDir};
	index index.html;

	location / {
		try_files $uri $uri/ $uri.html /index.html;
	}
}`;
};
