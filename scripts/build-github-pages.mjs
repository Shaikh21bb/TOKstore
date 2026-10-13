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
  .replaceAll('href="/pos"', `href="${hostedSite}/pos"`)
  .replaceAll('href="/dashboard"', `href="${hostedSite}/dashboard"`)
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
  )
  .replace("navigator.serviceWorker.register('/sw.js')", "navigator.serviceWorker.register('sw.js')");

if (!app.includes("fetch('catalog.json',{cache:'no-store'})")) {
  throw new Error('GitHub Pages catalog adaptation was not applied');
}
await writeFile(appPath, app);
const manifestPath = join(output, 'manifest.webmanifest');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.start_url = './';
manifest.scope = './';
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: icon.src.replace(/^\//, '') }));
manifest.shortcuts = manifest.shortcuts.map((shortcut) => ({ ...shortcut, url: shortcut.url.startsWith('/') ? hostedSite + shortcut.url : shortcut.url }));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const swPath = join(output, 'sw.js');
const sw = (await readFile(swPath, 'utf8')).replace("const CORE=['/','/style.css','/store-plus.css','/app.js','/manifest.webmanifest','/assets/favicon.svg','/assets/hero.svg'];", "const CORE=['./','style.css','store-plus.css','app.js','manifest.webmanifest','assets/favicon.svg','assets/hero.svg'];");
await writeFile(swPath, sw);
await writeFile(join(output, '.nojekyll'), '');

console.log(`GitHub Pages bundle created at ${output}`);
