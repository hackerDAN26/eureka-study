// Live rate-limit tracking per model, so several students can use EUREKA at the same time.
//
// Groq gives every model its OWN tokens-per-minute and tokens-per-day allowance (8,000 TPM
// and 200,000 TPD each on the free plan). Every Groq response says how much is left
// (x-ratelimit-remaining-tokens, x-ratelimit-reset-tokens). EUREKA records that, adds what's
// already in flight, and sends each request to a model with room — instead of piling
// everyone onto one model and showing "busy" while the others sit idle.
import { setLimit } from './context.js';

const state = new Map(); // model → { limit, remaining, at, fullAt, blockedUntil, inflight: [{ n, until }] }
const get = model => {
  if (!state.has(model)) state.set(model, { limit: 0, remaining: null, at: 0, fullAt: 0, blockedUntil: 0, inflight: [] });
  return state.get(model);
};

// "7.66s", "1m2.5s", "2h3m4s", "120ms" → milliseconds
export function parseDuration(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  let ms = 0;
  let matched = false;
  for (const [, n, unit] of s.matchAll(/([\d.]+)\s*(ms|h|m|s)/g)) {
    matched = true;
    ms += Number(n) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  }
  return matched ? ms : null;
}

// Read Groq's rate-limit headers from any response (success or error).
export function observe(model, headers, now = Date.now()) {
  const s = get(model);
  const limit = Number(headers.get('x-ratelimit-limit-tokens'));
  const remaining = Number(headers.get('x-ratelimit-remaining-tokens'));
  const reset = parseDuration(headers.get('x-ratelimit-reset-tokens'));
  if (Number.isFinite(limit) && limit > 0) {
    s.limit = limit;
    setLimit(model, limit);
  }
  if (Number.isFinite(remaining) && headers.has('x-ratelimit-remaining-tokens')) {
    s.remaining = remaining;
    s.at = now;
    s.fullAt = now + (reset ?? 60_000);
  }
}

// After a 429: nothing will be admitted on this model until the wait is over.
export function block(model, seconds, now = Date.now()) {
  const s = get(model);
  s.blockedUntil = Math.max(s.blockedUntil, now + Math.max(1, seconds ?? 10) * 1000);
}

// Tokens this model can probably take right now (the allowance refills steadily).
export function available(model, now = Date.now()) {
  const s = get(model);
  if (now < s.blockedUntil) return 0;
  s.inflight = s.inflight.filter(x => x.until > now);
  const pending = s.inflight.reduce((a, x) => a + x.n, 0);
  if (s.remaining == null) return Infinity - pending; // not seen yet: assume room
  const span = Math.max(1, s.fullAt - s.at);
  const refilled = s.limit ? Math.min(s.limit, s.remaining + ((s.limit - s.remaining) * Math.max(0, now - s.at)) / span) : s.remaining;
  return refilled - pending;
}

// When the model is expected to have `need` tokens free (ms from now).
export function waitFor(model, need, now = Date.now()) {
  const s = get(model);
  if (now < s.blockedUntil) return s.blockedUntil - now;
  if (available(model, now) >= need) return 0;
  if (!s.limit || s.remaining == null) return 5_000;
  const perMs = (s.limit - s.remaining) / Math.max(1, s.fullAt - s.at);
  return perMs > 0 ? Math.ceil((need - available(model, now)) / perMs) : 60_000;
}

// Count a request against a model until Groq's own numbers catch up (≈ 20 s).
export function reserve(model, n, now = Date.now()) {
  get(model).inflight.push({ n, until: now + 20_000 });
}

// Preferred order first, but models with room jump ahead of those without.
export function byCapacity(models, needOf, now = Date.now()) {
  const rows = models.map((m, i) => ({ m, i, need: needOf(m), free: available(m, now) }));
  const ready = rows.filter(r => r.free >= r.need);
  const later = rows.filter(r => r.free < r.need).sort((a, b) => waitFor(a.m, a.need, now) - waitFor(b.m, b.need, now) || a.i - b.i);
  return [...ready, ...later].map(r => r.m);
}

export const _state = state; // for tests
