import { db, supabase } from '../../db/connection.js';
import { blocks, profiles, sites, templates } from '../../db/schema.js';
import { and, asc, count, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import AdmZip from 'adm-zip';
import { alias } from 'drizzle-orm/pg-core';
import JSZip from 'jszip';
import { PRICE_FOR_PROMPTS } from '../../config/constants.js';
import slugify from 'slugify';
import {
	buildSitePages,
	flatPageBlocks,
	generateTheme,
	getBlockByType,
	getBlocks,
	prepareBlock,
	prepareGlobalBlocks,
} from '../../utils/blocks.js';
import nunjucks from 'nunjucks';
import * as sass from 'sass';
import scss from 'nunjucks/browser/nunjucks-slim.js';
import { replaceSiteZipWithNew } from '../../utils/archiveProcessor.js';

function cutNumber(number, amountAfterDot) {
	const factor = 10 ** amountAfterDot;
	return Math.floor(number * factor) / factor;
}

export const createSite = async (request, reply) => {
	try {
		const { prompt, templateId, isActive, name, trafficSource, country, language } =
			request.body;

		const template = await db.query.templates.findFirst({
			where: eq(templates.id, templateId),
		});

		if (!template) {
			return reply.status(404).send({ error: 'Template not found' });
		}

		const tokensInfo = {
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalTokens: 0,
		};
		const { theme: generatedTheme, tokens: themeTokens } = await generateTheme(prompt);
		tokensInfo.totalPromptTokens += themeTokens.promptTokens;
		tokensInfo.totalCompletionTokens += themeTokens.completionTokens;
		tokensInfo.totalTokens += themeTokens.totalTokens;

		// const seoData = await Promise.all(
		// 	template.definition.pages.map(async (page) => {
		// 		try {
		// 			const [seo, tokens] = await generatePageSeo(
		// 				page.title,
		// 				prompt,
		// 				language,
		// 				country,
		// 			);
		// 			tokensInfo.totalPromptTokens += tokens.promptTokens;
		// 			tokensInfo.totalCompletionTokens += tokens.completionTokens;
		// 			tokensInfo.totalTokens += tokens.totalTokens;
		// 			return seo;
		// 		} catch (err) {
		// 			return err;
		// 		}
		// 	}),
		// );
		const globalCss = {
			...generatedTheme,
			// ...(template?.definition?.globals?.css || {})
		};

		const globalBlocks = await getBlocks(template?.definition?.globals?.blocks);
		const preparedGlobalBlocks = await prepareGlobalBlocks(
			globalBlocks,
			template?.definition?.pages,
			prompt,
			country,
			language,
		);
		preparedGlobalBlocks.forEach((b) => {
			tokensInfo.totalPromptTokens += b.tokens.promptTokens;
			tokensInfo.totalCompletionTokens += b.tokens.completionTokens;
			tokensInfo.totalTokens += b.tokens.totalTokens;
		});

		const globalBlocksMap = new Map(preparedGlobalBlocks.map((b) => [b.category, b]));
		const pagesBlocks = flatPageBlocks(template.definition.pages);
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
						const preparedBlock = await prepareBlock(block, prompt, country, language);

						tokensInfo.totalPromptTokens += preparedBlock.tokens.promptTokens;
						tokensInfo.totalCompletionTokens += preparedBlock.tokens.completionTokens;
						tokensInfo.totalTokens += preparedBlock.tokens.totalTokens;

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
		const pages = template.definition.pages.reduce((acc, page, pageIndex) => {
			const blocks = pagesWithBlocks.filter((block) => block.pageIndex === pageIndex);
			return [
				...acc,
				{
					...page,
					blocks,
					// seo: seoData[pageIndex],
				},
			];
		}, []);

		const inputPrice = tokensInfo.totalPromptTokens * (PRICE_FOR_PROMPTS.input / 1000000);
		const outputPrice = tokensInfo.totalCompletionTokens * (PRICE_FOR_PROMPTS.output / 1000000);
		const totalPrice = inputPrice + outputPrice;

		const sitePages = buildSitePages(pages, globalCss, language, country);
		const siteConfigDetailed = {
			pages: sitePages?.map((page) => ({
				title: page.title,
				path: page.path,
				filename: page.filename,
				blocks: page.blocks,
			})),
			generatedTheme,
		};

		const zip = new AdmZip();
		sitePages.forEach((page) => {
			zip.addFile(page.filename, Buffer.from(page.html, 'utf8'));
		});

		const zipBuffer = zip.toBuffer();
		const safeName = slugify(`site-${name}-${new Date().getTime()}.zip`, {
			lower: true,
			strict: true,
		});
		const { error: uploadError } = await supabase.storage
			.from('sites')
			.upload(safeName, zipBuffer, {
				contentType: 'application/zip',
				upsert: false,
			});

		if (uploadError) {
			throw uploadError;
		}

		const { data: urlData } = supabase.storage.from('sites').getPublicUrl(safeName);

		const [siteData] = await db
			.insert(sites)
			.values({
				isDraft: true,
				name: name,
				isActive: isActive,
				trafficSource: trafficSource,
				archiveUrl: urlData.publicUrl,
				country: country,
				language: language,
				definition: template.id,
				prompt: prompt,
				totalTokens: tokensInfo.totalTokens,
				completionTokens: tokensInfo.totalCompletionTokens,
				siteConfigDetailed: siteConfigDetailed,
				promptTokens: tokensInfo.totalPromptTokens,
				inputUsdPrice: cutNumber(inputPrice, 6),
				outputUsdPrice: cutNumber(outputPrice, 6),
				totalUsdPrice: cutNumber(totalPrice, 6),
				createdBy: '67366103-2833-41a8-aea2-10d589a0705c',
				updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
			})
			.returning();

		return reply.status(201).send({
			data: {
				...siteData,
				previews: sitePages.map((page) => ({
					html: page.html,
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
				siteConfigDetailed,
			},
			success: true,
		});
	} catch (error) {
		return reply.status(500).send({ error: error.message });
	}
};

export const getAllSites = async (request, reply) => {
	try {
		const {
			page = 1,
			limit = 20,
			searchByName = '',
			searchById = '',
			sortBy = 'createdAt',
			sortOrder = 'desc',
			isActive,
			createdBy,
			updatedBy,
			createdAtFrom,
			createdAtTo,
			updatedAtFrom,
			updatedAtTo,
			createdByUserId,
			updatedByUserId,
		} = request.query;

		const parseDateFilter = (dateString) => {
			if (!dateString) return null;
			const date = new Date(dateString);
			return isNaN(date.getTime()) ? null : date;
		};

		const createdAtFromDate = parseDateFilter(createdAtFrom);
		const createdAtToDate = parseDateFilter(createdAtTo);
		const updatedAtFromDate = parseDateFilter(updatedAtFrom);
		const updatedAtToDate = parseDateFilter(updatedAtTo);

		const offset = (page - 1) * limit;

		const createdByProfile = alias(profiles, 'created_by_profile');
		const updatedByProfile = alias(profiles, 'updated_by_profile');

		const filters = [];

		if (searchByName) filters.push(ilike(blocks.name, `%${searchByName}%`));
		if (searchById) {
			filters.push(sql`CAST(${blocks.id} AS TEXT) ILIKE ${'%' + searchById + '%'}`);
		}
		if (createdBy) filters.push(eq(blocks.createdBy, createdBy));
		if (updatedBy) filters.push(eq(blocks.updatedBy, updatedBy));

		if (createdAtFromDate) filters.push(gte(blocks.createdAt, createdAtFromDate));
		if (createdAtToDate) filters.push(lte(blocks.createdAt, createdAtToDate));
		if (updatedAtFromDate) filters.push(gte(blocks.updatedAt, updatedAtFromDate));
		if (updatedAtToDate) filters.push(lte(blocks.updatedAt, updatedAtToDate));

		if (createdByUserId) filters.push(lte(blocks.createdBy, createdByUserId));
		if (updatedByUserId) filters.push(lte(blocks.updatedBy, updatedByUserId));

		if (isActive === 'true') {
			filters.push(eq(blocks.isActive, true));
		} else if (isActive === 'false') {
			filters.push(eq(blocks.isActive, false));
		}

		const order = (column) => (sortOrder === 'asc' ? asc(column) : desc(column));

		const query = db
			.select({
				id: sites.id,
				name: sites.name,
				isActive: sites.isActive,
				archiveUrl: sites.archiveUrl,
				definition: sites.definition,
				createdAt: sites.createdAt,
				updatedAt: sites.updatedAt,
				promptTokens: sites.promptTokens,
				completionTokens: sites.completionTokens,
				totalTokens: sites.totalTokens,
				totalUsdPrice: sites.totalUsdPrice,
				inputUsdPrice: sites.inputUsdPrice,
				outputUsdPrice: sites.outputUsdPrice,
				createdByEmail: createdByProfile.email,
				createdByUsername: createdByProfile.username,
				updatedByEmail: updatedByProfile.email,
				updatedByUsername: updatedByProfile.username,
			})
			.from(sites)
			.leftJoin(createdByProfile, eq(sites.createdBy, createdByProfile.userId))
			.leftJoin(updatedByProfile, eq(sites.updatedBy, updatedByProfile.userId))
			.where(filters.length ? and(...filters) : undefined)
			.orderBy(order(sites[sortBy]))
			.limit(limit)
			.offset(offset);

		const data = await query;

		const [{ count: totalCount }] = await db
			.select({ count: count() })
			.from(sites)
			.where(filters.length ? and(...filters) : undefined);

		return reply.code(200).send({
			success: true,
			data,
			pagination: {
				page: Number(page),
				limit: Number(limit),
				totalCount,
				totalPages: Math.ceil(totalCount / limit),
				hasNext: page < Math.ceil(totalCount / limit),
				hasPrev: page > 1,
			},
		});
	} catch (error) {
		reply.code(400).send({
			success: false,
			error: error.message,
		});
	}
};

export const getOneSite = async (request, reply) => {
	try {
		const { siteId } = request.params;

		const [site] = await db
			.select()
			.from(sites)
			.where(eq(sites.id, parseInt(siteId)));

		const response = await fetch(site.archiveUrl);
		if (!response.ok) {
			throw new Error(`Failed to download archive: ${response.status}`);
		}

		const responseArrayBuffer = await response.arrayBuffer();
		const zip = await JSZip.loadAsync(responseArrayBuffer);

		const htmlFiles = Object.keys(zip.files).filter((filename) =>
			filename.toLowerCase().endsWith('.html'),
		);

		const previews = await Promise.all(
			htmlFiles.map(async (filename) => {
				try {
					const html = await zip.file(filename).async('string');
					return {
						filename,
						html,
					};
				} catch (error) {
					return {
						filename,
						html: null,
					};
				}
			}),
		);

		reply.send({
			success: true,
			data: {
				...site,
				previews,
				siteConfig: site?.siteConfigDetailed?.pages?.map((page) => ({
					...page,
					blocks: page?.blocks?.map((block) => ({
						blockId: block.blockId,
						isGlobal: block.isGlobal,
						blockType: block.blockType,
						generationBlockId: block.generationBlockId,
						hasError: block.hasError,
					})),
				})),
				siteConfigDetailed: site.siteConfigDetailed,
			},
		});
	} catch (error) {
		reply.code(500).send({
			success: false,
			error: error.message,
		});
	}
};

export const activateSite = async (request, reply) => {
	try {
		const { siteId } = request.params;

		const [existing] = await db
			.select()
			.from(sites)
			.where(eq(sites.id, Number(siteId)));

		if (!existing) {
			return reply.code(404).send({ success: false, error: 'Site not found' });
		}

		const [updatedSite] = await db
			.update(sites)
			.set({
				isDraft: false,
			})
			.where(eq(sites.id, Number(siteId)))
			.returning();

		reply.send({
			success: true,
			data: updatedSite,
		});
	} catch (error) {
		reply.code(500).send({
			success: false,
			error: error.message,
		});
	}
};

export const regenerateSite = async (request, reply) => {
	try {
		const { siteId } = request.params;

		const [site] = await db
			.select()
			.from(sites)
			.where(eq(sites.id, parseInt(siteId)))
			.limit(1);

		if (!site) {
			throw new Error(`Failed to find site with id "${siteId}"`);
		}

		const { prompt, templateId, isActive, name, trafficSource, country, language } =
			request.body;

		const tokensInfo = {
			totalPromptTokens: site.promptTokens,
			totalCompletionTokens: site.completionTokens,
			totalTokens: site.totalTokens,
		};

		const template = await db.query.templates.findFirst({
			where: eq(templates.id, templateId),
		});

		if (!template) {
			return reply.status(404).send({ error: 'Template not found' });
		}

		const { theme: generatedTheme, tokens: themeTokens } = await generateTheme(prompt);
		tokensInfo.totalPromptTokens += themeTokens.promptTokens;
		tokensInfo.totalCompletionTokens += themeTokens.completionTokens;
		tokensInfo.totalTokens += themeTokens.totalTokens;

		// const seoData = await Promise.all(
		// 	template.definition.pages.map(async (page) => {
		// 		try {
		// 			const [seo, tokens] = await generatePageSeo(
		// 				page.title,
		// 				prompt,
		// 				language,
		// 				country,
		// 			);
		// 			tokensInfo.totalPromptTokens += tokens.promptTokens;
		// 			tokensInfo.totalCompletionTokens += tokens.completionTokens;
		// 			tokensInfo.totalTokens += tokens.totalTokens;
		// 			return seo;
		// 		} catch (err) {
		// 			return err;
		// 		}
		// 	}),
		// );
		const globalCss = {
			...generatedTheme,
			// ...(template?.definition?.globals?.css || {})
		};

		const globalBlocks = await getBlocks(template?.definition?.globals?.blocks);
		const preparedGlobalBlocks = await prepareGlobalBlocks(
			globalBlocks,
			template?.definition?.pages,
			prompt,
			country,
			language,
		);
		preparedGlobalBlocks.forEach((b) => {
			tokensInfo.totalPromptTokens += b.tokens.promptTokens;
			tokensInfo.totalCompletionTokens += b.tokens.completionTokens;
			tokensInfo.totalTokens += b.tokens.totalTokens;
		});

		const globalBlocksMap = new Map(preparedGlobalBlocks.map((b) => [b.category, b]));
		const pagesBlocks = flatPageBlocks(template.definition.pages);
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
						const preparedBlock = await prepareBlock(block, prompt, country, language);

						tokensInfo.totalPromptTokens += preparedBlock.tokens.promptTokens;
						tokensInfo.totalCompletionTokens += preparedBlock.tokens.completionTokens;
						tokensInfo.totalTokens += preparedBlock.tokens.totalTokens;

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
		const pages = template.definition.pages.reduce((acc, page, pageIndex) => {
			const blocks = pagesWithBlocks.filter((block) => block.pageIndex === pageIndex);
			return [
				...acc,
				{
					...page,
					blocks,
					// seo: seoData[pageIndex],
				},
			];
		}, []);

		const inputPrice = tokensInfo.totalPromptTokens * (PRICE_FOR_PROMPTS.input / 1000000);
		const outputPrice = tokensInfo.totalCompletionTokens * (PRICE_FOR_PROMPTS.output / 1000000);
		const totalPrice = inputPrice + outputPrice;

		const sitePages = buildSitePages(pages, globalCss, language, country);
		const siteConfigDetailed = {
			pages: sitePages?.map((page) => ({
				title: page.title,
				path: page.path,
				filename: page.filename,
				blocks: page.blocks,
			})),
			generatedTheme,
		};

		const urlData = replaceSiteZipWithNew(sitePages, site.name, site.archiveUrl);

		const [siteData] = await db
			.update(sites)
			.set({
				isDraft: true,
				name: name,
				isActive: isActive,
				trafficSource: trafficSource,
				archiveUrl: urlData.publicUrl,
				country: country,
				language: language,
				definition: template.id,
				prompt: prompt,
				totalTokens: tokensInfo.totalTokens,
				completionTokens: tokensInfo.totalCompletionTokens,
				siteConfigDetailed: siteConfigDetailed,
				promptTokens: tokensInfo.totalPromptTokens,
				inputUsdPrice: cutNumber(inputPrice, 6),
				outputUsdPrice: cutNumber(outputPrice, 6),
				totalUsdPrice: cutNumber(totalPrice, 6),
				createdBy: '67366103-2833-41a8-aea2-10d589a0705c',
				updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
			})
			.where(eq(sites.id, siteId))
			.returning();

		return reply.status(201).send({
			data: {
				...siteData,
				previews: sitePages.map((page) => ({
					html: page.html,
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
				siteConfigDetailed,
			},
			success: true,
		});

		// const [siteData] = await db
		// 	.update(sites)
		// 	.set({
		// 		prompt,
		// 		archiveUrl: urlData.publicUrl,
		// 		totalTokens: tokensInfo.totalTokens,
		// 		completionTokens: tokensInfo.totalCompletionTokens,
		// 		promptTokens: tokensInfo.totalPromptTokens,
		// 		inputUsdPrice: cutNumber(inputPrice, 6),
		// 		outputUsdPrice: cutNumber(outputPrice, 6),
		// 		totalUsdPrice: cutNumber(totalPrice, 6),
		// 		updatedAt: new Date(),
		// 	})
		// 	.where(eq(sites.id, siteId))
		// 	.returning();
		//
		// return reply.send({
		// 	data: {
		// 		...siteData,
		// 		preview: generatedSite,
		// 	},
		// 	success: true,
		// });
	} catch (err) {
		reply.status(500).send({
			error: err.message,
			success: false,
		});
	}
};

export const regenerateBlock = async (request, reply) => {
	try {
		const { siteId } = request.params;
		const { prompt, pageName, generationBlockId, isBlockGlobal } = request.body;
		const [blockType, blockIndex] = generationBlockId.split('-');

		const [site] = await db
			.select()
			.from(sites)
			.where(eq(sites.id, parseInt(siteId)))
			.limit(1);

		if (!site) {
			throw new Error(`Failed to find site with id "${siteId}"`);
		}

		const block = await getBlockByType(blockType);

		const tokensInfo = {
			totalPromptTokens: site.promptTokens,
			totalCompletionTokens: site.completionTokens,
			totalTokens: site.totalTokens,
		};

		let generatedBlock;

		if (isBlockGlobal) {
			const [preparedBlock] = await prepareGlobalBlocks(
				[block],
				site.siteConfigDetailed?.pages,
				site.prompt || prompt,
				site.country,
				site.language,
			);

			tokensInfo.totalPromptTokens += preparedBlock.tokens.promptTokens;
			tokensInfo.totalCompletionTokens += preparedBlock.tokens.completionTokens;
			tokensInfo.totalTokens += preparedBlock.tokens.totalTokens;
			generatedBlock = preparedBlock;
		} else {
			const preparedBlock = await prepareBlock(
				block,
				site.prompt || prompt,
				site.country,
				site.language,
			);

			tokensInfo.totalPromptTokens += preparedBlock.tokens.promptTokens;
			tokensInfo.totalCompletionTokens += preparedBlock.tokens.completionTokens;
			tokensInfo.totalTokens += preparedBlock.tokens.totalTokens;

			generatedBlock = preparedBlock;
		}

		const updatedPages = site.siteConfigDetailed?.pages?.map((page) => {
			const shouldUpdatePage = isBlockGlobal || page.filename === pageName;

			if (!shouldUpdatePage) {
				return page;
			}

			return {
				...page,
				blocks: page.blocks.map((block, blockIndex) => {
					if (block.generationBlockId !== generationBlockId) {
						return block;
					}

					return {
						id: generatedBlock.id,
						isGlobal: isBlockGlobal,
						blockType: generatedBlock.category,
						blockIndex: blockIndex,
						// generationBlockId: `${generatedBlock.category}-${blockIndex}`,
						definition: generatedBlock.definition,
						variables: generatedBlock.variables,
						hasError: false,
						css: generatedBlock.css,
						html: generatedBlock.html,
					};
				}),
			};
		});

		const sitePages = buildSitePages(
			updatedPages,
			site.siteConfigDetailed.generatedTheme,
			site.language,
			site.country,
		);
		const urlData = replaceSiteZipWithNew(sitePages, site.name, site.archiveUrl);

		const siteConfigDetailed = {
			pages: sitePages?.map((page) => ({
				title: page.title,
				path: page.path,
				filename: page.filename,
				blocks: page.blocks,
			})),
			generatedTheme: site.siteConfigDetailed.generatedTheme,
		};
		const inputPrice = tokensInfo.totalPromptTokens * (PRICE_FOR_PROMPTS.input / 1000000);
		const outputPrice = tokensInfo.totalCompletionTokens * (PRICE_FOR_PROMPTS.output / 1000000);
		const totalPrice = inputPrice + outputPrice;

		const [siteData] = await db
			.update(sites)
			.set({
				archiveUrl: urlData.publicUrl,
				totalTokens: tokensInfo.totalTokens,
				completionTokens: tokensInfo.totalCompletionTokens,
				promptTokens: tokensInfo.totalPromptTokens,
				inputUsdPrice: cutNumber(inputPrice, 6),
				outputUsdPrice: cutNumber(outputPrice, 6),
				totalUsdPrice: cutNumber(totalPrice, 6),
				updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
				siteConfigDetailed,
			})
			.where(eq(sites.id, siteId))
			.returning();

		return reply.status(201).send({
			data: {
				...siteData,
				previews: sitePages.map((page) => ({
					html: page.html,
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
				siteConfigDetailed,
			},
			success: true,
		});
	} catch (err) {
		reply.status(500).send({
			error: err.message,
			success: false,
		});
	}
};
