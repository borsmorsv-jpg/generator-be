import { db, supabase } from '../../db/connection.js';
import { blocks, profiles, sites, templates } from '../../db/schema.js';
import { and, asc, count, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import AdmZip from 'adm-zip';
import { alias } from 'drizzle-orm/pg-core';
import JSZip from 'jszip';
import { PRICE_FOR_PROMPTS_OPENAI } from '../../config/constants.js';
import slugify from 'slugify';
import {
	buildSitePages,
	getBlockByType,
	prepareBlock,
	prepareGlobalBlocks,
} from '../../utils/blocks.js';
import { filteredZip, replaceSiteZipWithNew } from '../../utils/archiveProcessor.js';
import { generateNginxConfig, generateSite, generateSitemapXml } from '../../utils/generator.js';
import Decimal from 'decimal.js';

function cutNumber(number, amountAfterDot) {
	const safeNumber = number ?? 0;
	const safePrecision = amountAfterDot ?? 0;
	return new Decimal(safeNumber).toDecimalPlaces(safePrecision, Decimal.ROUND_DOWN).toNumber();
}

export const createSite = async (request, reply) => {
	try {
		const { prompt, templateId, isActive, name, trafficSource, country, language, domain } =
			request.body;

		const template = await db.query.templates.findFirst({
			where: eq(templates.id, templateId),
		});

		if (!template) {
			return reply.status(404).send({ error: 'Template not found' });
		}

		const currentTokens = {
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalTokens: 0,
			totalFalCost: 0,
		};

		const zip = new AdmZip();
		const { tokens, siteConfig, sitePages, siteConfigDetailed, previews } = await generateSite({
			currentTokens,
			template,
			prompt,
			country,
			language,
			zip,
		});

		let tempDomain = 'http://localhost:3000';
		const { siteMapBody, hasError: sitemapError } = generateSitemapXml(sitePages, tempDomain);
		const nginxConfig = generateNginxConfig({ serverName: domain });

		// const zip = new AdmZip();
		sitePages.forEach((page) => {
			zip.addFile(page.filename, Buffer.from(page.html, 'utf8'));
		});

		if (!sitemapError) {
			zip.addFile('sitemap.xml', Buffer.from(siteMapBody, 'utf8'));
		}

		if (nginxConfig) {
			zip.addFile('nginx.conf', Buffer.from(nginxConfig, 'utf8'));
		}

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
				totalFalPrice: tokens.totalFalCost,
				totalTokens: tokens.totalTokens,
				completionTokens: tokens.totalCompletionTokens,
				siteConfigDetailed: siteConfigDetailed,
				promptTokens: tokens.totalPromptTokens,
				inputUsdPrice: cutNumber(tokens.openAiInputPrice, 6),
				outputUsdPrice: cutNumber(tokens.openAiOutputPrice, 6),
				totalUsdPrice: cutNumber(tokens.openAiTotalPrice, 6),
				createdBy: '67366103-2833-41a8-aea2-10d589a0705c',
				updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
			})
			.returning();

		return reply.status(201).send({
			data: {
				...siteData,
				previews,
				siteConfig,
				siteConfigDetailed,
			},
			success: true,
		});
	} catch (error) {
		console.log('error', error);
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
			trafficSource,
			country,
			language,
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

		if (searchByName) filters.push(ilike(sites.name, `%${searchByName}%`));
		if (searchById) {
			filters.push(sql`CAST(${sites.id} AS TEXT) ILIKE ${'%' + searchById + '%'}`);
		}
		if (createdBy) filters.push(eq(sites.createdBy, createdBy));
		if (updatedBy) filters.push(eq(sites.updatedBy, updatedBy));

		if (trafficSource) filters.push(eq(sites.trafficSource, trafficSource));
		if (country) filters.push(eq(sites.country, country));
		if (language) filters.push(eq(sites.language, language));

		if (createdAtFromDate) filters.push(gte(sites.createdAt, createdAtFromDate));
		if (createdAtToDate) filters.push(lte(sites.createdAt, createdAtToDate));
		if (updatedAtFromDate) filters.push(gte(sites.updatedAt, updatedAtFromDate));
		if (updatedAtToDate) filters.push(lte(sites.updatedAt, updatedAtToDate));

		if (createdByUserId) filters.push(lte(sites.createdBy, createdByUserId));
		if (updatedByUserId) filters.push(lte(sites.updatedBy, updatedByUserId));

		if (isActive === 'true') {
			filters.push(eq(sites.isActive, true));
		} else if (isActive === 'false') {
			filters.push(eq(sites.isActive, false));
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
				totalFalPrice: sites.totalFalPrice,
				language: sites.language,
				trafficSource: sites.trafficSource,
				country: sites.country,
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

		const sitePages = buildSitePages(
			site.siteConfigDetailed.pages,
			site.siteConfigDetailed.generatedTheme,
			site.language,
			site.country,
		);


		reply.send({
			success: true,
			data: {
				...site,
				previews: sitePages.map((page) => ({
					html: page.previewHtml,
					filename: page.filename,
					hasErrors: page.pageHasErrors,
				})),
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

		const { prompt } = request.body;

		const currentTokens = {
			totalPromptTokens: site.promptTokens,
			totalCompletionTokens: site.completionTokens,
			totalTokens: site.totalTokens,
			totalFalCost: site.totalFalPrice,
		};

		const template = await db.query.templates.findFirst({
			where: eq(templates.id, site.definition),
		});

		if (!template) {
			return reply.status(404).send({ error: 'Template not found' });
		}

		const zip = new AdmZip();
		const { tokens, siteConfig, sitePages, siteConfigDetailed, previews } = await generateSite({
			currentTokens,
			template,
			prompt,
			country: site.country,
			language: site.language,
			zip
		});

		const { siteMapBody, hasError: sitemapError } = generateSitemapXml(sitePages, site.domain);
		const nginxConfig = generateNginxConfig({ serverName: site.domain });

		sitePages.forEach((page) => {
			zip.addFile(page.filename, Buffer.from(page.html, 'utf8'));
		});

		if (!sitemapError) {
			zip.addFile('sitemap.xml', Buffer.from(siteMapBody, 'utf8'));
		}

		const urlData = await replaceSiteZipWithNew(sitePages, site.name, site.archiveUrl, zip, siteMapBody, sitemapError, nginxConfig);

		const [siteData] = await db
			.update(sites)
			.set({
				archiveUrl: urlData.publicUrl,
				prompt: prompt,
				totalTokens: tokens.totalTokens,
				completionTokens: tokens.totalCompletionTokens,
				siteConfigDetailed: siteConfigDetailed,
				promptTokens: tokens.totalPromptTokens,
				totalFalPrice: tokens.totalFalCost,
				inputUsdPrice: cutNumber(tokens.openAiInputPrice, 6),
				outputUsdPrice: cutNumber(tokens.openAiOutputPrice, 6),
				totalUsdPrice: cutNumber(tokens.openAiTotalPrice, 6),
				updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
			})
			.where(eq(sites.id, siteId))
			.returning();

		return reply.status(200).send({
			data: {
				...siteData,
				previews,
				siteConfig,
				siteConfigDetailed,
			},
			success: true,
		});
	} catch (err) {
		console.log("err", err)
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
			totalFalCost: site.totalFalPrice,
		};

		let generatedBlock;

		const regeneratingPage = site.siteConfigDetailed?.pages.find(
			(page) => page.filename === pageName,
		);
		const currentSiteZip = await filteredZip(
			site.archiveUrl,
			regeneratingPage,
			generationBlockId,
		);

		if (isBlockGlobal) {
			const [preparedBlock] = await prepareGlobalBlocks(
				[block],
				site.siteConfigDetailed?.pages,
				site.prompt || prompt,
				site.country,
				site.language,
				currentSiteZip
			);

			tokensInfo.totalPromptTokens += preparedBlock.tokens.promptTokens;
			tokensInfo.totalCompletionTokens += preparedBlock.tokens.completionTokens;
			tokensInfo.totalTokens += preparedBlock.tokens.totalTokens;
			tokensInfo.totalFalCost += preparedBlock.tokens.totalFalCost;
			generatedBlock = preparedBlock;
		} else {
			const preparedBlock = await prepareBlock(
				block,
				site.prompt || prompt,
				site.country,
				site.language,
				null,
				currentSiteZip
			);

			tokensInfo.totalPromptTokens += preparedBlock.tokens.promptTokens;
			tokensInfo.totalCompletionTokens += preparedBlock.tokens.completionTokens;
			tokensInfo.totalTokens += preparedBlock.tokens.totalTokens;
			tokensInfo.totalFalCost += preparedBlock.tokens.totalFalCost;

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
						generationBlockId: `${generatedBlock.category}-${blockIndex}`,
						definition: generatedBlock.definition,
						variables: generatedBlock.variables,
						hasError: false,
						css: generatedBlock.css,
						html: generatedBlock.html,
					};
				}),
			};
		});

		// console.log("site.siteConfigDetailed.seoPages", site.siteConfigDetailed.seoPages)

		const sitePages = buildSitePages(
			updatedPages,
			site.siteConfigDetailed.generatedTheme,
			site.language,
			site.country,
			// site.siteConfigDetailed.seoPages,
		);

		const { siteMapBody, hasError: sitemapError } = generateSitemapXml(sitePages, site.domain);

		const nginxConfig = generateNginxConfig({ serverName: site.domain });

		const urlData = await replaceSiteZipWithNew(sitePages, site.name, site.archiveUrl, currentSiteZip, siteMapBody, sitemapError, nginxConfig);

		const siteConfigDetailed = {
			pages: sitePages?.map((page) => ({
				title: page.title,
				path: page.path,
				filename: page.filename,
				blocks: page.blocks,
			})),
			generatedTheme: site.siteConfigDetailed.generatedTheme,
			// seoPages: site.siteConfigDetailed.seoPages,
		};
		const inputPrice =
			tokensInfo.totalPromptTokens * (PRICE_FOR_PROMPTS_OPENAI.input / 1000000);
		const outputPrice =
			tokensInfo.totalCompletionTokens * (PRICE_FOR_PROMPTS_OPENAI.output / 1000000);
		const totalPrice = inputPrice + outputPrice;

		const [siteData] = await db
			.update(sites)
			.set({
				archiveUrl: urlData.publicUrl,
				totalTokens: tokensInfo.totalTokens,
				completionTokens: tokensInfo.totalCompletionTokens,
				promptTokens: tokensInfo.totalPromptTokens,
				totalFalPrice: tokensInfo.totalFalCost,
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
				siteConfigDetailed,
			},
			success: true,
		});
	} catch (err) {
		console.log("error", err);
		reply.status(500).send({
			error: err.message,
			success: false,
		});
	}
};
