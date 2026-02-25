import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.resolve(process.env.FRONTEND_PUBLIC_DIR || 'public');
const keys = ['VITE_API_BASE_URL', 'VITE_LOGROCKET_APP_ID'];
const extensions = new Set(['.html', '.js', '.css']);

const getReplacement = (key) => {
	const value = process.env[key];
	if (!value) {
		console.warn(`[replace-frontend-env] Missing env var ${key}, leaving placeholder`);
		return `__${key}__`;
	}
	return value;
};

const replaceInFile = (filePath) => {
	const ext = path.extname(filePath);
	if (!extensions.has(ext)) return;

	let content = fs.readFileSync(filePath, 'utf8');
	let updated = content;

	for (const key of keys) {
		const placeholder = `__${key}__`;
		if (updated.includes(placeholder)) {
			updated = updated.split(placeholder).join(getReplacement(key));
		}
	}

	if (updated !== content) {
		fs.writeFileSync(filePath, updated, 'utf8');
	}
};

const walk = (dir) => {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(entryPath);
		} else {
			replaceInFile(entryPath);
		}
	}
};

if (!fs.existsSync(publicDir)) {
	console.error('[replace-frontend-env] public/ not found.');
	process.exit(1);
}

walk(publicDir);
console.log('[replace-frontend-env] Done.');
