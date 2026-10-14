import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets')).filter(name => /\.(js|css)$/.test(name)).map(name => `assets/${name}`);
const template = await readFile('public/sw.js', 'utf8');
const hash = createHash('sha256').update(assets.join('|') + template + await readFile('dist/index.html', 'utf8')).digest('hex').slice(0, 12);
const sw = template.replace('migration-shell-v1', `migration-shell-${hash}`).replace('const BUILD_ASSETS = [];', `const BUILD_ASSETS = ${JSON.stringify(assets)};`);
await writeFile('dist/sw.js', sw);
