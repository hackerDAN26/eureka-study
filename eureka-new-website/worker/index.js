// Cloudflare Workers (with static assets): the website comes from dist/, the AI endpoint
// from this Worker. Deploy with:  npm run build && npx wrangler deploy
// Set the key once with:          npx wrangler secret put GROQ_API_KEY
import { handleAI } from '../server/ai.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/ai')) {
      const response = await handleAI(request, k => env[k], { ip: request.headers.get('cf-connecting-ip') || '' });
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
    return env.ASSETS.fetch(request);
  }
};
