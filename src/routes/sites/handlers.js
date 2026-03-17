import { db } from '../../db/connection.js';
import { profiles, sites, templates } from '../../db/schema.js';
import { and, asc, count, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { GENERATION_STATUS, OPERATION_TYPE } from '../../config/constants.js';
import {
	buildSitePages,
} from '../../utils/blocks.js';
import { Worker } from "worker_threads"
const WORKER_URL = "./src/workers/generatorWorker.js";

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

		const [siteData] = await db
			.insert(sites)
			.values({
				isDraft: true,
				name: name,
				isActive: isActive,
				trafficSource: trafficSource,
				archiveUrl: "",
				country: country,
				language: language,
				domain: domain,
				definition: template.id,
				prompt: prompt,
				totalFalPrice: 0,
				totalTokens: 0,
				completionTokens: 0,
				promptTokens: 0,
				inputUsdPrice: 0,
				outputUsdPrice: 0,
				totalUsdPrice: 0,
				createdBy: '67366103-2833-41a8-aea2-10d589a0705c',
				updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
				status: GENERATION_STATUS.pending,
				operationType: OPERATION_TYPE.create
			})
			.returning();

		const worker = new Worker(WORKER_URL, {
			workerData: {
				process: "create",
				siteId: siteData.id,
				name,
				template,
				prompt, 
				country, 
				language,
				domain
			}
		});

		worker.on("error", async (msg) => {
			await db
			 .update(sites)
			 .set({
				status: GENERATION_STATUS.error,
				errorReason: msg
			 }).where(eq(sites.id, siteData.id));
		})
		return reply.status(201).send({
			siteId: siteData.id,
			success: true,
			status: `Site with id - ${siteData.id} generation started. Wait until the new site is ready`,
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
			trafficSource,
			country,
			language,
			domain,
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
		if (domain) filters.push(ilike(sites.domain, `%${domain}%`));

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
				domain: sites.domain,
				trafficSource: sites.trafficSource,
				country: sites.country,
				totalTokens: sites.totalTokens,
				totalUsdPrice: sites.totalUsdPrice,
				inputUsdPrice: sites.inputUsdPrice,
				outputUsdPrice: sites.outputUsdPrice,
				status: sites.status,
				operationType: sites.operationType,
				errorReason: sites.errorReason,
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


		const hasPages = site.siteConfigDetailed?.pages;
        const isSuccess = site.status !== "error";

        const previews = (isSuccess && hasPages) 
            ? buildSitePages(
                site.siteConfigDetailed.pages,
                site.siteConfigDetailed.generatedTheme,
                site.language,
                site.country
            ).map(({ previewHtml, filename, pageHasErrors }) => ({
                html: previewHtml,
                filename,
                hasErrors: pageHasErrors,
            }))
            : "";

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

export const checkStatusSite = async (request, reply) => {
	try {
		const { siteId } = request.params;

		const [site] = await db
			.select()
			.from(sites)
			.where(eq(sites.id, parseInt(siteId)));

		const operationMessage = {
			create: "Generating site...",
			regenerate_site: "Regenerating site...",
			regenerate_block: "Updating block..."
		}

		let siteData = {
			generationStatus: null,
			generationMessage: null,
			generationError: null
		};

		siteData.generationStatus = site.status
		siteData.generationMessage = operationMessage[site.operationType]

		if(site.status === GENERATION_STATUS.success){
			const sitePages = buildSitePages(
				site.siteConfigDetailed.pages,
				site.siteConfigDetailed.generatedTheme,
				site.language,
				site.country,
			);
			siteData.generationMessage = "Process ended with success"
			siteData.data = {
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
			}
		}
		if(site.status === GENERATION_STATUS.error){
			siteData.generationMessage = "Process failed."
			siteData.generationError = site.errorReason
		}

		reply.send(siteData);
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

		if (site.status === GENERATION_STATUS.pending) {
			return reply.status(400).send({
				success: false,
				error: "Generation already started. Please, wait until it ends." 
			});
		}
		// if (site.status === GENERATION_STATUS.error) {
		// 	return reply.status(400).send({
		// 		success: false,
		// 		error: "The previous site generation failed. Please, check the error details."
		// 	});
		// }
		const { prompt } = request.body;

		const template = await db.query.templates.findFirst({
			where: eq(templates.id, site.definition),
		});

		if (!template) {
			return reply.status(404).send({ error: 'Template not found' });
		}

		await db
				.update(sites)
				.set({
					status: GENERATION_STATUS.pending,
					operationType: OPERATION_TYPE.regenerateSite,
					updatedAt: new Date(),
				})
				.where(eq(sites.id, site.id));

		const worker = new Worker(WORKER_URL, {
			workerData: {
				process: "regenerateSite",
				siteId: site.id,
				template,
				prompt,
				site
			}
		});
		
		worker.on("error", async (msg) => {
			await db
			 .update(sites)
			 .set({
				status: GENERATION_STATUS.error,
				errorReason: msg
			 }).where(eq(sites.id, site.id));
		})
		return reply.status(201).send({
			siteId: site.id,
			success: true,
			status: `Site with id - ${site.id} regeneration started. Wait until the new site is ready`,
		});
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
		if (site.status === GENERATION_STATUS.pending) {
			return reply.status(400).send({
				success: false,
				error: "Generation already started. Please, wait until it ends." 
			});
		}
		if (site.status === GENERATION_STATUS.error) {
			return reply.status(400).send({
				success: false,
				error: "The previous site generation failed. Please, check the error details." 
			});
		}
		await db
				.update(sites)
				.set({
					status: GENERATION_STATUS.pending,
					operationType: OPERATION_TYPE.regenerateBlock,
					updatedAt: new Date(),
				})
				.where(eq(sites.id, site.id));

		const worker = new Worker(WORKER_URL, {
			workerData: {
				process: "regenerateBlock",
				siteId,
				blockType,
				prompt,
				site,
				generationBlockId,
				isBlockGlobal,
				pageName
			}
		});
		
		worker.on("error", async (msg) => {
			await db
			 .update(sites)
			 .set({
				status: GENERATION_STATUS.error,
				errorReason: msg
			 }).where(eq(sites.id, site.id));
		})
		return reply.status(201).send({
			siteId: siteId,
			success: true,
			status: `Site with id - ${siteId} block regeneration started. Wait until the new block is ready`,
		});
	} catch (err) {
		reply.status(500).send({
			error: err.message,
			success: false,
		});
	}
};
