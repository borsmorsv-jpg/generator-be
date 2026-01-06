// utils/archiveProcessor.js
import AdmZip from 'adm-zip';
import { randomBytes } from 'crypto';
import path from 'path';

// Required files for web template
const REQUIRED_FILES = [
	'template.html',
	'styles.css',
	// "main.js",
	'build-preview.js',
	'preview.html',
	'definition.json',
];

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
				const parsed = JSON.parse(content);

				// Validate required fields in definition.json
				if (!parsed.name || typeof parsed.name !== 'string') {
					throw new Error('definition.json must contain a "name" field');
				}
			} catch (error) {
				if (error.name === 'SyntaxError') {
					throw new Error(`File ${filename} contains invalid JSON: ${error.message}`);
				}
				throw new Error(`File ${filename} validation failed: ${error.message}`);
			}
			break;

		case 'template.html':
			if (content.trim().length === 0) {
				throw new Error(`File ${filename} cannot be empty`);
			}

			// Basic HTML validation
			if (!content.includes('<') && !content.includes('>')) {
				throw new Error(`File ${filename} does not appear to be valid HTML`);
			}
			break;

		case 'styles.css':
			if (content.trim().length === 0) {
				throw new Error(`File ${filename} cannot be empty`);
			}
			break;

		case 'preview.html':
			if (content.trim().length === 0) {
				// Optional: can be empty
			}
			break;

		case 'build-preview.js':
			if (content.trim().length === 0) {
				// Optional: can be empty
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

		console.log('fileList', fileList);
		console.log('missingFiles', missingFiles);

		if (missingFiles.length > 0) {
			throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
		}

		// Extract and validate file contents
		const extractedFiles = {};

		for (const requiredFile of REQUIRED_FILES) {
			const entry = zipEntries.find((e) => e.entryName === requiredFile);
			console.log('entry =>', entry);
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
	const definitionContent = extractedFiles['definition.json'].content;
	const templateDefinition = parseTemplateDefinition(definitionContent, name);

	const fileStats = getFileStats(extractedFiles);

	return {
		originalArchive: {
			filename: fileData.filename,
			mimeType: fileData.mimetype,
			size: archiveBuffer.length,
		},
		template: templateDefinition,
		files: {
			template: fileStats['template.html'],
			styles: fileStats['styles.css'],
			// script: fileStats["main.js"],
			definition: fileStats['definition.json'],
		},
		validation: {
			isValid: true,
			requiredFiles: REQUIRED_FILES,
			validatedAt: new Date().toISOString(),
		},
		structure: {
			totalFiles: Object.keys(extractedFiles).length,
			totalSize: archiveBuffer.length,
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
			console.log('file ==>', file);
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
	getFileStats,
	parseTemplateDefinition,
	createBlockDefinition,
	quickValidate,
	constants: archiveConstants,
};
