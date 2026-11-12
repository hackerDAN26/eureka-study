// EUREKA ↔ EUREKA server ↔ Groq.
// The browser never sees the API key: it calls /api/ai on our own server
// (netlify/edge-functions/ai.js in production, server/vite-plugin.js in development),
// which adds the key from the GEMINI_API_KEY environment variable.
const API = `${(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')}/api/ai`;

// Remove keys and settings that older EUREKA versions kept in the browser.
try {
  for (const k of ['eureka.geminiKey', 'eureka.geminiRoute']) localStorage.removeItem(k);
} catch {}

// Best first. Plans: Max → GPT-OSS 120B · Pro → Qwen 3.8 · Free → GPT-OSS 20B (all on Groq).
export const MODELS = [
  { key: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', tag: 'Best' },
  { key: 'qwen/qwen3.8-27b', name: 'Qwen 3.8', tag: 'Smart · reads images' },
  { key: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', tag: 'Fast' }
];

// Reasoning effort sent to the model: low, medium or high.
export const EFFORTS = ['Low', 'Medium', 'High'];

const isCloneError = e => e?.name === 'DataCloneError' || /could not be cloned/i.test(e?.message || '');
const abortError = () => new DOMException('Stopped', 'AbortError');

// Some previews relay fetch through postMessage, which can't carry an AbortSignal.
// The signed plan pass from /api/ai/plan. The server decides what each request may use;
// the dev-plan header only works on the local `npm run dev` server.
let planToken = '';
let devPlan = '';
export function setPlanAuth({ token, preview } = {}) {
  planToken = token || '';
  devPlan = import.meta.env?.DEV ? preview || '' : '';
}
// A random id for this browser, so the server can apply fair-use limits per student.
let deviceId = '';
const device = () => {
  if (deviceId) return deviceId;
  try {
    deviceId = localStorage.getItem('eureka.device') || '';
    if (!deviceId) localStorage.setItem('eureka.device', (deviceId = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9-]/g, '')));
  } catch {
    deviceId = deviceId || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
  return deviceId;
};
const planHeaders = () => ({ 'x-eureka-device': device(), ...(planToken ? { 'x-eureka-plan': planToken } : {}), ...(devPlan ? { 'x-eureka-dev-plan': devPlan } : {}) });

async function safeFetch(url, init, signal) {
  if (signal) {
    try {
      return await fetch(url, { ...init, signal });
    } catch (e) {
      if (!isCloneError(e)) throw e;
    }
  }
  const request = fetch(url, init);
  if (!signal) return request;
  return Promise.race([
    request,
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }))
  ]);
}

// Is EUREKA running inside a preview frame that blocks outside connections?
export const IS_PREVIEW_BUILD = typeof __EUREKA_PREVIEW__ !== 'undefined' && __EUREKA_PREVIEW__;

export function blockedPreview() {
  if (IS_PREVIEW_BUILD) return true;
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  const patchedFetch = !/\[native code\]/.test(Function.prototype.toString.call(window.fetch));
  return framed && (patchedFetch || location.origin === 'null');
}

