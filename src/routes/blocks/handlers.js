import { blocks, profiles, templates } from '../../db/schema.js';
import { db, supabase } from '../../db/connection.js';
import archiveProcessor from '../../utils/archiveProcessor.js';
import { asc, gte, lte, desc, eq, ilike, count, and, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import JSZip from 'jszip';

export const getAllBlocks = async (request, reply) => {
	try {
		const {
			page = 1,
			limit = 20,
			searchByName = '',
			searchById = '',
			sortBy = 'createdAt',
			sortOrder = 'desc',
			category,
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
		if (category) filters.push(eq(blocks.category, category));
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
				id: blocks.id,
				name: blocks.name,
				category: blocks.category,
				isActive: blocks.isActive,
				archiveUrl: blocks.archiveUrl,
				definition: blocks.definition,
				createdAt: blocks.createdAt,
				updatedAt: blocks.updatedAt,
				description: blocks.description,
				createdByEmail: createdByProfile.email,
				createdByUsername: createdByProfile.username,
				updatedByEmail: updatedByProfile.email,
				updatedByUsername: updatedByProfile.username,
			})
			.from(blocks)
			.leftJoin(createdByProfile, eq(blocks.createdBy, createdByProfile.userId))
			.leftJoin(updatedByProfile, eq(blocks.updatedBy, updatedByProfile.userId))
			.where(filters.length ? and(...filters) : undefined)
			.orderBy(order(blocks[sortBy]))
			.limit(limit)
			.offset(offset);

		const data = await query;

		const [{ count: totalCount }] = await db
			.select({ count: count() })
			.from(blocks)
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

export const createBlock = async (request, reply) => {
	try {
		const fileData = request.body.file;
		const isActive = request.body.isActive?.value === 'true';
		const name = request.body.name?.value;
		const category = request.body.category?.value;
		const description = request.body.description?.value;

		if (!fileData || !name) {
			return reply.code(400).send({
				success: false,
				message: 'Not all required fields passed',
			});
		}

		const archiveBuffer = fileData._buf || (await fileData.toBuffer());

		archiveProcessor.validateArchive(archiveBuffer, fileData.mimetype, fileData.filename);
		const archiveResult = await archiveProcessor.extractAndValidate(archiveBuffer);

		const archiveFilename = archiveProcessor.generateArchiveName(fileData.filename);

		const { data: uploadData, error: uploadError } = await supabase.storage
			.from('blocks')
			.upload(archiveFilename, archiveBuffer, {
				contentType: 'application/zip',
				upsert: false,
			});

		if (uploadError) {
			throw new Error(`Failed to upload block to file storage: ${uploadError.message}`);
		}

		const { data: urlData } = supabase.storage.from('blocks').getPublicUrl(archiveFilename);

		const archiveUrl = urlData.publicUrl;

		// const definitionContent = archiveResult.files['definition.json'].content;
		// const templateDefinition = JSON.parse(definitionContent);

		const blockDefinition = {
			originalArchive: fileData.filename,
			mimeType: fileData.mimetype,
			archiveSize: archiveBuffer.length,
			// template: {
			// 	name: name,
			// 	description: templateDefinition.description || '',
			// },
			// files: {
			// 	template: {
			// 		size: archiveResult.files['template.html'].size,
			// 		lines: archiveResult.files['template.html'].content.split('\n').length,
			// 	},
			// 	styles: {
			// 		size: archiveResult.files['styles.css'].size,
			// 		lines: archiveResult.files['styles.css'].content.split('\n').length,
			// 	},
			// 	// script: {
			// 	//   size: archiveResult.files["main.js"].size,
			// 	//   lines: archiveResult.files["main.js"].content.split("\n").length,
			// 	// },
			// },
			// validation: {
			// 	isValid: archiveResult.isValid,
			// 	requiredFiles: archiveProcessor.requiredFiles,
			// 	totalFiles: archiveResult.fileCount,
			// 	validatedAt: new Date().toISOString(),
			// },
		};

		const [newBlock] = await db
			.insert(blocks)
			.values({
				name,
				isActive,
				category,
				archiveUrl,
				description,
				definition: blockDefinition,
				createdBy: '67366103-2833-41a8-aea2-10d589a0705c',
			})
			.returning();

		reply.send({
			success: true,
			data: newBlock,
		});
	} catch (error) {
		reply.code(400).send({
			success: false,
			error: error.message,
		});
	}
};

export const deleteBlock = async (request, reply) => {
	try {
		const { id } = request.params;

		if (!id) {
			return reply.code(400).send({
				success: false,
				error: 'Block ID is required',
			});
		}

		const [block] = await db
			.select()
			.from(blocks)
			.where(eq(blocks.id, parseInt(id)));

		if (!block) {
			return reply.code(404).send({
				success: false,
				error: 'Block not found',
			});
		}

		const [deletedBlock] = await db
			.delete(blocks)
			.where(eq(blocks.id, parseInt(id)))
			.returning();

		try {
			if (block.archiveUrl) {
				const urlParts = block.archiveUrl.split('/');
				const filename = urlParts[urlParts.length - 1];

				if (filename) {
					const { error: storageError } = await supabase.storage
						.from('blocks')
						.remove([filename]);

					if (storageError) {
						console.warn(`Failed to delete file from storage: ${storageError.message}`);
					}
				}
			}
		} catch (storageError) {
			console.warn('Error during storage cleanup:', storageError);
		}

		return reply.code(200).send({
			success: true,
			data: deletedBlock,
			message: 'Block deleted successfully',
		});
	} catch (error) {
		return reply.code(400).send({
			success: false,
			error: error.message,
		});
	}
};

export const updateBlock = async (request, reply) => {
	try {
		const { id } = request.params;
		if (!id) {
			return reply.code(400).send({ success: false, error: 'Id is required' });
		}

		const [existing] = await db
			.select()
			.from(blocks)
			.where(eq(blocks.id, Number(id)));

		if (!existing) {
			return reply.code(404).send({ success: false, error: 'Block not found' });
		}

		const fileData = request.body.file;
		const incomingName = request.body.name?.value;
		const description = request.body.description?.value;
		const incomingCategory = request.body.category?.value;
		const incomingIsActiveRaw = request.body.isActive?.value;
		const incomingIsActive =
			incomingIsActiveRaw === undefined ? existing.isActive : incomingIsActiveRaw === 'true';

		const userId = '67366103-2833-41a8-aea2-10d589a0705c';

		const updatePayload = {
			name: incomingName ?? existing.name,
			category: incomingCategory ?? existing.category,
			isActive: incomingIsActive,
			description,
			updatedBy: userId,
			updatedAt: new Date(),
		};

		// If no new file — simple update
		if (!fileData) {
			const [updatedBlock] = await db
				.update(blocks)
				.set(updatePayload)
				.where(eq(blocks.id, Number(id)))
				.returning();
			return reply.code(200).send({ success: true, data: updatedBlock });
		}

		const archiveBuffer = fileData._buf || (await fileData.toBuffer());

		archiveProcessor.validateArchive(archiveBuffer, fileData.mimetype, fileData.filename);

		const newDefinition = {
			originalArchive: fileData.filename,
			mimeType: fileData.mimetype,
			archiveSize: archiveBuffer.length,
		};

		const timestamp = Date.now();
		const safeArchiveFilename = `block_${id}_${timestamp}.zip`;

		const { error: uploadError } = await supabase.storage
			.from('blocks')
			.upload(safeArchiveFilename, archiveBuffer, {
				contentType: 'application/zip',
				upsert: false, // false is OK because filename contains timestamp -> unique
			});

		if (uploadError) {
			throw new Error(`Failed to upload new archive: ${uploadError.message}`);
		}

		const { data: urlData } = supabase.storage.from('blocks').getPublicUrl(safeArchiveFilename);
		const newArchiveUrl = urlData.publicUrl;

		updatePayload.archiveUrl = newArchiveUrl;
		updatePayload.definition = newDefinition;

		let updatedBlock;
		try {
			const [res] = await db
				.update(blocks)
				.set(updatePayload)
				.where(eq(blocks.id, Number(id)))
				.returning();

			updatedBlock = res;
		} catch (dbError) {
			try {
				const { error: cleanupError } = await supabase.storage
					.from('blocks')
					.remove([safeArchiveFilename]);
				if (cleanupError) {
					console.warn(
						'Failed to remove newly uploaded file after DB error:',
						cleanupError.message,
					);
				}
			} catch (cleanupErr) {
				console.warn('Cleanup attempt error:', cleanupErr);
			}
			throw new Error(`DB update failed: ${dbError.message}`);
		}

		try {
			if (existing.archiveUrl) {
				const oldFilename = existing.archiveUrl.split('/').pop();
				if (oldFilename && oldFilename !== safeArchiveFilename) {
					const { error: removeErr } = await supabase.storage
						.from('blocks')
						.remove([oldFilename]);
					if (removeErr) {
						console.warn(
							'Failed to delete old archive from storage:',
							removeErr.message,
						);
					}
				}
			}
		} catch (remErr) {
			console.warn('Error while deleting old archive:', remErr);
		}

		return reply.code(200).send({ success: true, data: updatedBlock });
	} catch (error) {
		return reply.code(400).send({
			success: false,
			error: error.message || String(error),
		});
	}
};

export const getOneBlock = async (request, reply) => {
	try {
		const { blockId } = request.params;

		const [block] = await db
			.select()
			.from(blocks)
			.where(eq(blocks.id, parseInt(blockId)));

		const response = await fetch(block.archiveUrl);

		if (!response.ok) {
			throw new Error(`Failed to download archive: ${response.status}`);
		}

		const zipBuffer = Buffer.from(await response.arrayBuffer());

		const zip = await JSZip.loadAsync(zipBuffer);

		const jsonEntry = Object.values(zip.files).find(
			(file) => !file.dir && file.name.endsWith('.json'),
		);

		if (!jsonEntry) {
			return reply.code(400).send({
				error: 'No JSON file found inside archive',
			});
		}

		const jsonString = await jsonEntry.async('string');
		const definition = JSON.parse(jsonString);

		reply.send({
			success: true,
			...block,
			originalArchive: block.definition?.originalArchive,
			definition,
		});
	} catch (error) {
		reply.code(500).send({
			success: false,
			error: error.message,
		});
	}
};
