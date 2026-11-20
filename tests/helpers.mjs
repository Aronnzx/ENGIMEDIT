// Utilità comuni ai test end-to-end (Playwright + Chromium).
// Avvia da solo un piccolo server statico su dist/ (le WebCodecs richiedono http://localhost).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MEDIA = join(ROOT, 'testmedia') + '/';
export const TMP = tmpdir();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

async function startServer() {
  if (process.env.ENGIMEDIT_URL) return process.env.ENGIMEDIT_URL;
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = join(ROOT, 'dist', path === '/' ? 'index.html' : path);
      if (!file.startsWith(join(ROOT, 'dist'))) { res.writeHead(403); return res.end(); }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('404'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  server.unref();
  return `http://localhost:${server.address().port}/index.html`;
}
export const BASE = await startServer();

export async function launch(opts = {}) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1, ...(opts.ctx || {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (m.text().includes('ERR_NAME_NOT_RESOLVED') || m.text().includes('ERR_INTERNET_DISCONNECTED')) return; // Google Fonts senza rete
    errors.push(m.type() + ': ' + m.text());
  });
  return { browser, ctx, page, errors };
}
export function check(cond, msg) { if (!cond) throw new Error('FALLITO: ' + msg); console.log('  ok  ' + msg); }