/* ── errors ──────────────────────────────────────────── */
// What students see. Set-up problems (keys, billing) get a calm generic message on the live
// site; the technical titles below are only used on `npm run dev`.
const STUDENT_TITLES = {
  no_key: 'EUREKA’s AI is taking a short break.',
  invalid_key: 'EUREKA’s AI is taking a short break.',
  no_credits: 'EUREKA’s AI is taking a short break.',
  forbidden: 'That model isn’t available right now.',
  quota: 'EUREKA is busy right now.',
  rate_limited: 'Slow down a little.',
  daily_limit: 'That’s today’s AI allowance used.',
  upstream_unreachable: 'EUREKA couldn’t answer just now.',
  bad_request: 'EUREKA couldn’t answer just now.',
  unavailable: 'EUREKA is busy right now.',
  too_large: 'That’s a lot to read at once.'
};
const STUDENT_MESSAGES = {
  no_key: 'We’re fixing it — please try again a little later. If it keeps happening, email eurekasofficial@gmail.com.',
  invalid_key: 'We’re fixing it — please try again a little later. If it keeps happening, email eurekasofficial@gmail.com.',
  no_credits: 'We’re fixing it — please try again a little later. If it keeps happening, email eurekasofficial@gmail.com.'
};
const TITLES = {
  no_key: 'The AI isn’t set up on the server.',
  invalid_key: 'Groq rejected the API key.',
  no_credits: 'The Groq account needs billing for this.',
  forbidden: 'This API key can’t use that model.',
  quota: 'The AI’s rate limit was reached.',
  model_unavailable: 'That model isn’t available.',
  bad_request: 'The AI couldn’t process that.',
  unavailable: 'The AI is busy right now.',
  upstream_unreachable: 'The server couldn’t reach Groq.',
  rate_limited: 'Slow down a little.',
  too_large: 'That’s too large to send.',
  forbidden_origin: 'This site isn’t allowed to use EUREKA’s AI.',
  blocked: 'The AI declined to answer.',
  network: 'Couldn’t reach the EUREKA server.',
  no_server: 'EUREKA’s AI server isn’t running on this site.',
  failed: 'Something went wrong.'
};

export class AIError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'AIError';
    this.kind = kind;
    this.title = (!import.meta.env?.DEV && STUDENT_TITLES[kind]) || TITLES[kind] || TITLES.failed;
    if (!import.meta.env?.DEV && STUDENT_MESSAGES[kind]) this.message = STUDENT_MESSAGES[kind];
    Object.assign(this, extra);
  }
}

const NO_SERVER_HELP =
  'The page loaded, but /api/ai isn’t answering. If you deployed by dragging files into Netlify, the server function wasn’t included — deploy through GitHub or the Netlify CLI and set XAI_API_KEY (README → Deploy). On your computer, run npm run dev.';

const isOurJson = res => /application\/json/i.test(res.headers.get('content-type') || '');

async function errorFrom(res) {
  if (!isOurJson(res)) return new AIError('no_server', `${NO_SERVER_HELP} (HTTP ${res.status})`, { status: res.status });
  let e = {};
  try {
    e = (await res.json())?.error ?? {};
  } catch {}
  const kind = e.kind ?? (res.status === 404 ? 'network' : 'failed');
  const dev = Boolean(import.meta.env?.DEV);
  let message = e.message ?? `The server returned ${res.status}.`;
  const wait = Number.isFinite(e.retryAfter) ? e.retryAfter : parseInt(res.headers.get('retry-after') ?? '', 10);
  // Students see friendly messages; Groq's raw errors are only shown on `npm run dev`.
  if (kind === 'quota' || kind === 'rate_limited')
    message = `Lots of students are studying right now, so EUREKA needs a short pause. ${Number.isFinite(wait) && wait > 0 ? (wait > 90 ? `Please try again in about ${Math.ceil(wait / 60)} minutes.` : `Please try again in about ${wait} seconds.`) : 'Please try again in a moment.'}`;
  if (kind === 'rate_limited') message = `You’re sending messages very quickly. Wait ${Number.isFinite(wait) && wait > 0 ? `${wait} seconds` : 'a moment'} and try again.`;
  if (kind === 'daily_limit') message = 'You’ve used today’s AI allowance on your plan. It resets at midnight (UTC) — or upgrade for more.';
  if (kind === 'too_large') message = 'That was a lot to read in one go. Try a shorter message, or ask about a specific page or section of your notes.';
  if (kind === 'unavailable' || kind === 'upstream_unreachable' || kind === 'failed' || kind === 'bad_request') message = 'EUREKA couldn’t answer just now. Please try again in a moment.';
  if (kind === 'model_unavailable' || kind === 'forbidden') message = 'This AI model isn’t available right now. Pick another model from the menu and try again.';
  if (kind === 'network' && res.status === 404)
    message = dev ? 'The /api/ai endpoint wasn’t found. Deploy with the AI function included (see README), or run npm run dev locally.' : 'EUREKA’s AI service isn’t reachable right now. Please try again later.';
  if (kind === 'no_key' && e.detail) message += dev ? ` ${e.detail}` : '';
  if (dev && e.detail && kind !== 'invalid_key' && kind !== 'no_key') message += ` (Groq said: ${e.detail})`;
  if (dev && Array.isArray(e.tried) && e.tried.length > 1)
    message += ` Tried: ${e.tried.map(t => `${t.model} (${(t.kind || 'failed').replace(/_/g, ' ')})`).join(', ')}.`;
  return new AIError(kind, message, { status: res.status, retryAfter: Number.isFinite(wait) ? wait : null });
}

