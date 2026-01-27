// utils/archiveProcessor.js
import AdmZip from 'adm-zip';
import { randomBytes } from 'crypto';
import path from 'path';
import slugify from 'slugify';
import { supabase } from '../db/connection.js';

// Required files for web template
const REQUIRED_FILES = ['index.njk', 'styles.scss', 'definition.json'];

const ALLOWED_EXTENSIONS = ['.zip'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate archive file
 */
export function validateArchive(buffer, mimetype, originalName) {
	// Check MIME type
	if (!mimetype.includes('zip') && !mimetype.includes('x-zip-compressed')) {
		throw new Error('Invalid archive format. Only ZIP files are allowed');
	}

	// Check file extension
	const ext = path.extname(originalName).toLowerCase();
	if (!ALLOWED_EXTENSIONS.includes(ext)) {
		throw new Error(`Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
	}

	// Check file size
	if (buffer.length > MAX_FILE_SIZE) {
		throw new Error(`Archive too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
	}

	return true;
}

/**
 * Validate specific file content
 */
async function validateFileContent(filename, buffer) {
	const content = buffer.toString('utf-8');

	switch (filename) {
		case 'definition.json':
			try {
				JSON.parse(content);
			} catch (error) {
				if (error.name === 'SyntaxError') {
					throw new Error(`File ${filename} contains invalid JSON: ${error.message}`);
				}
				throw new Error(`File ${filename} validation failed: ${error.message}`);
			}
			break;

		case 'index.njk':
			if (content.trim().length === 0) {
				throw new Error(`File ${filename} cannot be empty`);
			}

			// Basic HTML validation
			if (!content.includes('<') && !content.includes('>')) {
				throw new Error(`File ${filename} does not appear to be valid HTML`);
			}
			break;

		case 'styles.scss':
			const trimmedContent = content.trim();

			if (trimmedContent.length === 0) {
				throw new Error(`File ${filename} cannot be empty`);
			}
			const startsWithId = trimmedContent.startsWith('#_blockId');
			const endsWithBrace = trimmedContent.endsWith('}');

			if (!startsWithId || !endsWithBrace) {
				throw new Error(
					`Style validation error: The ${filename} file must start with #blockId { and end with }`,
				);
			}

			let braceCount = 0;
			let opened = false;
			let validEncapsulation = true;

			for (let i = 0; i < trimmedContent.length; i++) {
				const char = trimmedContent[i];
				if (char === '{') {
					braceCount++;
					opened = true;
				} else if (char === '}') {
					braceCount--;
				}
				if (opened && braceCount === 0 && i < trimmedContent.length - 1) {
					validEncapsulation = false;
					break;
				}
			}

			if (!validEncapsulation || braceCount !== 0) {
				throw new Error(
					`Style validation error: All styles in ${filename} must be nested INSIDE the #_blockId { ... } selector. Found code outside the main block.`,
				);
			}
			break;

		default:
			throw new Error(`Unexpected file in validation: ${filename}`);
	}
}

/**
 * Extract and validate archive contents
 */
export async function extractAndValidate(buffer) {
	try {
		const zip = new AdmZip(buffer);
		const zipEntries = zip.getEntries();

		// Get file list from archive
		const fileList = zipEntries
			.filter((entry) => !entry.isDirectory)
			.map((entry) => entry.entryName);

		// Check for required files
		const missingFiles = REQUIRED_FILES.filter(
			(requiredFile) => !fileList.includes(requiredFile),
		);

		if (missingFiles.length > 0) {
			throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
		}

		// Extract and validate file contents
		const extractedFiles = {};

		for (const requiredFile of REQUIRED_FILES) {
			const entry = zipEntries.find((e) => e.entryName === requiredFile);
			if (entry) {
				const fileBuffer = entry.getData();

				// Validate file content
				await validateFileContent(requiredFile, fileBuffer);

				extractedFiles[requiredFile] = {
					buffer: fileBuffer,
					size: entry?.header?.size,
					name: requiredFile,
					content: fileBuffer.toString('utf-8'),
				};
			}
		}

		return {
			isValid: true,
			files: extractedFiles,
			fileList,
			fileCount: fileList.length,
			totalSize: buffer.length,
		};
	} catch (error) {
		throw new Error(`Archive processing failed: ${error.message}`);
	}
}

/**
 * Generate unique archive filename
 */
export function generateArchiveName(originalName) {
	const randomId = randomBytes(8).toString('hex');
	const ext = path.extname(originalName) || '.zip';
	const cleanName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '_');
	return `template_${cleanName}_${randomId}${ext}`;
}

/**
 * Get file information for database
 */
export function getFileStats(files) {
	const stats = {};

	for (const [filename, fileData] of Object.entries(files)) {
		stats[filename] = {
			size: fileData.size,
			lines: fileData.content.split('\n').length,
			characters: fileData.content.length,
		};
	}

	return stats;
}

/**
 * Parse definition.json and add defaults
 */
export function parseTemplateDefinition(definitionContent, fallbackName) {
	try {
		const definition = JSON.parse(definitionContent);

		return {
			description: definition.description || '',
			preview: definition.preview || null,
		};
	} catch (error) {
		throw new Error(`Failed to parse template definition: ${error.message}`);
	}
}

/**
 * Create complete block definition for database
 */
export async function createBlockDefinition(archiveBuffer, fileData, extractedFiles, name) {
	return {
		originalArchive: {
			filename: fileData.filename,
			mimeType: fileData.mimetype,
			size: archiveBuffer.length,
		},
	};
}

/**
 * Quick validation without full extraction (for initial checks)
 */
export async function quickValidate(buffer) {
	try {
		const zip = new AdmZip(buffer);
		const entries = zip.getEntries();
		const fileList = entries
			.filter((entry) => !entry.isDirectory)
			.map((entry) => entry.entryName);

		const missingFiles = REQUIRED_FILES.filter((file) => {
			return !fileList.includes(file);
		});

		return {
			isValid: missingFiles.length === 0,
			missingFiles,
			totalFiles: fileList.length,
			fileList,
		};
	} catch (error) {
		return {
			isValid: false,
			error: error.message,
			missingFiles: REQUIRED_FILES,
			totalFiles: 0,
			fileList: [],
		};
	}
}

// Export constants for external use
export const archiveConstants = {
	REQUIRED_FILES,
	ALLOWED_EXTENSIONS,
	MAX_FILE_SIZE,
};

// Default export for backward compatibility
export default {
	validateArchive,
	extractAndValidate,
	generateArchiveName,
	constants: archiveConstants,
};

export const replaceSiteZipWithNew = async (sitePages, siteName, existingArchiveUrl) => {
	const zip = new AdmZip();
	sitePages.forEach((page) => {
		zip.addFile(page.filename, Buffer.from(page.html, 'utf8'));
	});
	const zipBuffer = zip.toBuffer();

	const safeName = slugify(`site-${siteName}-${new Date().getTime()}.zip`, {
		lower: true,
		strict: true,
	});

	const { error: uploadError } = await supabase.storage
		.from('sites')
		.upload(safeName, zipBuffer, {
			contentType: 'application/zip',
		});

	if (uploadError) {
		throw uploadError;
	}

	// const oldArchiveName = existingArchiveUrl?.split('/').pop();
	// if (oldArchiveName) {
	// 	await supabase.storage.from('sites').remove([oldArchiveName]);
	// }

	const { data: urlData } = supabase.storage.from('sites').getPublicUrl(safeName);

	return urlData;
};
