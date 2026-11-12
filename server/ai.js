// EUREKA's AI backend — Groq. Runs on the server only (Netlify Edge Function in
// production, Vite middleware in development). The API key is read from the GROQ_API_KEY
// environment variable and never leaves the server.
//
// Talks to Groq's OpenAI-compatible Chat Completions API (POST /openai/v1/chat/completions),
// with streaming, images (vision models), reasoning effort and Groq's built-in
// browser_search tool (GPT-OSS models). The stream is converted into the simple event
// format the EUREKA web app reads.
//
// Routes (all under /api/ai):
//   POST /chat     → streams the tutor's reply (Server-Sent Events)
//   POST /task     → structured study tasks (topics, questions, marking, flashcards, coach)
//   GET  /models   → EUREKA's model lineup and which models this key can use
//   GET  /health   → is the key configured? ?test=1 makes a real request; ?test=all tests every model
//   POST /auth     → verifies a Google sign-in credential with Google
//   GET  /catalog  → qualifications, boards and subject names for onboarding (no spec codes)
import { available, block, byCapacity, observe, reserve, waitFor } from './capacity.js';
import { adaptBody, defaultTpm, providersFrom, slotsFor } from './providers.js';
import { checkQuota } from './quota.js';
import { budgetFor, est, fitChat, learnLimit, outputFor, tpmFor } from './context.js';
import { courseInstruction, publicCatalog, resolveCourse } from './specs.js';

