import AdmZip from "adm-zip";

export async function downloadAndUnzipBlock(archiveUrl) {
	const response = await fetch(archiveUrl);
	const arrayBuffer = await response.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);

	const zip = new AdmZip(buffer);
	const zipEntries = zip.getEntries();

	const blockData = {};

	zipEntries.forEach((entry) => {
		const content = entry.getData().toString('utf8');

		if (entry.entryName === 'definition.json') {
			blockData.definition = JSON.parse(content);
		} else if (entry.entryName === 'template.html') {
			blockData.html = content;
		} else if (entry.entryName === 'styles.css') {
			blockData.css = content;
		}
	});

	return blockData;
}
