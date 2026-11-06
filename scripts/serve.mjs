// Local static server that gzips like GitHub Pages, under the /vaulment/ path, so that
// tests and Lighthouse see the same conditions as the live site.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

export function serve(port = 4173) {
  return new Promise((resolve) => {
    const state = { offline: false, hits: [] };
    const server = createServer(async (req, res) => {
      state.hits.push(req.url);
      if (state.offline) { req.socket.destroy(); return; }
      const path = new URL(req.url, 'http://x').pathname;
      if (!path.startsWith('/vaulment/')) { res.writeHead(404).end(); return; }
      const rel = normalize(path.slice('/vaulment/'.length) || 'index.html');
      if (rel.startsWith('..')) { res.writeHead(400).end(); return; }
      try {
        const body = await readFile(join(dist, rel));
        const type = TYPES[extname(rel)] ?? 'application/octet-stream';
        const zipped = /text|javascript|manifest/.test(type) && /gzip/.test(req.headers['accept-encoding'] ?? '');
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=600', ...(zipped ? { 'Content-Encoding': 'gzip' } : {}) });
        res.end(zipped ? gzipSync(body) : body);
      } catch {
        res.writeHead(404).end('Not found');
      }
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${port}/vaulment/` }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve(Number(process.env.PORT) || 4173);
  console.log(`Serving ${url}`);
}
