// Lighthouse with its default mobile profile (simulated slow 4G, 4× CPU slowdown), which
// stands in for a mid-range phone. Pass: first load under 2 seconds.
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const RUNS = 3;
const { server, url } = await serve(4300);
const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
const results = [];
for (let i = 0; i < RUNS; i++) {
  const r = await lighthouse(url, { port: chrome.port, onlyCategories: ['performance', 'accessibility', 'best-practices'], logLevel: 'error' });
  const a = r.lhr.audits;
  results.push({ fcp: a['first-contentful-paint'].numericValue, lcp: a['largest-contentful-paint'].numericValue, tbt: a['total-blocking-time'].numericValue, cls: a['cumulative-layout-shift'].numericValue, score: r.lhr.categories.performance.score * 100, a11y: r.lhr.categories.accessibility.score * 100, bp: r.lhr.categories['best-practices'].score * 100, bytes: a['total-byte-weight'].numericValue });
}
await chrome.kill(); server.close(); server.closeAllConnections();
const worst = (k) => Math.max(...results.map((r) => r[k]));
console.table(results.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
console.log(`Worst first contentful paint ${Math.round(worst('fcp'))} ms, worst largest contentful paint ${Math.round(worst('lcp'))} ms (limit 2000 ms)`);
if (worst('lcp') >= 2000) process.exit(1);
