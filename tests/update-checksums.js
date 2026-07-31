#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestName = 'SHA256SUMS';
const releaseDirectories = new Set(['css', 'fonts', 'images', 'js', 'tools']);
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);

function normalizePath(relativePath) {
	return relativePath.replace(/\\/g, '/');
}

function inReleaseInventory(relativePath) {
	const normalized = normalizePath(relativePath);
	if (!normalized.includes('/')) return true;
	return releaseDirectories.has(normalized.split('/')[0]);
}

function excluded(relativePath) {
	const normalized = normalizePath(relativePath);
	return !inReleaseInventory(normalized) ||
		normalized === manifestName ||
		normalized === 'sha1sum' ||
		/^tests\/harness\/e2e-report-.*\.json$/.test(normalized);
}

function hashContent(relativePath) {
	const data = fs.readFileSync(path.join(root, relativePath));
	if (/\.(?:bat|css|html|js|json|md|svg|txt|webmanifest|ya?ml)$/i.test(relativePath) ||
		relativePath === '.gitignore' ||
		!relativePath.includes('.')) {
		return Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
	}
	return data;
}

function walk(directory) {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
		const absolute = path.join(directory, entry.name);
		const relative = normalizePath(path.relative(root, absolute));
		if (excluded(relative)) continue;
		if (entry.isDirectory()) files.push(...walk(absolute));
		else if (entry.isFile()) files.push(relative);
	}
	return files;
}

const lines = walk(root).sort().map((relativePath) => {
	const digest = crypto.createHash('sha256')
		.update(hashContent(relativePath))
		.digest('hex');
	return `${digest}  ${relativePath}`;
});

fs.writeFileSync(path.join(root, manifestName), lines.join('\n') + '\n');
console.log(`Wrote ${manifestName} with ${lines.length} files`);
