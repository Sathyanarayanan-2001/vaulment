// Draws the app icons with the installed browser, so no image tool is needed.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const glyph = (scale) => `<g transform="translate(256 256) scale(${scale}) translate(-12 -12)" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.500" width="14" height="10" rx="1.500"/><path d="M8.500 10.500V7.500a3.500 3.500 0 017 0v3"/><path d="M12 14.500v2"/></g>`;
const svg = (rx, scale) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rx}" fill="#047857"/>${glyph(scale)}</svg>`;

const browser = await chromium.launch();
for (const [file, size, rx, scale] of [['icon-192.png', 192, 96, 15], ['icon-512.png', 512, 96, 15], ['icon-maskable-512.png', 512, 0, 11]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<!doctype html><style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg(rx, scale)}`);
  await writeFile(new URL(`../src/icons/${file}`, import.meta.url), await page.screenshot({ omitBackground: true }));
  await page.close();
}
await browser.close();
