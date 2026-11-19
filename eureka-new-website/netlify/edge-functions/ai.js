// Netlify Edge Function: serves /api/ai/* on the deployed site.
// Set GROQ_API_KEY in Netlify → Site configuration → Environment variables.
// Edge Functions are used (not regular Functions) because they can stream long AI
// replies without the 10-second limit on streamed serverless Functions.
import { handleAI } from '../../server/ai.js';

export default (request, context) => handleAI(request, k => Netlify.env.get(k), { ip: context.ip });

export const config = { path: '/api/ai/*' };