const networkError = () =>
  new AIError(
    'network',
    blockedPreview()
      ? 'This preview window blocks connections. Open EUREKA from its website instead.'
      : 'Check your internet connection. If you opened EUREKA as a file, it needs to run from its website (or npm run dev) so it can reach its server.'
  );

/* ── API ─────────────────────────────────────────────── */
export async function discoverModels() {
  try {
    const res = await safeFetch(`${API}/models`, { headers: { accept: 'application/json' } });
    if (!res.ok) return MODELS;
    const { models } = await res.json();
    return Array.isArray(models) && models.length ? models : MODELS;
  } catch {
    return MODELS;
  }
}

// Qualifications, boards and subjects for the onboarding picker (names only).
export async function fetchCatalog() {
  if (typeof __EMBED_CATALOG__ !== 'undefined' && __EMBED_CATALOG__) return __EMBED_CATALOG__;
  const res = await safeFetch(`${API}/catalog`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return res.json();
}

// Questions about the specification itself trigger a lookup of the official spec.
export const SPEC_QUESTION =
  /\b(spec|specification|syllabus|on the (spec|syllabus|exam)|exam board|required practicals?|set texts?|command words?|assessment objectives?|\bAO[1-4]\b|what (topics|do i need to know)|paper [1-3]|component [1-3]|grade boundar|mark scheme)/i;

// For Settings → "Test AI connection": the server makes one real Groq request.
export async function checkConnection() {
  let res;
  try {
    res = await safeFetch(`${API}/health?test=1`, { headers: { accept: 'application/json' } });
  } catch {
    throw networkError();
  }
  if (!isOurJson(res)) throw new AIError('no_server', `${NO_SERVER_HELP} (HTTP ${res.status})`);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (data.test?.ok) return data;
  const kind = data.test?.kind ?? data.error?.kind ?? (res.status === 404 ? 'network' : 'failed');
  const message =
    res.status === 404
      ? 'The /api/ai endpoint wasn’t found on this site. Deploy with the edge function (see README).'
      : (data.test?.message ?? data.error?.message ?? `The server returned ${res.status}.`) + (kind === 'no_key' && data.error?.detail ? ` ${data.error.detail}` : data.test?.detail && kind !== 'invalid_key' ? ` (Groq said: ${data.test.detail})` : '');
  throw new AIError(kind, message, { warnings: data.warnings });
}

// Tests every model on the server's key, one tiny request each.
export async function testModels() {
  let res;
  try {
    res = await safeFetch(`${API}/health?test=all`, { headers: { accept: 'application/json' } });
  } catch {
    throw networkError();
  }
  if (!isOurJson(res)) throw new AIError('no_server', `${NO_SERVER_HELP} (HTTP ${res.status})`);
  const data = await res.json();
  if (!res.ok) throw new AIError(data.error?.kind ?? 'failed', data.error?.message ?? `The server returned ${res.status}.`);
  return data.results;
}

export async function streamChat({ model, effort, subject, course, courses, specLookup, deadlines, customInstructions, studentModel, history, materials, webSearch, signal, onText }) {
  let res;
  try {
    res = await safeFetch(
      `${API}/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...planHeaders() },
        body: JSON.stringify({ model, effort, subject, course, courses, specLookup, deadlines, customInstructions, studentModel, history, materials, webSearch })
      },
      signal
    );
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw networkError();
  }
  if (signal?.aborted) throw abortError();
  if (!res.ok) throw await errorFrom(res);
  if (!/event-stream/i.test(res.headers.get('content-type') || '') && res.headers.get('content-type') && !/json/i.test(res.headers.get('content-type')))
    throw new AIError('no_server', `${NO_SERVER_HELP} (got ${res.headers.get('content-type')})`);

  let text = '';
  let signature = '';
  let finish = '';
  const sources = new Map();
  const handleLine = raw => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return;
    let chunk;
    try {
      chunk = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    if (chunk.error) throw new AIError('failed', chunk.error.message || 'The AI stopped unexpectedly.');
    const cand = chunk.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      if (part.thoughtSignature) signature = part.thoughtSignature;
      if (part.text && !part.thought) {
        text += part.text;
        onText(text);
      }
    }
    for (const g of cand?.groundingMetadata?.groundingChunks ?? []) {
      if (g.web?.uri) sources.set(g.web.uri, g.web.title || g.web.uri);
    }
    if (cand?.finishReason) finish = cand.finishReason;
    if (chunk.promptFeedback?.blockReason) throw new AIError('blocked', `The AI blocked this prompt (${chunk.promptFeedback.blockReason}). Try rephrasing it.`);
  };

  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const stop = () => reader.cancel().catch(() => {});
    signal?.addEventListener('abort', stop, { once: true });
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n')) >= 0) {
          handleLine(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 1);
        }
      }
      if (buffer) handleLine(buffer);
    } catch (e) {
      if (signal?.aborted) throw abortError();
      if (e instanceof AIError) throw e;
      throw new AIError('failed', 'The connection dropped while the AI was answering. Please try again.');
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  } else {
    (await res.text()).split('\n').forEach(handleLine);
  }
  if (signal?.aborted) throw abortError();
  if (!text && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(finish))
    throw new AIError('blocked', 'The AI declined to answer this one. Try rephrasing it.');

  return {
    text,
    signature,
    sources: [...sources].map(([uri, title]) => ({ uri, title })),
    model: res.headers.get('x-eureka-model') || model,
    fellBackFrom: res.headers.get('x-eureka-fallback-from') || '',
    fallbackReason: res.headers.get('x-eureka-fallback-reason') || '',
    serverPlan: res.headers.get('x-eureka-plan') || '',
    searchDropped: res.headers.get('x-eureka-note') === 'search_unavailable'
  };
}

// Structured study tasks: 'topics' | 'question' | 'mark' | 'flashcards' | 'coach'.
// Returns the parsed JSON the server validated.
export async function runTask(task, { model, course, studentModel, input, signal } = {}) {
  let res;
  try {
    res = await safeFetch(
      `${API}/task`,
      { method: 'POST', headers: { 'content-type': 'application/json', ...planHeaders() }, body: JSON.stringify({ task, model, course, studentModel, input }) },
      signal
    );
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw networkError();
  }
  if (!res.ok) throw await errorFrom(res);
  if (!isOurJson(res)) throw new AIError('no_server', NO_SERVER_HELP);
  const body = await res.json();
  return { ...body.data, _model: body.model, _fellBackFrom: body.fellBackFrom, _plan: body.plan };
}

// Checks a Whop license key on the server. Returns { tier, billing, until, token }.
export async function activatePlan(licenseKey) {
  let res;
  try {
    res = await safeFetch(`${API}/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ licenseKey: String(licenseKey).trim() }) });
  } catch {
    throw networkError();
  }
  if (!isOurJson(res)) throw new AIError('no_server', NO_SERVER_HELP);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AIError(body.error?.kind ?? 'failed', body.error?.message ?? 'Activation failed. Please try again.');
  return body;
}