// Best first. Plans: Max → GPT-OSS 120B · Pro → Qwen 3.8 · Free → GPT-OSS 20B (src/lib/plans.js).
//   search: supports Groq's built-in browser_search · vision: reads images
export const FALLBACK_MODELS = [
  { key: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', tag: 'Best', search: true, vision: false, effort: 'gptoss' },
  { key: 'qwen/qwen3.8-27b', name: 'Qwen 3.8', tag: 'Smart · reads images', search: false, vision: true, effort: 'qwen' },
  { key: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', tag: 'Fast', search: true, vision: false, effort: 'gptoss' }
];
export const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const ALLOWED = new Set(FALLBACK_MODELS.map(m => m.key));
// Other Groq names for the same tier, tried if a name isn't available on the key.
const ALIASES = {
  'openai/gpt-oss-120b': [],
  'qwen/qwen3.8-27b': ['qwen/qwen3.6-27b', 'qwen/qwen3-32b'],
  'openai/gpt-oss-20b': []
};
const CAPS = new Map(FALLBACK_MODELS.flatMap(m => [m.key, ...(ALIASES[m.key] ?? [])].map(k => [k, m])));
const caps = model => CAPS.get(model) ?? { search: false, vision: false, effort: null };
const VISION_MODELS = FALLBACK_MODELS.filter(m => m.vision).flatMap(m => [m.key, ...(ALIASES[m.key] ?? [])]);
const SEARCH_MODEL = 'openai/gpt-oss-120b';

const LEVELS = { Low: 'low', Medium: 'medium', High: 'high' };
const MODEL_ID = /^[\w.:/-]{1,80}$/;
const MAX_BODY = 20 * 1024 * 1024;
const MIME_OK = /^(application\/pdf|image\/[\w.+-]+|text\/[\w.+-]+)$/;

/* ── helpers ─────────────────────────────────────────── */
const json = (status, data, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
  });

const MESSAGES = {
  no_key: 'The server has no Groq API key. Set GROQ_API_KEY in your hosting environment variables (or in .env for local development) and redeploy.',
  invalid_key: 'Groq rejected the server’s API key. Create a new key at console.groq.com/keys (Groq keys start with “gsk_”) and update GROQ_API_KEY.',
  no_credits: 'The Groq account behind this key needs billing set up for this request. Check console.groq.com → Settings → Billing.',
  forbidden: 'This API key or organisation isn’t allowed to use that model (check console.groq.com → Settings → Limits / Projects).',
  quota: 'Groq’s rate limit for this key has been reached (requests or tokens per minute/day). Wait a moment, or raise the limits by upgrading your Groq plan.',
  model_unavailable: 'That model isn’t available for this API key.',
  bad_request: 'The AI couldn’t process this request.',
  unavailable: 'The AI is temporarily over capacity. Please try again in a moment.',
  upstream_unreachable: 'The EUREKA server couldn’t connect to Groq.',
  rate_limited: 'Too many requests from this device. Please wait a minute.',
  too_large: 'This message and its attachments are too large for the model. Try a smaller file or a shorter conversation.',
  forbidden_origin: 'This website isn’t allowed to use the EUREKA AI endpoint.',
  blocked: 'The AI declined to answer this prompt.',
  license_invalid: 'That license key wasn’t found. Copy it exactly from your Whop receipt email or whop.com → Your orders.',
  license_inactive: 'That membership isn’t active any more (cancelled, expired or payment failed). Renew it on Whop, then try again.',
  license_other: 'That license key is for a different product, not a EUREKA plan.',
  billing_not_setup: 'Plan activation isn’t set up on this site yet. Please contact eurekasofficial@gmail.com.',
  billing_error: 'We couldn’t check your purchase with Whop just now. Please try again in a minute.',
  daily_limit: 'You’ve used today’s AI allowance on your plan. It resets at midnight (UTC) — or upgrade for more.',
  failed: 'The AI request failed.'
};

const STATUS = {
  daily_limit: 429,
  license_invalid: 404,
  license_inactive: 402,
  license_other: 400,
  billing_not_setup: 503,
  billing_error: 502,
  no_key: 500,
  invalid_key: 502,
  no_credits: 502,
  forbidden: 502,
  quota: 429,
  model_unavailable: 502,
  bad_request: 400,
  unavailable: 503,
  upstream_unreachable: 502,
  rate_limited: 429,
  too_large: 413,
  forbidden_origin: 403,
  blocked: 400,
  failed: 502
};

const fail = (kind, extra = {}) => {
  const headers = extra.retryAfter ? { 'retry-after': String(extra.retryAfter) } : {};
  return json(STATUS[kind] ?? 500, { error: { kind, message: MESSAGES[kind] ?? MESSAGES.failed, ...extra } }, headers);
};

async function readError(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {}
  const e = data?.error;
  const message = String((typeof e === 'string' ? e : e?.message) ?? data?.message ?? data?.detail ?? '').slice(0, 500);
  const retry = parseInt(res.headers.get('retry-after') ?? '', 10);
  return { status: res.status, code: String(data?.code ?? e?.code ?? e?.type ?? ''), message, retryAfter: Number.isFinite(retry) ? retry : null };
}

export function classify(err) {
  const m = `${err.code} ${err.message}`;
  if (err.status === 401 || /incorrect api key|invalid api key|api key (is )?(invalid|not valid)|invalid_api_key|unauthenticated/i.test(m)) return 'invalid_key';
  if (err.status === 413 || /request too large|context_length_exceeded|reduce the length|maximum context length/i.test(m)) return 'too_large';
  if (err.status === 429 || /rate_limit_exceeded|rate limit/i.test(m)) return 'quota';
  if (err.status === 402 || /credits?|billing|payment|spending limit/i.test(m)) return 'no_credits';
  if (err.status === 404 || /does not exist|model_not_found|model.*not found|not found.*model|do not have access to (it|the model)|decommissioned|model .* (is )?not available|unknown model/i.test(m)) return 'model_unavailable';
  if (err.status === 498) return 'unavailable'; // Groq flex capacity
  if ((err.status === 400 || err.status === 422) && /reasoning|effort/i.test(m)) return 'thinking';
  if (err.status === 403) return 'forbidden';
  if (err.status >= 500) return 'unavailable';
  if (err.status === 400 || err.status === 422) return 'bad_request';
  return 'failed';
}

/* ── origin + rate limit ─────────────────────────────── */
function originAllowed(request, allowList) {
  const origin = request.headers.get('origin');
  if (!origin) return request.method === 'GET'; // browsers always send Origin on POST
  const self = new URL(request.url);
  if (origin === self.origin) return true;
  // Behind a proxy (Render, Railway, Vercel rewrites) the server may see http:// while the
  // browser is on https:// — the same host is still this site.
  const forwarded = (request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  try {
    const o = new URL(origin).host;
    if (o === self.host || (forwarded && o === forwarded)) return true;
  } catch {}
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return allowList
    .split(',')
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .includes(origin);
}

const buckets = new Map();
function rateLimited(ip, limit, windowMs = 60_000) {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k);
  const b = buckets.get(ip);
  if (!b || now - b.start > windowMs) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

/* ── tutor prompt (kept server-side) ─────────────────── */
const tutorInstruction = (subject, deadlines, custom, courses) => `You are EUREKA, a calm, expert study tutor for secondary and pre-university students (GCSE, IGCSE, A-Level, IB, AP and similar).

How you teach:
- Be a tutor, not an answer machine. For homework, coursework or assignment questions, do not hand over a finished answer: explain the idea, give a worked example on a *different* problem, then ask a guiding question or offer a hint so the student does the final step.
- Explaining concepts, summarising their own materials, making flashcards, quizzes and revision plans is fully fine — do it well.
- Keep answers tight and scannable: short paragraphs, bullet points, **bold** key terms, and plain notation for maths unless asked.
- When quizzing, ask one question at a time and wait for the answer, then mark it and explain mistakes.
- When the student attaches materials, ground answers in them and cite where it came from, e.g. "(Slide 12)" or "(p. 4)" or "(section 2.3)". If something isn't in the material, say so.
- End most replies with one short follow-up the student could take (a check-question, a next topic, or an offer).

${courses || (subject ? `The student is currently studying: ${subject}. Frame examples and terminology for this subject unless they ask otherwise.` : '')}
${deadlines ? deadlinesInstruction(deadlines) : ''}
${custom ? customInstruction(custom) : ''}`;
const deadlinesInstruction = d =>
  `\nThe student's upcoming deadlines (from their EUREKA calendar):\n${d}\nWhen relevant, connect your help to these and suggest specific revision sessions before them (e.g. "Your Economics test is in 4 days — want a 30-minute session on supply and demand tomorrow?").`;
const customInstruction = c => `\nThe student's own instructions for you (follow them unless they conflict with the tutoring rules):\n${c}`;

// What EUREKA has learned about the student — RAG checklist, grades, mistakes — so every
// answer adapts to them.
const studentInstruction = model =>
  model
    ? `\nWhat EUREKA knows about this student (from their red/amber/green checklist, grades, exam-question results and spaced reviews):
${model}
Use this to adapt: explain RED topics from first principles with small steps and frequent check-questions; for AMBER topics, consolidate and practise; for GREEN topics, be brief and stretch them with harder, higher-mark questions. Pitch questions at their target grade. Watch for their recurring mistakes and correct them explicitly when they appear.
When you recommend how to revise, prefer evidence-based methods (active recall, spaced repetition, the Feynman technique, blurting, interleaving, exam practice with mark schemes, error analysis) over re-reading or highlighting, and say briefly why the method suits what they are doing.`
    : '';

/* ── request validation ──────────────────────────────── */
function cleanPart(p) {
  if (!p || typeof p !== 'object') return null;
  const inline = p.inline_data ?? p.inlineData;
  if (inline) {
    const mime = String(inline.mime_type ?? inline.mimeType ?? '');
    if (!MIME_OK.test(mime) || typeof inline.data !== 'string') return null;
    return { inline_data: { mime_type: mime, data: inline.data } };
  }
  if (typeof p.text !== 'string') return null;
  return { text: p.text.slice(0, 500_000) };
}

function cleanHistory(history) {
  if (!Array.isArray(history) || history.length === 0 || history.length > 300) return null;
  const out = history
    .map(m => ({ role: m?.role === 'model' || m?.role === 'assistant' ? 'model' : 'user', parts: (Array.isArray(m?.parts) ? m.parts : []).slice(0, 60).map(cleanPart).filter(Boolean) }))
    .filter(m => m.parts.length);
  if (!out.length || out.at(-1).role !== 'user') return null;
  return out;
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Study-material excerpts chosen in the browser: [{ name, chunks: [{ label, text, score, order }] }]
function cleanMaterials(list) {
  if (!Array.isArray(list)) return [];
  let total = 0;
  const out = [];
  for (const f of list.slice(0, 12)) {
    const chunks = [];
    for (const c of Array.isArray(f?.chunks) ? f.chunks.slice(0, 40) : []) {
      if (typeof c?.text !== 'string' || total > 80_000) continue;
      const text = c.text.slice(0, 4000);
      total += text.length;
      chunks.push({ label: str(c.label, 60), text, score: Number(c.score) || 0, order: Number(c.order) || 0 });
    }
    if (chunks.length) out.push({ name: str(f.name, 120) || 'material', chunks });
  }
  return out;
}

/* ── Groq request ────────────────────────────────────── */
// EUREKA's message format → OpenAI chat messages.
function toMessages(system, contents) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const m of contents) {
    if (m.role === 'model') {
      messages.push({ role: 'assistant', content: m.parts.map(p => p.text ?? '').join('\n') });
      continue;
    }
    const content = [];
    for (const p of m.parts) {
      if (p.text !== undefined) content.push({ type: 'text', text: p.text });
      else if (p.inline_data.mime_type.startsWith('image/')) content.push({ type: 'image_url', image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } });
      else if (p.inline_data.mime_type === 'application/pdf') content.push({ type: 'text', text: '[A PDF was attached but couldn’t be read as text. Ask the student to paste the relevant part or attach images of the pages.]' });
      else content.push({ type: 'text', text: new TextDecoder().decode(Uint8Array.from(atob(p.inline_data.data), c => c.charCodeAt(0))) });
    }
    const images = content.some(c => c.type === 'image_url');
    messages.push({ role: 'user', content: images ? content : content.map(c => c.text).join('\n\n') });
  }
  return messages;
}

