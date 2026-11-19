// EUREKA's AI cost settings, all in one place. Change the defaults here, or override them
// on your host without touching code:
//
//   MODEL_PRICES_JSON  {"openai/gpt-oss-120b":{"input":0.15,"output":0.60}}
//                      USD per 1M tokens. A key can also be "provider|model" (e.g.
//                      "openrouter|openai/gpt-oss-120b") when a backup provider charges differently.
//   PLAN_LIMITS_JSON   {"pro":{"daily":700,"monthlyBudgetUSD":8}}  — merged over the defaults below.
//   VISION_PLANS       which plans may send images to the AI (default "max").

// USD per 1M tokens. cachedInput: Groq bills cached prompt tokens at a discount.
export const DEFAULT_PRICES = {
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3, cachedInput: 0.0375 },
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6, cachedInput: 0.075 },
  'qwen/qwen3.8-27b': { input: 0.8, output: 4.0, cachedInput: 0.4 }
};

// Which models each plan may call. Checked by the server on every request, including
// fallbacks and overflow — a model not listed for a plan is never sent that plan's requests.
// (Groq's alternative names for the same models are covered automatically.)
export const PLAN_MODELS = {
  guest: ['openai/gpt-oss-20b'],
  free: ['openai/gpt-oss-20b'],
  pro: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  max: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b']
};

// Per plan ("guest" = Free without signing in):
//   daily             AI requests per student per day (chat messages + revision-tool requests).
//                     Free and guest are exact; Pro and Max are abuse ceilings above what the app
//                     shows, to leave room for seasonal boosts and rewards.
//   monthly           AI requests per calendar month (0 = no monthly limit).
//   webDaily          web/specification searches per day (0 = no server limit).
//   perMinute         burst limit per student.
//   monthlyBudgetUSD  estimated AI cost one student may use per calendar month. Reaching it
//                     pauses AI for that student until the 1st; 0 = no cap.
//   escalateUntil     Max only: share of the monthly budget after which hard questions stop
//                     escalating to Qwen and stay on GPT-OSS 120B (keeps heavy users predictable).
export const DEFAULT_PLAN_LIMITS = {
  guest: { daily: 5, monthly: 30, webDaily: 1, perMinute: 6, monthlyBudgetUSD: 0.1 },
  free: { daily: 15, monthly: 200, webDaily: 3, perMinute: 6, monthlyBudgetUSD: 0.5 },
  pro: { daily: 700, monthly: 0, webDaily: 0, perMinute: 15, monthlyBudgetUSD: 8 },
  max: { daily: 2200, monthly: 0, webDaily: 0, perMinute: 25, monthlyBudgetUSD: 20, escalateUntil: 0.8 }
};

export const DEFAULT_VISION_PLANS = ['max'];

// PLAN_MODELS_JSON overrides the model lists, e.g. {"pro":["openai/gpt-oss-20b","openai/gpt-oss-120b"]}.
export function planModelsFrom(env) {
  const raw = env('PLAN_MODELS_JSON');
  return once('models', raw, () => {
    const out = Object.fromEntries(Object.entries(PLAN_MODELS).map(([k, v]) => [k, [...v]]));
    for (const [k, v] of Object.entries(parse(raw) ?? {})) if (k in out && Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string' && x.length < 100);
    return out;
  });
}

const parse = text => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};
const cache = new Map();
const once = (name, text, build) => {
  const key = `${name}:${text}`;
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
};

export function pricesFrom(env) {
  const raw = env('MODEL_PRICES_JSON');
  return once('prices', raw, () => {
    const out = { ...DEFAULT_PRICES };
    for (const [k, v] of Object.entries(parse(raw) ?? {})) {
      const input = Number(v?.input);
      const output = Number(v?.output);
      if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
      const cached = Number(v?.cachedInput);
      out[k] = { input, output, cachedInput: Number.isFinite(cached) ? cached : input / 2 };
    }
    return out;
  });
}

export function limitsFrom(env) {
  const raw = env('PLAN_LIMITS_JSON');
  return once('limits', raw, () => {
    const extra = parse(raw) ?? {};
    const out = {};
    for (const tier of Object.keys(DEFAULT_PLAN_LIMITS)) {
      out[tier] = { ...DEFAULT_PLAN_LIMITS[tier] };
      for (const [k, v] of Object.entries(extra[tier] ?? {})) if (k in DEFAULT_PLAN_LIMITS[tier] || k === 'escalateUntil') if (Number.isFinite(Number(v)) && Number(v) >= 0) out[tier][k] = Number(v);
    }
    return out;
  });
}

export function visionPlans(env) {
  const raw = env('VISION_PLANS');
  if (!raw) return DEFAULT_VISION_PLANS;
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// Price of a model (by EUREKA id, Groq alternative name or a backup provider's name).
// Unknown models are priced like the most expensive one, so estimates never come out low.
export function priceOf(model, prices, provider = 'groq') {
  const exact = prices[`${provider}|${model}`] ?? prices[model];
  if (exact) return exact;
  const m = String(model).toLowerCase();
  const family = /qwen/.test(m) ? 'qwen/qwen3.8-27b' : /120b/.test(m) ? 'openai/gpt-oss-120b' : /20b/.test(m) ? 'openai/gpt-oss-20b' : null;
  if (family && prices[family]) return prices[family];
  return Object.values(prices).reduce((a, b) => (b.output > a.output ? b : a));
}

// Estimated cost in USD for one request.
export function costOf({ model, provider, input = 0, output = 0, cached = 0 }, prices) {
  const p = priceOf(model, prices, provider);
  const fresh = Math.max(0, input - cached);
  return (fresh * p.input + Math.min(cached, input) * (p.cachedInput ?? p.input) + output * p.output) / 1e6;
}
