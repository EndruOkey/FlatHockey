import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';

const root = process.cwd();
const distDir = path.join(root, 'client', 'dist');
const releaseDir = path.join(root, 'release');
const outZip = path.join(releaseDir, 'FlatHockey-itch.zip');

function rmSourcemaps(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += rmSourcemaps(full);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.map')) {
      fs.rmSync(full, { force: true });
      removed += 1;
    }
  }
  return removed;
}

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

if (!fs.existsSync(distDir)) {
  throw new Error(`[itch:zip] Missing dist directory: ${distDir}`);
}

fs.mkdirSync(releaseDir, { recursive: true });
if (fs.existsSync(outZip)) fs.rmSync(outZip, { force: true });

const sourcemapsRemoved = rmSourcemaps(distDir);
const fileCount = countFiles(distDir);

await new Promise((resolve, reject) => {
  const output = fs.createWriteStream(outZip);
  const archive = archiver('zip', { zlib: { level: 9 } });
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
  archive.pipe(output);
  archive.directory(distDir, false);
  archive.finalize();
});

const sizeMb = (fs.statSync(outZip).size / (1024 * 1024)).toFixed(2);
console.log(`[itch:zip] Created ${outZip}`);
console.log(`[itch:zip] Files in dist: ${fileCount}`);
console.log(`[itch:zip] Sourcemaps removed: ${sourcemapsRemoved}`);
console.log(`[itch:zip] ZIP size: ${sizeMb} MB`);
