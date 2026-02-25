import AdmZip from 'adm-zip';
import { randomBytes } from 'crypto';
import path from 'path';
import slugify from 'slugify';
import { supabase } from '../db/connection.js';
import nunjucks from 'nunjucks';

// Required files for web template
const REQUIRED_FILES = ['definition.json', 'index.njk', 'styles.scss'];
const ALLOWED_KEYS = {
	text: ['type', 'value'],
	image: ['type', 'href', 'alt'],
	link: ['type', 'href', 'value', 'label'],
	array: ['type', 'values'],
	nav: ['type', 'value'],
	anchor: ['type', 'href', 'label'],
	anchors: ['type', 'value'],
};

const ALLOWED_EXTENSIONS = ['.zip'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate archive file
 */
export function validateArchive(buffer, mimetype, originalName) {
	if (!mimetype.includes('zip') && !mimetype.includes('x-zip-compressed')) {
		throw new Error('Invalid archive format. Only ZIP files are allowed');
	}

	const ext = path.extname(originalName).toLowerCase();
	if (!ALLOWED_EXTENSIONS.includes(ext)) {
		throw new Error(`Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
	}

	if (buffer.length > MAX_FILE_SIZE) {
		throw new Error(`Archive too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
	}

	return true;
}

function validateField(key, field) {
	const type = field.type;

	if (!type || typeof type !== 'string') {
		throw new Error(`Field with name "${key}" has empty or invalid type`);
	}

	const allowed = ALLOWED_KEYS[type];
	if (allowed) {
		Object.keys(field).forEach((fKey) => {
			if (!allowed.includes(fKey)) {
				throw new Error(
					`Field "${key}" (type: ${type}) contains forbidden property: "${fKey}"`,
				);
			}
		});
	}

	switch (type) {
		case 'text':
			if (typeof field.value !== 'string') {
				throw new Error(`Field "${key}" must have "value"`);
			}
			break;
		case 'image':
			if (typeof field.href !== 'string' || typeof field.alt !== 'string') {
				throw new Error(`Field "${key}" must have "href" and "alt"`);
			}
			break;
		case 'link':
			if (typeof field.href !== 'string' || typeof field.label !== 'string') {
				throw new Error(`Field "${key}" must have "href" and "label"`);
			}
			break;
		case 'nav':
			if (!Array.isArray(field.value)) {
				throw new Error(`Field "${key}" must have "value" as an array`);
			}
			break;
		case 'anchor':
			if (typeof field.href !== 'string' || typeof field.label !== 'string') {
				throw new Error(`Field "${key}" must have "href" and "label"`);
			}
			break;
		case 'anchors':
			if (!Array.isArray(field.value)) {
				throw new Error(`Field "${key}" must have "value" as an array`);
			}
			break;
		case 'array':
			if (!Array.isArray(field.values)) {
				throw new Error(`Field "${key}" must have "values" as an array`);
			}
			if (field.values.length === 0) {
				throw new Error(`Field "${key}" must contain at least one item in "values"`);
			}
			field.values.forEach((item, index) => {
				Object.keys(item).forEach((subKey) => {
					validateField(`${subKey} in ${key}.variables[${index}]`, item[subKey]);
				});
			});
			break;
		default:
			throw new Error(`Unknown type - ${type} in ${key}`);
	}
}

function validateDefinition(content) {
	const variables = content.variables;
	Object.keys(variables).forEach((key) => {
		validateField(key, variables[key]);
	});
}

async function validateFileContent(filename, buffer, variables = null) {
	const content = buffer.toString('utf-8');
	switch (filename) {
		case 'definition.json':
			try {
				const parsedContent = JSON.parse(content);
				validateDefinition(parsedContent);
				return parsedContent.variables;
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

			if (!content.includes('<') && !content.includes('>')) {
				throw new Error(`File ${filename} does not appear to be valid HTML`);
			}
			const env = new nunjucks.Environment(null, {
				throwOnUndefined: true,
			});
			try {
				env.renderString(content, {
					...variables,
					_blockId: 0,
				});
			} catch (error) {
				throw new Error(`Template has errors: ${error.message}`);
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

export async function extractAndValidate(buffer) {
	try {
		const zip = new AdmZip(buffer);
		const zipEntries = zip.getEntries();

		const fileList = zipEntries
			.filter((entry) => !entry.isDirectory)
			.map((entry) => entry.entryName);

		const missingFiles = REQUIRED_FILES.filter(
			(requiredFile) => !fileList.includes(requiredFile),
		);

		if (missingFiles.length > 0) {
			throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
		}

		const extractedFiles = {};

		const defEntry = zipEntries.find((e) => e.entryName === 'definition.json');
		const defBuffer = defEntry.getData();
		const defVariables = await validateFileContent('definition.json', defBuffer);

		extractedFiles['definition.json'] = {
			buffer: defBuffer,
			size: defEntry.header.size,
			name: 'definition.json',
			content: defBuffer.toString('utf-8'),
		};

		for (const requiredFile of REQUIRED_FILES) {
			if (requiredFile == 'definition.json') {
				continue;
			}
			const entry = zipEntries.find((e) => e.entryName === requiredFile);
			if (entry) {
				const fileBuffer = entry.getData();

				await validateFileContent(requiredFile, fileBuffer, defVariables);

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

export function generateArchiveName(originalName) {
	const randomId = randomBytes(8).toString('hex');
	const ext = path.extname(originalName) || '.zip';
	const cleanName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '_');
	return `template_${cleanName}_${randomId}${ext}`;
}


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

export const archiveConstants = {
	REQUIRED_FILES,
	ALLOWED_EXTENSIONS,
	MAX_FILE_SIZE,
};

export default {
	validateArchive,
	extractAndValidate,
	generateArchiveName,
	constants: archiveConstants,
};

export const replaceSiteZipWithNew = async (
	sitePages,
	siteName,
	existingArchiveUrl,
	zip,
	sitemapXml,
	sitemapError,
	nginxConfig,
) => {
	const zipEntries = zip.getEntries();

	zipEntries.forEach((entry) => {
		const isImageFolder = entry.entryName.startsWith('images/');
		if (!isImageFolder) {
			zip.deleteFile(entry.entryName);
		}
	});

	sitePages.forEach((page) => {
		zip.addFile(page.filename, Buffer.from(page.html, 'utf8'));
	});

	if (!sitemapError) {
		zip.addFile('sitemap.xml', Buffer.from(sitemapXml, 'utf8'));
	}

	if (nginxConfig) {
		zip.addFile('nginx.conf', Buffer.from(nginxConfig, 'utf8'));
	}

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

	const oldArchiveName = existingArchiveUrl?.split('/').pop();
	if (oldArchiveName) {
		await supabase.storage.from('sites').remove([oldArchiveName]);
	}

	const { data: urlData } = supabase.storage.from('sites').getPublicUrl(safeName);

	return urlData;
};

export const filteredZip = async (archiveUrl, page, blockGenerationBlockId) => {
	try {
		const response = await fetch(archiveUrl);
		if (!response.ok) throw new Error(`Fetch error: ${response.statusText}`);

		const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
		let targetBlock = null;
		targetBlock = page.blocks.find((b) => b.generationBlockId === blockGenerationBlockId);

		if (!targetBlock) {
			throw new Error(`No block with id - ${blockGenerationBlockId}.`);
		}

		const imagePaths = [];

		function findStringsWithImages(obj) {
			if (!obj) return;
			if (typeof obj === 'string') {
				if (obj.includes('images/')) {
					const cleanPath = obj.replace(/^(\.\/|\/)/, '');
					imagePaths.push(cleanPath);
				}
			} else if (typeof obj === 'object') {
				for (const key in obj) {
					findStringsWithImages(obj[key]);
				}
			}
		}

		findStringsWithImages(targetBlock.variables);

		imagePaths.forEach((path) => {
			const entry = zip.getEntry(path);
			if (entry) {
				zip.deleteFile(entry);
			}
		});

		return zip;
	} catch (e) {
		throw new Error(e);
	}
};
