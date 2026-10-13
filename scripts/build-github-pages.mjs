import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.pages-dist');
const hostedSite = 'https://tok-accessories-mvp.peppyzebra64.chatgpt.site';

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'public'), output, { recursive: true });

let html = await readFile(join(root, 'web', 'index.html'), 'utf8');
html = html
  .replace('href="/admin"', `href="${hostedSite}/admin"`)
  .replace(
    '</head>',
    `<link rel="canonical" href="${hostedSite}/">\n</head>`,
  );
await writeFile(join(output, 'index.html'), html);

const products = JSON.parse(await readFile(join(root, 'db', 'seed.json'), 'utf8'));
await writeFile(join(output, 'catalog.json'), JSON.stringify({ products }));

const appPath = join(output, 'app.js');
let app = await readFile(appPath, 'utf8');
app = app
  .replace(
    "imageURL=p=>p.image.startsWith('assets/')?'/'+p.image:p.image;",
    "imageURL=p=>p.image.startsWith('assets/')?p.image:p.image;",
  )
  .replace(
    "fetch('/api/catalog',{cache:'no-store'})",
    "fetch('catalog.json',{cache:'no-store'})",
  );

if (!app.includes("fetch('catalog.json',{cache:'no-store'})")) {
  throw new Error('GitHub Pages catalog adaptation was not applied');
}
await writeFile(appPath, app);
await writeFile(join(output, '.nojekyll'), '');

console.log(`GitHub Pages bundle created at ${output}`);
