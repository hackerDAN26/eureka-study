// Mounts the AI backend at /api/ai during `npm run dev` and `npm run preview`,
// so local development works exactly like the deployed site. Runs in Node, not the browser.
import { handleAI } from './ai.js';

const SKIP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade']);

export default function aiApi(fileEnv) {
  // devPlans: `npm run dev` lets the owner preview Pro/Max from Settings. Never on a live site.
  const make = devPlans => async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (!SKIP.has(k) && v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const request = new Request(`http://${req.headers.host}${req.originalUrl ?? req.url}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
        signal: controller.signal
      });
      const response = await handleAI(request, k => (devPlans && k === 'EUREKA_DEV_PLANS' ? '1' : process.env[k] ?? fileEnv[k]), { ip: req.socket.remoteAddress });
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (!response.body) return res.end();
      for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch (e) {
      if (controller.signal.aborted) return res.end();
      console.error('[ai] server error:', e?.message ?? e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { kind: 'failed', message: 'The EUREKA server hit an error.' } }));
      } else res.end();
    }
  };
  return {
    name: 'eureka-ai-api',
    configureServer(server) {
      server.middlewares.use('/api/ai', make(true));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ai', make(false));
    }
  };
}
