const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const destinationRoot = path.resolve(__dirname, '..', 'app', 'wallet');
const includedEntries = [
  '_headers',
  'css',
  'fonts',
  'images',
  'index.html',
  'js',
  'LICENSE',
  'LICENSE-APACHE',
  'manifest.webmanifest',
  'sw.js'
];

function removeDirectoryIfPresent(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureParentDirectory(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function copyEntry(sourcePath, destinationPath) {
  const sourceStats = fs.statSync(sourcePath);

  if (sourceStats.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true });

    for (const childName of fs.readdirSync(sourcePath)) {
      copyEntry(path.join(sourcePath, childName), path.join(destinationPath, childName));
    }

    return;
  }

  ensureParentDirectory(destinationPath);
  fs.copyFileSync(sourcePath, destinationPath);
}

function syncWallet() {
  removeDirectoryIfPresent(destinationRoot);

  for (const entryName of includedEntries) {
    const sourcePath = path.join(repositoryRoot, entryName);
    const destinationPath = path.join(destinationRoot, entryName);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing wallet asset: ${entryName}`);
    }

    copyEntry(sourcePath, destinationPath);
  }

  console.log(`Synced wallet assets into ${destinationRoot}`);
}

syncWallet();
