// Shared server storage for quotas, plan lookups and usage analytics.
//
// Uses Upstash Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or Vercel KV's
// KV_REST_API_URL + KV_REST_API_TOKEN) so every server instance sees the same numbers.
// Without it, values live in this instance's memory: fine for one server, approximate on
// serverless hosts that run many instances.

export function redisFrom(env) {
  const url = env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN');
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
export const storageKind = env => (redisFrom(env) ? 'redis' : 'memory');

async function redisPipeline(env, commands) {
  const redis = redisFrom(env);
  if (!redis) return null;
  try {
    const res = await fetch(`${redis.url}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${redis.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout?.(2500)
    });
    if (!res.ok) return null;
    return (await res.json()).map(r => r?.result ?? null);
  } catch {
    return null;
  }
}

/* ── in-memory fallback with the same command semantics ── */
const strings = new Map(); // key → { v, until }
const hashes = new Map();
const zsets = new Map();
const sets = new Map();
const expiry = new Map(); // key → ms timestamp
const alive = key => {
  const t = expiry.get(key);
  if (t && t < Date.now()) {
    strings.delete(key);
    hashes.delete(key);
    zsets.delete(key);
    sets.delete(key);
    expiry.delete(key);
    return false;
  }
  return true;
};
const exists = key => alive(key) && (strings.has(key) || hashes.has(key) || zsets.has(key) || sets.has(key));
function sweep() {
  if (expiry.size < 50_000) return;
  const now = Date.now();
  for (const [k, t] of expiry) if (t < now) alive(k);
}
function memRun(commands) {
  sweep();
  const out = [];
  for (const [rawCmd, key, ...a] of commands) {
    const cmd = String(rawCmd).toUpperCase();
    alive(key);
    switch (cmd) {
      case 'INCR':
      case 'INCRBY':
      case 'DECR':
      case 'DECRBY': {
        const by = cmd === 'INCR' ? 1 : cmd === 'DECR' ? -1 : cmd === 'INCRBY' ? Number(a[0]) : -Number(a[0]);
        const v = (Number(strings.get(key)) || 0) + by;
        strings.set(key, String(v));
        out.push(v);
        break;
      }
      case 'GET':
        out.push(strings.has(key) ? strings.get(key) : null);
        break;
      case 'SET': {
        const nx = a.map(x => String(x).toUpperCase()).includes('NX');
        if (nx && exists(key)) {
          out.push(null);
          break;
        }
        strings.set(key, String(a[0]));
        const ex = a.findIndex(x => String(x).toUpperCase() === 'EX');
        if (ex >= 0) expiry.set(key, Date.now() + Number(a[ex + 1]) * 1000);
        else expiry.delete(key);
        out.push('OK');
        break;
      }
      case 'DEL': {
        const had = exists(key);
        strings.delete(key);
        hashes.delete(key);
        zsets.delete(key);
        sets.delete(key);
        expiry.delete(key);
        out.push(had ? 1 : 0);
        break;
      }
      case 'EXPIRE': {
        const nx = String(a[1] ?? '').toUpperCase() === 'NX';
        if (!exists(key) || (nx && expiry.has(key))) out.push(0);
        else {
          expiry.set(key, Date.now() + Number(a[0]) * 1000);
          out.push(1);
        }
        break;
      }
      case 'TTL':
        out.push(!exists(key) ? -2 : expiry.has(key) ? Math.ceil((expiry.get(key) - Date.now()) / 1000) : -1);
        break;
      case 'HINCRBY': {
        const h = hashes.get(key) ?? hashes.set(key, {}).get(key);
        h[a[0]] = (Number(h[a[0]]) || 0) + Number(a[1]);
        out.push(h[a[0]]);
        break;
      }
      case 'HSET': {
        const h = hashes.get(key) ?? hashes.set(key, {}).get(key);
        for (let i = 0; i < a.length; i += 2) h[a[i]] = String(a[i + 1]);
        out.push(1);
        break;
      }
      case 'HGET':
        out.push(hashes.get(key)?.[a[0]] ?? null);
        break;
      case 'HGETALL':
        out.push(Object.entries(hashes.get(key) ?? {}).flat());
        break;
      case 'ZINCRBY': {
        const z = zsets.get(key) ?? zsets.set(key, new Map()).get(key);
        z.set(a[1], (z.get(a[1]) ?? 0) + Number(a[0]));
        out.push(String(z.get(a[1])));
        break;
      }
      case 'ZREVRANGE': {
        const z = [...(zsets.get(key) ?? new Map())].sort((x, y) => y[1] - x[1]).slice(Number(a[0]), Number(a[1]) + 1);
        out.push(z.flatMap(([m, s]) => [m, String(s)]));
        break;
      }
      case 'PFADD': {
        const s = sets.get(key) ?? sets.set(key, new Set()).get(key);
        a.forEach(x => s.add(x));
        out.push(1);
        break;
      }
      case 'PFCOUNT':
        out.push(sets.get(key)?.size ?? 0);
        break;
      default:
        out.push(null);
    }
  }
  return out;
}

// Run Redis commands (one round trip). Falls back to memory if Redis is missing or unreachable.
export async function run(env, commands) {
  if (!commands.length) return [];
  return (await redisPipeline(env, commands)) ?? memRun(commands);
}

export async function getJSON(env, key) {
  const [v] = await run(env, [['GET', key]]);
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
export const setJSON = (env, key, value, ttlSec) => run(env, [['SET', key, JSON.stringify(value), 'EX', String(Math.max(1, Math.round(ttlSec)))]]);
export const del = (env, ...keys) => run(env, keys.map(k => ['DEL', k]));

export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
