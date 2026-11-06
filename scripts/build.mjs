// Builds dist/: one index.html with CSS, JS and fonts inside it, plus the few files a
// browser insists on fetching separately (service worker, manifest, icons).
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

async function fontFaces() {
  const weights = [['Regular', 400], ['Medium', 500], ['SemiBold', 600]];
  const faces = await Promise.all(weights.map(async ([name, weight]) => {
    const b64 = (await readFile(join(src, 'fonts', `IBMPlexSans-${name}.subset.woff2`))).toString('base64');
    return `@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  }));
  return faces.join('');
}

const js = (await build({ entryPoints: [join(src, 'js/ui/main.js')], bundle: true, format: 'iife', minify: true, write: false, target: 'chrome110', charset: 'utf8', legalComments: 'none' })).outputFiles[0].text
  .replace(/<\/script/gi, '<\\/script');
const css = await fontFaces() + (await transform(await readFile(join(src, 'styles/app.css'), 'utf8'), { loader: 'css', minify: true, target: 'chrome110' })).code;

// Runs before first paint, so a saved theme cannot flash the wrong colours.
const themeJs = "try{var t=JSON.parse(localStorage.getItem('vaulment.theme'));if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";

// connect-src 'none' stops page code from making any network request at all, so a bug
// cannot send vault data anywhere. Inline code is allowed only by its exact hash.
const csp = [
  "default-src 'none'",
  `script-src ${sha256(themeJs)} ${sha256(js)}`,
  `style-src ${sha256(css)}`,
  "font-src data:",
  "img-src 'self' blob:",
  "connect-src 'none'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types vaulment',
].join('; ');

const html = (await readFile(join(src, 'index.template.html'), 'utf8'))
  .replace('__CSP__', () => csp)
  .replace('__CSS__', () => css)
  .replace('__THEME_JS__', () => themeJs)
  .replace('__JS__', () => js);

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'icons'), { recursive: true });
await writeFile(join(dist, 'index.html'), html);
const pageHash = createHash('sha256').update(html).digest('hex');
await writeFile(join(dist, 'sw.js'), (await readFile(join(src, 'sw.js'), 'utf8')).replace('__VERSION__', () => `${pkg.version}-${pageHash.slice(0, 10)}`).replace('__PAGE_HASH__', () => pageHash));
await cp(join(src, 'manifest.webmanifest'), join(dist, 'manifest.webmanifest'));
await cp(join(src, 'icons'), join(dist, 'icons'), { recursive: true });
await writeFile(join(dist, '.nojekyll'), '');
console.log(`Built dist/index.html: ${(html.length / 1024).toFixed(1)} KB (js ${(js.length / 1024).toFixed(1)} KB, css+fonts ${(css.length / 1024).toFixed(1)} KB)`);