const hasImages = contents => contents.some(m => m.parts.some(p => p.inline_data?.mime_type?.startsWith('image/')));

// variant 0: everything · 1: tools, no reasoning options · 2: plain (no tools, no reasoning options)
const buildBody = ({ system, contents, level, search, maxTokens = 8192 }, variant = 0, model = DEFAULT_MODEL) => {
  const c = caps(model);
  const sys = search?.site && c.search && variant < 2 ? `${system}\n\nWhen you search, search the official site with queries like "site:${search.site} …" and prefer pages from ${search.site}.` : system;
  const body = { messages: toMessages(sys, contents), max_completion_tokens: maxTokens };
  if (variant === 0) {
    if (c.effort === 'gptoss') {
      if (level) body.reasoning_effort = level;
      body.include_reasoning = false;
    } else if (c.effort === 'qwen') {
      if (level) body.reasoning_effort = level;
      body.reasoning_format = 'hidden';
    }
  }
  if (search && c.search && variant < 2) {
    body.tools = [{ type: 'browser_search' }];
    body.tool_choice = 'auto';
  }
  return body;
};

async function callProvider(slot, body, stream, signal) {
  const { provider } = slot;
  return fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.key}`, accept: stream ? 'text/event-stream' : 'application/json', ...provider.headers },
    body: JSON.stringify({ ...body, model: slot.remote, stream }),
    signal
  });
}


const RANKED = FALLBACK_MODELS.map(m => m.key);
const sleep = (ms, signal) =>
  new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
// "Please try again in 7.66s" / "in 1m20s" → seconds
function retryHint(message) {
  const m = /try again in\s+(?:(\d+)m)?\s*(?:([\d.]+)s)?/i.exec(String(message ?? ''));
  if (!m || (!m[1] && !m[2])) return null;
  return Math.ceil(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
}
// Same tier under other names first, then step DOWN the lineup (never up).
const fallbackFor = model => {
  const i = RANKED.indexOf(model);
  const below = i >= 0 ? RANKED.slice(i + 1) : RANKED.slice(1);
  return [...(ALIASES[model] ?? []), ...below.flatMap(m => [m, ...(ALIASES[m] ?? [])])];
};
const FATAL = new Set(['invalid_key', 'no_key', 'no_credits', 'blocked', 'too_large']);

// Rough size of a request in Groq's rate-limit terms: input tokens + reserved reply.
const sizeOf = body => Math.ceil(JSON.stringify(body.messages ?? []).length / 3.8) + (body.max_completion_tokens ?? 1024);
const MAX_WAIT_MS = 20_000; // longest a request waits for a busy model to free up

async function generate({ base, key, providers, env, model, level, stream, signal, make, noFallback = false, hasTools = false, needsVision = false, needsSearch = false, overflow = false }) {
  providers = providers?.length ? providers : providersFrom(() => '', { key, base });
  const requested = ALLOWED.has(model) || CAPS.has(model) ? model : DEFAULT_MODEL;
  // Images need a vision model; web/spec searches need a model with browser search.
  let first = requested;
  let routed = null;
  if (needsVision && !caps(first).vision) [first, routed] = [VISION_MODELS[0], 'vision'];
  else if (needsSearch && !caps(first).search) [first, routed] = [SEARCH_MODEL, 'search'];
  let queue = noFallback ? [first] : [first, ...fallbackFor(first).filter(m => m !== first)];
  if (needsVision && !noFallback) queue = [...new Set([first, ...VISION_MODELS])];
  // Overflow: when the student's models are full, borrow another model's allowance.
  const borrowedModels = new Set();
  if (overflow && !noFallback)
    for (const m of RANKED.flatMap(r => [r, ...(ALIASES[r] ?? [])]))
      if (!queue.includes(m) && (!needsVision || caps(m).vision)) {
        queue.push(m);
        borrowedModels.add(m);
      }
  // Each model at each provider is a separate "slot" with its own rate limit. Images and
  // Groq's web search only work on Groq; other providers answer without search if needed.
  let slots = queue.flatMap(m => slotsFor(m, providers)).filter(sl => !needsVision || sl.provider.id === 'groq');
  if (noFallback) slots = slots.filter(sl => sl.provider.id === 'groq').slice(0, 1);
  model = requested;
  const tried = [];
  const gone = new Set(); // slot keys / provider ids that can't serve this request
  const usable = sl => !gone.has(sl.key) && !gone.has(sl.provider.id);
  let lastErr = null;
  const started = Date.now();
  const bodyFor = (sl, lvl, variant, squeeze) => adaptBody(make(lvl, variant, sl.model, squeeze, sl), sl.provider, variant);
  const needOf = sl => sizeOf(bodyFor(sl, level, 0, 0));
  const byKey = new Map(slots.map(sl => [sl.key, sl]));

  for (let pass = 0; pass < 3; pass++) {
    const order = byCapacity(slots.filter(usable).map(sl => sl.key), k => needOf(byKey.get(k))).map(k => byKey.get(k));
    let sawBusy = false;
    for (const slot of order) {
      if (!usable(slot)) continue;
      const borrowed = borrowedModels.has(slot.model);
      // Reach for a borrowed model or a backup provider only when it actually has room.
      if ((borrowed || slot.provider.id !== 'groq') && available(slot.key) < needOf(slot)) continue;
      let variant = 0;
      let lvl = level;
      let retried = false;
      let squeeze = 0;
      let next = false;
      for (let attempt = 0; attempt < 6 && !next; attempt++) {
        if (signal?.aborted) return { aborted: true };
        const body = bodyFor(slot, lvl, variant, squeeze);
        reserve(slot.key, sizeOf(body));
        let res;
        try {
          res = await callProvider(slot, body, stream, signal);
        } catch (e) {
          if (signal?.aborted) return { aborted: true };
          lastErr = { kind: 'upstream_unreachable', detail: String(e?.message ?? e).slice(0, 200), model: slot.model };
          gone.add(slot.provider.id); // provider unreachable: try the others
          next = true;
          break;
        }
        observe(slot.key, res.headers);
        if (res.ok) {
          const reason = slot.model === model ? null : borrowed || (tried.at(-1)?.kind === 'quota' && !routed) ? 'busy' : (tried.at(-1)?.kind ?? routed);
          return {
            res,
            model: slot.model,
            provider: slot.provider.id,
            fellBackFrom: slot.model === model ? null : model,
            reason,
            searchDropped: hasTools && (variant >= 2 || !caps(slot.model).search || slot.provider.id !== 'groq'),
            tried,
            squeeze
          };
        }
        const err = await readError(res);
        const kind = classify(err);
        const retryAfter = err.retryAfter ?? retryHint(err.message);
        lastErr = { kind: kind === 'thinking' ? 'bad_request' : kind, detail: err.message, retryAfter, model: slot.model };
        console.error(`[ai] ${slot.provider.id}:${slot.remote} → ${res.status} ${kind}: ${err.message}`);
        if (kind === 'too_large' && squeeze < 2) {
          learnLimit(slot.key, err.message);
          squeeze += 1;
          continue;
        }
        if (kind === 'quota') {
          learnLimit(slot.key, err.message);
          block(slot.key, retryAfter ?? 10);
          sawBusy = true;
          next = true;
          break;
        }
        // A provider's key/billing problem only takes that provider out of the pool.
        if (['invalid_key', 'no_key', 'no_credits', 'forbidden'].includes(kind) && providers.length > 1) {
          gone.add(slot.provider.id);
          next = true;
          break;
        }
        if (FATAL.has(kind)) return { error: kind, detail: err.message, retryAfter, model: slot.model, tried };
        if (kind === 'thinking' && lvl) {
          lvl = null;
          continue;
        }
        if (hasTools && variant < 2 && ['bad_request', 'forbidden'].includes(kind)) {
          variant = kind === 'bad_request' && variant === 0 ? 1 : 2;
          continue;
        }
        if (kind === 'bad_request' && variant < 2) {
          variant = 2;
          continue;
        }
        if (kind === 'unavailable' && !retried) {
          retried = true;
          await sleep(800, signal);
          continue;
        }
        gone.add(slot.key);
        next = true;
      }
      tried.push({ model: slot.model, provider: slot.provider.id, kind: lastErr?.kind, detail: lastErr?.detail });
    }
    // Everything was full: wait briefly for the first slot to free up, then go again.
    const candidates = slots.filter(usable);
    if (!candidates.length) break;
    if (!sawBusy && !candidates.some(sl => available(sl.key) < needOf(sl))) break;
    const wait = Math.min(...candidates.map(sl => waitFor(sl.key, needOf(sl))));
    if (!Number.isFinite(wait) || Date.now() - started + wait > MAX_WAIT_MS) {
      lastErr = { ...(lastErr ?? { kind: 'quota' }), kind: 'quota', retryAfter: Math.max(1, Math.ceil((Number.isFinite(wait) ? wait : 30_000) / 1000)) };
      break;
    }
    await sleep(wait + 300, signal);
    if (signal?.aborted) return { aborted: true };
  }
  return { error: lastErr?.kind ?? 'failed', detail: lastErr?.detail, retryAfter: lastErr?.retryAfter, model: lastErr?.model, tried };
}

/* ── Groq stream → EUREKA stream ─────────────────────── */
// The web app reads `data: {"candidates":[{"content":{"parts":[{"text":…}]}}]}` lines,
// plus a final chunk with groundingMetadata (sources). Convert Groq's chunks to that.
const enc = new TextEncoder();
const sse = obj => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const textChunk = text => sse({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] });

// Some models put their reasoning in <think>…</think>; never show it. Works across chunks.
export function thinkFilter() {
  let inThink = false;
  let carry = '';
  const partial = (t, tag) => {
    for (let n = Math.min(tag.length - 1, t.length); n > 0; n--) if (tag.startsWith(t.slice(-n))) return n;
    return 0;
  };
  return (chunk, flush = false) => {
    let t = carry + chunk;
    carry = '';
    let out = '';
    while (t) {
      const tag = inThink ? '</think>' : '<think>';
      const i = t.indexOf(tag);
      if (i >= 0) {
        if (!inThink) out += t.slice(0, i);
        t = t.slice(i + tag.length);
        inThink = !inThink;
        continue;
      }
      const keep = flush ? 0 : partial(t, tag);
      if (!inThink) out += t.slice(0, t.length - keep);
      carry = keep ? t.slice(-keep) : '';
      break;
    }
    return out;
  };
}

function collectUrls(obj, into, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  if (typeof obj.url === 'string' && /^https?:\/\//.test(obj.url)) into.set(obj.url, obj.title || into.get(obj.url) || obj.url);
  for (const v of Array.isArray(obj) ? obj : Object.values(obj)) if (v && typeof v === 'object') collectUrls(v, into, depth + 1);
}

function toAppStream(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  let finished = false;
  const cites = new Map();
  const strip = thinkFilter();
  const finish = controller => {
    if (finished) return;
    finished = true;
    const groundingChunks = [...cites].map(([uri, title]) => ({ web: { uri, title } }));
    controller.enqueue(sse({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP', ...(groundingChunks.length ? { groundingMetadata: { groundingChunks } } : {}) }] }));
  };
  const handle = (line, controller) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    if (ev.error) {
      controller.enqueue(sse({ error: { message: ev.error.message ?? String(ev.error) } }));
      return;
    }
    const choice = ev.choices?.[0];
    const delta = choice?.delta ?? {};
    if (delta.executed_tools) collectUrls(delta.executed_tools, cites);
    if (typeof delta.content === 'string' && delta.content) {
      const text = strip(delta.content);
      if (text) controller.enqueue(textChunk(text));
    }
    if (choice?.finish_reason) {
      const rest = strip('', true);
      if (rest) controller.enqueue(textChunk(rest));
      // Replies are kept short when the AI's rate limit is small; say how to get the rest.
      if (choice.finish_reason === 'length') controller.enqueue(textChunk('\n\n_…I kept that short so everyone can use EUREKA at once — say **continue** for the rest._'));
      finish(controller);
    }
  };
  return new ReadableStream({
    // Keep reading until something is enqueued: a chunk that only carries hidden reasoning
    // or metadata must not leave the reader waiting.
    async pull(controller) {
      try {
        const before = controller.desiredSize;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            if (buffer.trim()) handle(buffer.trim(), controller);
            finish(controller);
            controller.close();
            return;
          }
          buffer += dec.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n')) >= 0) {
            handle(buffer.slice(0, cut).trim(), controller);
            buffer = buffer.slice(cut + 1);
          }
          if (controller.desiredSize < before || finished) return;
        }
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

const outputText = data => {
  const s = thinkFilter();
  return (s(String(data?.choices?.[0]?.message?.content ?? ''), true)).trim();
};

/* ── plans: verified on the server, never trusted from the browser ── */
// After paying on Whop, a customer enters their license key. The server checks it with
// Whop (WHOP_API_KEY) and returns a signed "plan pass". Every AI request carries the pass;
// the server only ever uses models the verified plan includes. Without a valid pass,
// requests are treated as the Free plan — editing the website's data can't unlock more.
const PLAN_RANK = { free: 0, pro: 1, max: 2 };
const PLAN_BEST = { free: 'openai/gpt-oss-20b', pro: 'qwen/qwen3.8-27b', max: 'openai/gpt-oss-120b' };
const MODEL_TIER = { 'openai/gpt-oss-20b': 'free', 'qwen/qwen3.8-27b': 'pro', 'openai/gpt-oss-120b': 'max' };
const tierOfModel = m => MODEL_TIER[m] ?? MODEL_TIER[Object.keys(ALIASES).find(k => ALIASES[k].includes(m))] ?? 'max';
const DEFAULT_WHOP_PLANS = {
  plan_VbdKDteONjAvL: ['pro', 'monthly'],
  plan_P5x4nksgIGQsS: ['pro', 'yearly'],
  plan_T4rb2neFS9qdz: ['max', 'monthly'],
  plan_x1TBsQJ6buHF3: ['max', 'yearly']
};
const ACTIVE = new Set(['active', 'trialing', 'past_due', 'completed']);
const DAY = 86400e3;

const enc8 = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = str => atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc8.encode(data)));
}
const planSecret = env => env('PLAN_SECRET') || env('WHOP_API_KEY');

export async function signPlan(env, payload) {
  const secret = planSecret(env);
  if (!secret) return null;
  const body = b64u(enc8.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(`eureka-plan:${secret}`, body)}`;
}

