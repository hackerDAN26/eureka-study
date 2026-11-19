// Vercel: the AI endpoint. vercel.json rewrites /api/ai/<route> to this function with
// ?__route=<route>. Set GROQ_API_KEY in Vercel → Project → Settings → Environment Variables.
import { handleAI } from '../server/ai.js';

export default {
  fetch(request) {
    const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
    return handleAI(request, k => process.env[k], { ip });
  }
};
