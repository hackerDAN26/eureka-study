// AI providers EUREKA can use. Groq is the main one; add any of the others by setting
// their key on your host, and EUREKA spreads requests across all of them, moving to the
// next one whenever a provider is full or down. All of them serve the same open models
// through OpenAI-compatible chat-completions APIs.
//
//   GROQ_API_KEY        Groq (main): GPT-OSS 120B, GPT-OSS 20B, Qwen 3.8 (images), web search
//   OPENROUTER_API_KEY  OpenRouter: GPT-OSS 120B + 20B, served by many hosting companies with
//                       automatic failover between them — the big overflow for busy times
//   CEREBRAS_API_KEY    Cerebras: GPT-OSS 120B, very fast
//   AI_PROVIDER_1_BASE / _KEY / _MODELS   any other OpenAI-compatible provider (up to 3):
//                       _MODELS maps EUREKA's model names to theirs, e.g.
//                       "openai/gpt-oss-120b=gpt-oss-120b,openai/gpt-oss-20b=gpt-oss-20b"

const PRESETS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    baseEnv: 'OPENROUTER_API_BASE',
    base: 'https://openrouter.ai/api/v1',
    dialect: 'openrouter',
    models: { 'openai/gpt-oss-120b': 'openai/gpt-oss-120b', 'openai/gpt-oss-20b': 'openai/gpt-oss-20b' }
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    keyEnv: 'CEREBRAS_API_KEY',
    baseEnv: 'CEREBRAS_API_BASE',
    base: 'https://api.cerebras.ai/v1',
    dialect: 'openai',
    models: { 'openai/gpt-oss-120b': 'gpt-oss-120b' }
  }
];

const parseModels = text =>
  Object.fromEntries(
    String(text ?? '')
      .split(',')
      .map(pair => pair.split('=').map(x => x.trim()))
      .filter(([a, b]) => a && b)
  );

// The configured providers, Groq first.
export function providersFrom(env, groq) {
  const list = [];
  if (groq.key)
    list.push({ id: 'groq', name: 'Groq', base: groq.base, key: groq.key, dialect: 'groq', models: null, headers: {} });
  for (const p of PRESETS) {
    const key = env(p.keyEnv);
    if (key) list.push({ ...p, key: key.trim(), base: (env(p.baseEnv) || p.base).replace(/\/$/, ''), headers: p.id === 'openrouter' ? { 'X-Title': 'EUREKA' } : {} });
  }
  for (let i = 1; i <= 3; i++) {
    const base = env(`AI_PROVIDER_${i}_BASE`);
    const key = env(`AI_PROVIDER_${i}_KEY`);
    const models = parseModels(env(`AI_PROVIDER_${i}_MODELS`));
    if (base && key && Object.keys(models).length)
      list.push({ id: `custom${i}`, name: env(`AI_PROVIDER_${i}_NAME`) || `Provider ${i}`, base: base.replace(/\/$/, ''), key: key.trim(), dialect: 'openai', models, headers: {} });
  }
  return list;
}

// A "slot" is one model at one provider; each has its own rate limit.
export const slotKey = slot => `${slot.provider.id}|${slot.remote}`;

export function slotsFor(model, providers) {
  const out = [];
  for (const provider of providers) {
    const remote = provider.models ? provider.models[model] : model;
    if (remote) out.push({ provider, model, remote, key: `${provider.id}|${remote}` });
  }
  return out;
}

// Turn EUREKA's request body (written for Groq) into what each provider accepts.
export function adaptBody(body, provider, variant) {
  if (provider.dialect === 'groq') return body;
  const { messages, max_completion_tokens: max, reasoning_effort: effort } = body;
  // Other providers: standard fields only (no Groq-only options, tools or images).
  const plain = messages.map(m => (Array.isArray(m.content) ? { ...m, content: m.content.filter(c => c.type === 'text').map(c => c.text).join('\n\n') } : m));
  const out = { messages: plain, max_tokens: max };
  if (variant < 2 && effort) {
    if (provider.dialect === 'openrouter') out.reasoning = { effort, exclude: true };
    else out.reasoning_effort = effort;
  } else if (provider.dialect === 'openrouter') out.reasoning = { exclude: true };
  return out;
}

// Rate limits nobody has told us about yet: Groq's free plan is small; the others are
// usually large (OpenRouter is credit-based with no fixed per-minute token limit).
export const defaultTpm = provider => (provider.id === 'groq' ? null : 200_000);