export async function verifyPlan(env, token) {
  const secret = planSecret(env);
  if (!secret || typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = await hmac(`eureka-plan:${secret}`, body);
  let diff = want.length ^ sig.length;
  for (let i = 0; i < Math.min(want.length, sig.length); i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const p = JSON.parse(unb64u(body));
    return PLAN_RANK[p.tier] !== undefined && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

// The plan a request is allowed to use. Developer preview (npm run dev only) can pick any plan.
async function planOf(request, env) {
  return (await planInfo(request, env)).tier;
}
async function planInfo(request, env) {
  const dev = request.headers.get('x-eureka-dev-plan');
  if (dev && env('EUREKA_DEV_PLANS') === '1' && PLAN_RANK[dev] !== undefined) return { tier: dev, member: null };
  const pass = await verifyPlan(env, request.headers.get('x-eureka-plan'));
  return { tier: pass?.tier ?? 'free', member: pass?.mem || null };
}
// Fair use (server/quota.js): per-student daily ceiling + per-minute burst limit.
async function fairUse(request, ctx, info) {
  const q = await checkQuota(ctx.env, { plan: info.tier, member: info.member, device: request.headers.get('x-eureka-device'), ip: ctx.ip });
  return q.ok ? null : fail(q.kind, { retryAfter: q.retryAfter });
}

function whopPlans(env) {
  const map = { ...DEFAULT_WHOP_PLANS };
  for (const [name, val] of [
    ['WHOP_PLAN_PRO_MONTHLY', ['pro', 'monthly']],
    ['WHOP_PLAN_PRO_YEARLY', ['pro', 'yearly']],
    ['WHOP_PLAN_MAX_MONTHLY', ['max', 'monthly']],
    ['WHOP_PLAN_MAX_YEARLY', ['max', 'yearly']]
  ])
    if (env(name)) map[env(name)] = val;
  return map;
}

// OWNER_KEY as set on the host, without stray quotes or spaces pasted into the dashboard.
const ownerKey = env => String(env('OWNER_KEY') ?? '').replace(/^["'`\s]+|["'`\s]+$/g, '');

// Compares secrets without leaking how many characters matched.
function sameText(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function activate(request, env, ip) {
  if (rateLimited(`license:${ip}`, 8)) return fail('rate_limited', { retryAfter: 60 });
  let input = {};
  try {
    input = JSON.parse((await request.text()).slice(0, 2000));
  } catch {}
  const licenseKey = String(input.licenseKey ?? '').trim();
  // Site owner: typing OWNER_KEY (set on your host, 24+ characters) unlocks Max for a year.
  const owner = ownerKey(env);
  if (owner.length >= 24 && sameText(licenseKey.replace(/^["'`\s]+|["'`\s]+$/g, ''), owner)) {
    const exp = Date.now() + 365 * DAY;
    const token = await signPlan(env, { tier: 'max', billing: 'yearly', mem: 'owner', exp });
    return json(200, { tier: 'max', billing: 'yearly', until: exp, membership: 'owner', token });
  }
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(licenseKey)) return fail('license_invalid');
  const apiKey = env('WHOP_API_KEY');
  if (!apiKey) return fail('billing_not_setup');
  const base = (env('WHOP_API_BASE') || 'https://api.whop.com/api/v1').replace(/\/$/, '');
  let res;
  try {
    res = await fetch(`${base}/memberships/${encodeURIComponent(licenseKey)}`, { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' } });
  } catch (e) {
    return fail('billing_error', { detail: e?.message });
  }
  if (res.status === 404 || res.status === 400 || res.status === 422) return fail('license_invalid');
  if (res.status === 401 || res.status === 403) {
    console.error('[plan] Whop rejected WHOP_API_KEY — it needs the member:basic:read permission.');
    return fail('billing_not_setup');
  }
  if (!res.ok) return fail('billing_error', { detail: `Whop returned ${res.status}` });
  const m = await res.json().catch(() => ({}));
  const planId = m.plan?.id ?? m.plan_id ?? m.variant_id ?? (typeof m.plan === 'string' ? m.plan : null);
  const match = whopPlans(env)[planId];
  if (!match) return fail('license_other');
  if (!ACTIVE.has(String(m.status ?? '').toLowerCase()) || m.valid === false) return fail('license_inactive', { status: m.status });
  const [tier, billing] = match;
  const periodEnd = Date.parse(m.renewal_period_end ?? m.current_period_end ?? m.expires_at ?? '') || 0;
  // Re-checked at least monthly, so cancellations take effect.
  const exp = Math.min(Date.now() + 31 * DAY, periodEnd > Date.now() ? periodEnd + DAY : Date.now() + 3 * DAY);
  const token = await signPlan(env, { tier, billing, mem: String(m.id ?? '').slice(0, 40), exp });
  return json(200, { tier, billing, until: exp, membership: m.id ?? null, token });
}

/* ── finding the key ─────────────────────────────────── */
// GROQ_API_KEY is the name to use. To be forgiving, EUREKA also accepts common
// misspellings, and a Groq key (gsk_…) pasted into an older variable such as XAI_API_KEY.
const GROQ_NAMES = ['GROQ_API_KEY', 'GROQ_KEY', 'GROQ_TOKEN', 'GROQ_API_TOKEN', 'GROQ_APIKEY', 'groq_api_key', 'Groq_API_Key'];
const OTHER_NAMES = ['XAI_API_KEY', 'GROK_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'API_KEY', 'AI_API_KEY', 'VITE_GROQ_API_KEY'];
const unquote = v => v.replace(/^['"`]+|['"`]+$/g, '').replace(/^Bearer\s+/i, '').trim();

export function findKey(env) {
  for (const name of GROQ_NAMES) {
    const v = unquote(env(name));
    if (v) return { key: v, from: name, seen: [name] };
  }
  const seen = OTHER_NAMES.filter(n => env(n));
  for (const name of seen) {
    const v = unquote(env(name));
    if (v.startsWith('gsk_')) return { key: v, from: name, seen };
  }
  return { key: '', from: '', seen };
}

function noKeyDetail(found) {
  if (found.seen.length)
    return `The server can see ${found.seen.join(', ')}, but none of them holds a Groq key (Groq keys start with “gsk_”). Add a variable named exactly GROQ_API_KEY with your gsk_… key, then redeploy.`;
  return 'The server can’t see any API key variable. On Netlify: Site configuration → Environment variables → Add a variable → Key: GROQ_API_KEY, Value: your gsk_… key, Scopes: All (or include Functions) → Create, then Deploys → Trigger deploy → Deploy site. Running locally: create a file named .env next to package.json containing GROQ_API_KEY=gsk_… and restart npm run dev.';
}

/* ── routes ──────────────────────────────────────────── */
async function chat(request, ctx) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail('too_large');
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return fail('bad_request', { detail: 'Body must be JSON.' });
  }
  const contents = cleanHistory(input.history);
  if (!contents) return fail('bad_request', { detail: 'history must be a list of messages ending with the student’s message.' });

  const info = await planInfo(request, ctx.env);
  const plan = info.tier;
  const blocked = await fairUse(request, ctx, info);
  if (blocked) return blocked;
  let requested = typeof input.model === 'string' && MODEL_ID.test(input.model) ? input.model : PLAN_BEST[plan];
  let planLimited = null;
  if (PLAN_RANK[tierOfModel(requested)] > PLAN_RANK[plan]) [planLimited, requested] = [requested, PLAN_BEST[plan]];
  const lookup = input.specLookup === true;
  const courses = courseInstruction(input.course, input.courses, lookup);
  const site = lookup ? resolveCourse(input.course)?.site : '';
  const search = input.webSearch === true ? { site: '' } : lookup && courses ? { site: site || '' } : null;
  // The context is fitted to the model's token budget for every attempt (see server/context.js).
  const materials = cleanMaterials(input.materials);
  const sections = {
    base: tutorInstruction(str(input.subject, 120), '', '', courses),
    student: { raw: str(input.studentModel, 4000), wrap: studentInstruction },
    deadlines: { raw: str(input.deadlines, 4000), wrap: deadlinesInstruction },
    custom: { raw: plan === 'max' ? str(input.customInstructions, 2000) : '', wrap: customInstruction }
  };
  let report = null;
  const out = await generate({
    ...ctx,
    model: requested,
    level: LEVELS[input.effort] ?? 'low',
    stream: true,
    signal: request.signal,
    hasTools: Boolean(search),
    needsVision: hasImages(contents),
    needsSearch: Boolean(search),
    overflow: true,
    make: (level, variant, model, squeeze = 0, slot = null) => {
      // Web search adds result text to the request, so leave more headroom for it.
      const fit = fitChat({ sections, contents, materials, tpm: tpmFor(slot?.key ?? model, ctx.env, slot && defaultTpm(slot.provider)), squeeze: Math.min(2, squeeze + (search && caps(model).search && (!slot || slot.provider.id === 'groq') ? 1 : 0)), desiredOutput: level === 'high' ? 3000 : 2048 });
      report = fit.report;
      return buildBody({ system: fit.system, contents: fit.contents, level, search, maxTokens: fit.maxOutput }, variant, model);
    }
  });
  if (out.aborted) return new Response(null, { status: 499 });
  if (out.error) {
    console.error(`[ai] ${out.error} (${out.model ?? requested}): ${out.detail ?? ''}`);
    return fail(out.error, { detail: out.detail, retryAfter: out.retryAfter, model: out.model ?? requested, tried: out.tried });
  }
  const headers = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-eureka-model': out.model,
    'x-eureka-provider': out.provider ?? 'groq',
    'x-eureka-plan': plan
  };
  if (report) headers['x-eureka-context'] = `kept=${report.kept};summarised=${report.summarised};materials=${report.materials};input=${report.input};squeeze=${report.squeeze}`;
  if (out.fellBackFrom) headers['x-eureka-fallback-from'] = out.fellBackFrom;
  if (out.fellBackFrom && out.reason) headers['x-eureka-fallback-reason'] = out.reason;
  if (planLimited && !out.fellBackFrom) [headers['x-eureka-fallback-from'], headers['x-eureka-fallback-reason']] = [planLimited, 'plan'];
  if (out.searchDropped) headers['x-eureka-note'] = 'search_unavailable';
  return new Response(toAppStream(out.res.body), { status: 200, headers });
}

/* ── structured study tasks (topics, questions, marking, flashcards, coaching) ── */
const TASK_SYSTEM = `You are EUREKA's revision engine. You produce structured data for a study app used by secondary and pre-university students. Be accurate to the exam board's specification, mark scheme style and command words. Reply with ONLY one JSON object — no prose, no code fences.`;

// Reply reservations per task (counted against the per-minute token limit).
const TASK_OUTPUT = { topics: 2600, question: 1200, mark: 2000, flashcards: 2000, coach: 1400 };

const TASKS = {
  topics: i => `List the topics of this course's specification so a student can build a revision checklist.
Return {"topics":[{"name":"short topic name","subtopics":["…"],"weight":1-5,"difficulty":1-5}]}.
- Follow the specification's own topic structure and order; 6–25 topics; up to 6 subtopics each, each a few words.
- weight = share of exam marks (5 = large); difficulty = how hard students typically find it (5 = hardest).
${i.paper ? `Only include topics assessed on: ${i.paper}.` : ''}`,
  question: i => `Write ONE original exam-style question on "${i.topic}"${i.subtopic ? ` (focus: ${i.subtopic})` : ''} for this course, in the board's style.
The student's current grade is ${i.currentGrade || 'unknown'} and target is ${i.targetGrade || 'unknown'}; their confidence on this topic is ${i.rag || 'unrated'}. ${i.rag === 'red' ? 'Start accessible (2–4 marks) and build understanding.' : i.rag === 'green' ? 'Make it challenging (6+ marks or an extended/evaluate question).' : 'Pitch it at their target grade.'}
${i.mistakes?.length ? `They often make these mistakes — test them: ${i.mistakes.join('; ')}.` : ''}
${i.avoid?.length ? `Do not repeat these questions: ${i.avoid.join(' | ')}.` : ''}
Return {"question":"full question text (include any data or context needed)","marks":N,"commandWord":"e.g. Explain","assessmentObjective":"e.g. AO2","markScheme":["one creditworthy point per item, as an examiner would write it"],"timeMinutes":N}.`,
  mark: i => `Mark this student's answer strictly, like a senior examiner for this board.
Question (${i.marks} marks): ${i.question}
Mark scheme: ${(i.markScheme ?? []).join(' | ')}
Student's answer: """${i.answer}"""
Return {"score":N,"outOf":${i.marks},"awarded":["points they earned, quoting their words briefly"],"missing":["marks they missed and exactly what would have earned each"],"feedback":"2–3 sentences of examiner feedback","examinerTip":"one tip on technique (command word, structure, key terms, units)","improvedAnswer":"a full-marks model answer, concise","mistakes":["short reusable tags for misconceptions or technique errors, e.g. 'confuses mitosis and meiosis', 'missing units' — empty if none"]}.`,
  flashcards: i => `Make ${Math.min(20, Math.max(3, i.count || 8))} flashcards for "${i.topic}" on this specification.
One idea per card: key definitions, facts, equations, processes, quotes or examples examiners expect. Fronts are questions or prompts (not "Define X?" every time — vary them); backs are short, exact, mark-scheme-worded answers.
${i.rag === 'red' ? 'Start with the fundamentals.' : ''}
${i.existing?.length ? `Avoid duplicating: ${i.existing.join(' | ')}.` : ''}
Return {"cards":[{"front":"…","back":"…"}]}.`,
  coach: i => `You are the student's study coach. Using their study data below, identify inefficient habits and give specific, encouraging, evidence-based advice. Explain WHY each method works for them.
Data: ${i.summary}
Return {"insights":[{"title":"short headline","why":"why it matters, with the learning science in plain words","action":"one concrete thing to do this week","technique":"one of active_recall, spaced_repetition, feynman, flashcards, blurting, mind_map, interleaving, retrieval, note_taking, exam_practice, error_analysis"}]} with 2–4 insights.`
};

function parseLenient(text) {
  const t = String(text ?? '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {}
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a)
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {}
  return null;
}

const VALID = {
  topics: d => Array.isArray(d?.topics) && d.topics.length > 0,
  question: d => typeof d?.question === 'string' && Number(d.marks) > 0,
  mark: d => Number.isFinite(Number(d?.score)),
  flashcards: d => Array.isArray(d?.cards) && d.cards.length > 0,
  coach: d => Array.isArray(d?.insights)
};

async function task(request, ctx) {
  const raw = await request.text();
  if (raw.length > 200_000) return fail('too_large');
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return fail('bad_request', { detail: 'Body must be JSON.' });
  }
  const kind = String(input.task ?? '');
  if (!TASKS[kind]) return fail('bad_request', { detail: `Unknown task. Use one of: ${Object.keys(TASKS).join(', ')}.` });
  const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : Array.isArray(v) ? v.slice(0, 30).map(x => String(x).slice(0, 300)) : v);
  const args = Object.fromEntries(Object.entries(input.input ?? {}).map(([k, v]) => [k, clip(v, k === 'answer' ? 12000 : k === 'summary' ? 6000 : 2000)]));
  const courses = courseInstruction(input.course, input.course ? [input.course] : [], kind === 'topics');
  const site = kind === 'topics' ? resolveCourse(input.course)?.site : '';
  const search = kind === 'topics' && site ? { site } : null;
  const system = [TASK_SYSTEM, courses, studentInstruction(str(input.studentModel, 1600))].filter(Boolean).join('\n\n');
  const info = await planInfo(request, ctx.env);
  const plan = info.tier;
  const blocked = await fairUse(request, ctx, info);
  if (blocked) return blocked;
  let requested = typeof input.model === 'string' && MODEL_ID.test(input.model) ? input.model : PLAN_BEST[plan];
  if (PLAN_RANK[tierOfModel(requested)] > PLAN_RANK[plan]) requested = PLAN_BEST[plan];
  const prompt = TASKS[kind](args);
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const contents = [{ role: 'user', parts: [{ text: attempt ? `${prompt}\n\nYour previous reply was not valid JSON. Reply with only the JSON object.` : prompt }] }];
    const out = await generate({
      ...ctx,
      model: requested,
      level: kind === 'mark' || kind === 'topics' ? 'medium' : 'low',
      stream: false,
      signal: request.signal,
      hasTools: Boolean(search),
      needsSearch: Boolean(search),
      overflow: true,
      make: (level, variant, model, squeeze = 0, slot = null) => {
        const budget = budgetFor(tpmFor(slot?.key ?? model, ctx.env, slot && defaultTpm(slot.provider)), { squeeze, desiredOutput: TASK_OUTPUT[kind] });
        const sys = squeeze ? [TASK_SYSTEM, courses].filter(Boolean).join('\n\n') : system;
        const used = est(sys) + est(contents[0].parts[0].text) + 20;
        return buildBody({ system: sys, contents, level, search, maxTokens: outputFor(budget, used) }, variant, model);
      }
    });
    if (out.aborted) return new Response(null, { status: 499 });
    if (out.error) return fail(out.error, { detail: out.detail, retryAfter: out.retryAfter, model: out.model ?? requested });
    const data = parseLenient(outputText(await out.res.json().catch(() => ({}))));
    last = out;
    if (data && VALID[kind](data)) return json(200, { task: kind, data, model: out.model, plan, fellBackFrom: out.fellBackFrom ?? null }, { 'x-eureka-plan': plan });
  }
  return fail('unavailable', { detail: 'The model did not return usable data. Try again.', model: last?.model });
}

async function models(ctx) {
  let names = null;
  try {
    const res = await fetch(`${ctx.base}/models`, { headers: { authorization: `Bearer ${ctx.key}` } });
    if (res.ok) {
      const data = await res.json();
      names = new Set([...(data.data ?? []), ...(data.models ?? [])].map(m => String(m.id ?? m.name ?? '')));
    }
  } catch {}
  const has = key => (names ? [key, ...(ALIASES[key] ?? [])].some(k => names.has(k)) : null);
  return json(200, { models: FALLBACK_MODELS.map(m => ({ ...m, available: has(m.key) })), source: names ? 'live' : 'fallback' });
}

const tinyTest = (model, ctx, signal, noFallback) =>
  generate({
    ...ctx,
    model,
    level: 'low',
    stream: false,
    signal,
    noFallback,
    make: (level, variant, model) => buildBody({ contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: EUREKA OK' }] }], level, maxTokens: 300 }, variant, model)
  });

async function testAll(request, ctx) {
  const results = [];
  for (const m of FALLBACK_MODELS) {
    const started = Date.now();
    // Try the model's alternative names too, but not other tiers.
    let out = null;
    for (const name of [m.key, ...(ALIASES[m.key] ?? [])]) {
      out = await tinyTest(name, ctx, request.signal, true);
      if (!out.error || FATAL.has(out.error)) {
        out.name = name;
        break;
      }
    }
    if (out.error) results.push({ model: m.key, name: m.name, ok: false, kind: out.error, message: MESSAGES[out.error], detail: out.detail });
    else {
      const reply = outputText(await out.res.json().catch(() => ({})));
      results.push({ model: out.name, name: m.name, ok: true, ms: Date.now() - started, reply });
    }
  }
  return json(200, { ok: results.some(r => r.ok), results });
}

async function health(request, ctx, env) {
  const info = { ok: Boolean(ctx.key), keyConfigured: Boolean(ctx.key), provider: 'Groq', keyVariable: ctx.keyFrom || null, defaultModel: DEFAULT_MODEL, warnings: [] };
  if (env('VITE_GROQ_API_KEY') || env('VITE_XAI_API_KEY') || env('VITE_GEMINI_API_KEY'))
    info.warnings.push('A VITE_… API key variable is set. Variables starting with VITE_ can be bundled into the website — remove it and use GROQ_API_KEY.');
  if (ctx.key && !ctx.key.startsWith('gsk_'))
    info.warnings.push('This key doesn’t start with “gsk_”, the format Groq uses. If requests fail with “invalid key”, create a new key at console.groq.com/keys.');
  if (ctx.key && ctx.keyFrom !== 'GROQ_API_KEY') info.warnings.push(`Using the Groq key found in ${ctx.keyFrom}. It works, but rename the variable to GROQ_API_KEY to avoid confusion.`);
  if (!ctx.key) return json(500, { ...info, error: { kind: 'no_key', message: MESSAGES.no_key, detail: ctx.noKey } });

  if (new URL(request.url).searchParams.get('test') === '1') {
    const started = Date.now();
    const out = await tinyTest(DEFAULT_MODEL, ctx, request.signal, false);
    if (out.error) {
      info.ok = false;
      info.test = { ok: false, model: out.model ?? DEFAULT_MODEL, kind: out.error, message: MESSAGES[out.error], detail: out.detail };
      return json(STATUS[out.error] ?? 502, info);
    }
    info.test = { ok: true, model: out.model, reply: outputText(await out.res.json().catch(() => ({}))), ms: Date.now() - started };
  }
  return json(200, info);
}

/* ── Google sign-in verification ─────────────────────── */
// The OAuth client ID is public; GOOGLE_CLIENT_ID overrides it if you use another one.
const DEFAULT_GOOGLE_CLIENT_ID = '931768065843-721uksotvjdh09s07bs51fo8rl0hmrfa.apps.googleusercontent.com';

async function verifyGoogle(request, env) {
  let credential = '';
  try {
    credential = JSON.parse(await request.text())?.credential ?? '';
  } catch {}
  if (typeof credential !== 'string' || credential.split('.').length !== 3 || credential.length > 8000)
    return json(400, { error: { kind: 'auth_invalid', message: 'Google didn’t send a valid sign-in. Please try again.' } });
  const clientId = env('GOOGLE_CLIENT_ID') || DEFAULT_GOOGLE_CLIENT_ID;
  const endpoint = env('GOOGLE_TOKENINFO_URL') || 'https://oauth2.googleapis.com/tokeninfo';
  let res;
  try {
    res = await fetch(`${endpoint}?id_token=${encodeURIComponent(credential)}`);
  } catch {
    return json(502, { error: { kind: 'upstream_unreachable', message: 'Couldn’t reach Google to confirm your sign-in. Please try again.' } });
  }
  const info = await res.json().catch(() => ({}));
  const fail401 = message => json(401, { error: { kind: 'auth_invalid', message } });
  if (!res.ok || info.error || info.error_description) return fail401('Google couldn’t confirm this sign-in. Please try again.');
  if (info.aud !== clientId) return fail401('This Google sign-in was issued for a different app (client ID mismatch).');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) return fail401('This sign-in didn’t come from Google.');
  if (Number(info.exp) * 1000 < Date.now()) return fail401('This Google sign-in has expired. Please try again.');
  if (!(info.email_verified === true || info.email_verified === 'true')) return fail401('Please verify your Google account’s email address first.');
  return json(200, { user: { id: info.sub, name: info.name || info.email, email: info.email, picture: info.picture || '' } });
}

/* ── entry point ─────────────────────────────────────── */
export async function handleAI(request, getEnv, meta = {}) {
  const env = k => {
    try {
      return String(getEnv(k) ?? '').trim();
    } catch {
      return '';
    }
  };
  const url = new URL(request.url);
  // Hosts that rewrite /api/ai/<route> to one function pass the route as ?__route= (Vercel).
  const route = (url.searchParams.get('__route') ?? url.pathname.replace(/^.*\/api\/ai\/?/, '')).replace(/^\/|\/$/g, '');
  const ip = meta.ip || request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const found = findKey(env);
  if (found.key && found.from !== 'GROQ_API_KEY') console.warn(`[ai] Using the Groq key from ${found.from}. Rename the variable to GROQ_API_KEY when you can.`);
  const ctx = {
    key: found.key,
    keyFrom: found.from,
    noKey: noKeyDetail(found),
    env,
    ip,
    providers: providersFrom(env, { key: found.key, base: (env('GROQ_API_BASE') || 'https://api.groq.com/openai/v1').replace(/\/$/, '') }),
    base: (env('GROQ_API_BASE') || 'https://api.groq.com/openai/v1').replace(/\/$/, '')
  };

  if (!originAllowed(request, env('ALLOWED_ORIGINS'))) return fail('forbidden_origin');

  // Last-line flood guard per network address. Per-student fair use lives in quota.js, so this is
// set high enough that a whole school on one Wi-Fi isn't blocked.
  const perMinute = parseInt(env('RATE_LIMIT_PER_MINUTE'), 10) || 600;

  if (route === 'health' && request.method === 'GET') {
    // Connection tests spend real AI requests, so they're for the site owner only:
    // `npm run dev`, or ?admin=<ADMIN_TOKEN> if you set ADMIN_TOKEN on your host.
    if (url.searchParams.get('test')) {
      const admin = env('ADMIN_TOKEN');
      const owner = env('EUREKA_DEV_PLANS') === '1' || (admin && (url.searchParams.get('admin') === admin || request.headers.get('x-eureka-admin') === admin));
      if (!owner) return json(403, { ok: false, error: { kind: 'forbidden', message: 'Connection tests are only available to the site owner.' } });
    }
    if (url.searchParams.get('test') && rateLimited(`test:${ip}`, 6)) return fail('rate_limited', { retryAfter: 60 });
    if (url.searchParams.get('test') === 'all') {
      if (!ctx.providers.length) return fail('no_key', { detail: ctx.noKey });
      return testAll(request, ctx);
    }
    return health(request, ctx, env);
  }
  if (route === 'auth' && request.method === 'POST') {
    if (rateLimited(`auth:${ip}`, 20)) return fail('rate_limited', { retryAfter: 60 });
    return verifyGoogle(request, env);
  }
  if (route === 'catalog' && request.method === 'GET')
    return json(200, publicCatalog(), { 'cache-control': 'public, max-age=3600' });
  if (!ctx.providers.length) return fail('no_key', { detail: ctx.noKey });
  if (route === 'models' && request.method === 'GET') return models(ctx);
  if (route === 'chat' && request.method === 'POST') {
    if (rateLimited(`chat:${ip}`, perMinute)) return fail('rate_limited', { retryAfter: 60 });
    return chat(request, ctx);
  }
  if (route === 'plan' && request.method === 'POST') return activate(request, env, ip);
  if (route === 'plan' && request.method === 'GET') {
    const pass = await verifyPlan(env, request.headers.get('x-eureka-plan'));
    return json(200, { tier: pass?.tier ?? 'free', billing: pass?.billing ?? null, until: pass?.exp ?? null, billingSetUp: Boolean(env('WHOP_API_KEY')), ownerKeySet: ownerKey(env).length >= 24, version: 'owner-2' });
  }
  if (route === 'task' && request.method === 'POST') {
    if (rateLimited(`chat:${ip}`, perMinute)) return fail('rate_limited', { retryAfter: 60 });
    return task(request, ctx);
  }
  return json(404, { error: { kind: 'not_found', message: 'Unknown EUREKA API route.' } });
}
