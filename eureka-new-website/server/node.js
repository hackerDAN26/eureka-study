// EUREKA on any Node host (Render, Railway, Fly.io, a VPS, your own computer):
// serves the built website from dist/ and the AI endpoint at /api/ai/*.
//
//   npm run build
//   npm start            → http://localhost:3000 (or $PORT)
//
// Set GROQ_API_KEY in the host's environment variables. Locally, a .env file next to
// package.json also works.
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handleAI } from './ai.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 3000;

// .env for local use (real environment variables win).
const fileEnv = {};
if (existsSync(join(ROOT, '.env')))
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const getEnv = k => process.env[k] ?? fileEnv[k];

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No build found. Run "npm run build" first (most hosts do this in their build step).');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const SECURITY = {
  'cross-origin-opener-policy': 'same-origin-allow-popups', // keeps the Google sign-in popup working
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff'
};

function serveFile(req, res, pathname) {
  let file = normalize(join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) file = join(DIST, 'index.html');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // single-page app
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const immutable = file.includes(`${join(DIST, 'assets')}`);
  res.writeHead(200, {
    ...SECURITY,
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

async function serveAI(req, res) {
  const proto = (req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http';
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${PORT}`).split(',')[0].trim();
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const request = new Request(`${proto}://${host}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
    signal: abort.signal
  });
  const ip = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress;
  const response = await handleAI(request, getEnv, { ip });
  const out = { ...SECURITY, 'cache-control': 'no-store' };
  response.headers.forEach((v, k) => (out[k] = v));
  res.writeHead(response.status, out);
  if (!response.body) return res.end();
  try {
    for await (const chunk of response.body) res.write(chunk);
  } catch {}
  res.end();
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname.startsWith('/api/ai'))
      return serveAI(req, res).catch(e => {
        console.error('[ai]', e);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { kind: 'failed', message: 'The server hit an error.' } }));
      });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    serveFile(req, res, pathname);
  })
  .listen(PORT, () => {
    const key = getEnv('GROQ_API_KEY') ? 'GROQ_API_KEY is set' : 'WARNING: GROQ_API_KEY is not set — the AI will not work';
    console.log(`EUREKA is running on http://localhost:${PORT}  (${key})`);
  });
