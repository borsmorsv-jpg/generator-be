import { db, supabase } from '../../db/connection.js';
import { blocks, templates, sites, profiles } from '../../db/schema.js';
import { and, asc, count, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import AdmZip from 'adm-zip';
import { alias } from 'drizzle-orm/pg-core';
import { generateAIContent } from '../../utils/aiContentGenerator.js';
import { downloadAndUnzipBlock } from '../../utils/zipHandler.js';
import JSZip from 'jszip';
import { PRICE_FOR_PROMPTS } from '../../config/constants.js';

function cutNumber(number, amountAfterDot) {
	const factor = 10 ** amountAfterDot;
	return Math.floor(number * factor) / factor;
}

function fillVariables(html, aiContent) {
	let filledHtml = html;

	Object.keys(aiContent).forEach((varName) => {
		const varData = aiContent[varName];

		Object.keys(varData).forEach((prop) => {
			if (varData[prop] !== null) {
				const placeholder = `\${variables.${varName}.${prop}}`;
				filledHtml = filledHtml.replaceAll(placeholder, varData[prop]);
			}
		});
	});

	return filledHtml;
}

function applyThemeToCss(originalCss, themeVariables) {
	if (!themeVariables || Object.keys(themeVariables).length === 0) {
		return originalCss;
	}

	let updatedCss = originalCss;

	const rootMatch = updatedCss.match(/:root\s*\{[\s\S]*?\}/);

	if (rootMatch) {
		Object.entries(themeVariables).forEach(([varName, value]) => {
			const regex = new RegExp(`${varName}\\s*:[^;]*;`, 'g');
			const newDeclaration = `${varName}: ${value};`;

			if (updatedCss.includes(varName)) {
				updatedCss = updatedCss.replace(regex, newDeclaration);
			} else {
				updatedCss = updatedCss.replace(/:root\s*\{/, `:root {\n  ${newDeclaration}`);
			}
		});
	} else {
		let newRoot = ':root {\n';
		Object.entries(themeVariables).forEach(([varName, value]) => {
			newRoot += `  ${varName}: ${value};\n`;
		});
		newRoot += '}\n\n';
		updatedCss = newRoot + updatedCss;
	}

	return updatedCss;
}

function generateMetaTags(metaObject) {
	if (!metaObject) return '';

	return Object.entries(metaObject)
		.map(([key, value]) => {
			if (!value) return '';
			if (key.toLowerCase() === 'title') {
				return `<title>${value}</title>`;
			}
			if (key.toLowerCase() === 'canonical') {
				return `<link rel="canonical" href="${value}" />`;
			}
			if (key.startsWith('og_')) {
				const property = key.replace('_', ':');
				return `<meta property="${property}" content="${value}">`;
			}
			return `<meta name="${key}" content="${value}">`;
		})
		.join('\n  ');
}

export const createSite = async (request, reply) => {
	try {
		const { prompt, templatesIds, isActive, name, trafficSource, country, language } =
			request.body;

		const template = await db.query.templates.findFirst({
			where: eq(templates.id, templatesIds[0]),
		});

		if (!template || !template.definition?.blocks) {
			return reply.status(404).send({ error: 'Template not found' });
		}

		let allStyles = '';
		let allHtml = '';
		let tokensInfo;

		let allThemeVariables = {};
		let metaTags = '';

		for (const blockDef of template.definition.blocks) {
			const blocksOfType = await db
				.select()
				.from(blocks)
				.where(eq(blocks.category, blockDef.type));

			if (blocksOfType.length > 0) {
				const randomBlock = blocksOfType[Math.floor(Math.random() * blocksOfType.length)];
				const blockData = await downloadAndUnzipBlock(randomBlock.archiveUrl);

				const [aiContent, tokens] = await generateAIContent(
					prompt,
					blockData.definition.variables,
					blockDef.type,
					country,
					language,
				);
				tokensInfo = tokens;
				console.log('AI Content:', JSON.stringify(aiContent, null, 2));

				const themeVariables = aiContent.theme || {};

				allThemeVariables = { ...allThemeVariables, ...themeVariables };

				const contentForHtml = { ...aiContent };
				delete contentForHtml.theme;

				const filledHtml = fillVariables(blockData.html, contentForHtml);
				allHtml += filledHtml + '\n';

				const updatedCss = applyThemeToCss(blockData.css, themeVariables);
				allStyles += updatedCss + '\n';
				metaTags = generateMetaTags(aiContent.meta);
			}
		}

		let finalStyles = '';
		if (Object.keys(allThemeVariables).length > 0) {
			finalStyles += ':root {\n';
			Object.entries(allThemeVariables).forEach(([varName, value]) => {
				finalStyles += `  ${varName}: ${value};\n`;
			});
			finalStyles += '}\n\n';
		}
		finalStyles += allStyles;

		const generatedSite = `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${metaTags}
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    ${finalStyles}
  </style>
</head>
<body>
${allHtml}
</body>
</html>`;

		const zip = new AdmZip();
		zip.addFile('index.html', Buffer.from(generatedSite, 'utf8'));

		const zipBuffer = zip.toBuffer();
		const fileName = `site-${name}-${new Date().getTime()}.zip`;
		const { data, error } = await supabase.storage.from('sites').upload(fileName, zipBuffer, {
			contentType: 'application/zip',
			upsert: false,
		});

		if (error) {
			throw error;
		}

		const inputPrice = tokensInfo.promptTokens * (PRICE_FOR_PROMPTS.input / 1000000);
		const outputPrice = tokensInfo.completionTokens * (PRICE_FOR_PROMPTS.output / 1000000);

		const totalPrice = inputPrice + outputPrice;

		const { data: urlData } = supabase.storage.from('sites').getPublicUrl(fileName);

		console.log('urlData.publicUrl', urlData.publicUrl);

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
				completionTokens: tokensInfo.completionTokens,
				promptTokens: tokensInfo.promptTokens,
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
				preview: generatedSite,
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
		const previewFile = zip.file('index.html');
		let preview;
		if (previewFile) {
			preview = await previewFile.async('string');
		}

		reply.send({
			success: true,
			data: {
				...site,
				preview,
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
