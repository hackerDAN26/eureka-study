// Fair use, enforced on the server — so one student (or a script) can't use up the AI for
// everyone. Counted per student and per network address:
//   • per minute: a burst limit (no one can fire dozens of requests at once)
//   • per day:    a ceiling per plan (generous: the app shows the exact daily limits)
//
// With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or Vercel KV's KV_REST_API_URL +
// KV_REST_API_TOKEN) the counts are shared by every server instance. Without them they are
// kept in memory per instance — fine for small sites, approximate for big ones.

export const PLAN_DAILY = { free: 60, pro: 700, max: 2200 }; // ≈ 2× the in-app limits (boosts, rewards)
const PER_MINUTE = { free: 8, pro: 15, max: 25 };
// Free students on one network (a school's shared Wi-Fi) share these; paying members are exempt.
// Override with NETWORK_DAILY_LIMIT / NETWORK_MINUTE_LIMIT on your host.
const NETWORK_DAILY = 6000;
const NETWORK_MINUTE = 600;
const num = (v, d) => (Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) > 0 ? parseInt(v, 10) : d);

const memory = new Map();
function memIncr(key, ttlSec) {
  const now = Date.now();
  const e = memory.get(key);
  if (!e || e.until < now) {
    memory.set(key, { n: 1, until: now + ttlSec * 1000 });
    if (memory.size > 50_000) for (const [k, v] of memory) if (v.until < now) memory.delete(k);
    return 1;
  }
  e.n += 1;
  return e.n;
}

function redisFrom(env) {
  const url = env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN');
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

// INCR several counters in one round trip; falls back to memory if Redis is unreachable.
async function incrAll(env, items) {
  const redis = redisFrom(env);
  if (redis) {
    try {
      const commands = items.flatMap(({ key, ttl }) => [
        ['INCR', key],
        ['EXPIRE', key, String(ttl), 'NX']
      ]);
      const res = await fetch(`${redis.url}/pipeline`, {
        method: 'POST',
        headers: { authorization: `Bearer ${redis.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout?.(1500)
      });
      if (res.ok) {
        const out = await res.json();
        return items.map((_, i) => Number(out[i * 2]?.result) || 0);
      }
    } catch {}
  }
  return items.map(({ key, ttl }) => memIncr(key, ttl));
}

const day = () => new Date().toISOString().slice(0, 10);
const minute = () => Math.floor(Date.now() / 60_000);
const clean = id => String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

// student: a verified plan membership, else the browser's device id; ip: the network.
export async function checkQuota(env, { plan = 'free', member, device, ip, cost = 1 }) {
  if (env('EUREKA_DEV_PLANS') === '1') return { ok: true }; // npm run dev
  const who = member ? `m:${clean(member)}` : device ? `d:${clean(device)}` : `i:${clean(ip)}`;
  const net = `n:${clean(ip) || 'unknown'}`;
  const d = day();
  const m = minute();
  const items = [
    { key: `eq:${d}:${who}`, ttl: 172_800 },
    { key: `eqm:${m}:${who}`, ttl: 120 },
    { key: `eq:${d}:${net}`, ttl: 172_800 },
    { key: `eqm:${m}:${net}`, ttl: 120 }
  ];
  let counts = [0, 0, 0, 0];
  for (let i = 0; i < cost; i++) counts = await incrAll(env, items);
  const [daily, perMin, netDaily, netMin] = counts;
  const limit = PLAN_DAILY[plan] ?? PLAN_DAILY.free;
  if (daily > limit) return { ok: false, kind: 'daily_limit', retryAfter: secondsToMidnight() };
  if (perMin > (PER_MINUTE[plan] ?? PER_MINUTE.free)) return { ok: false, kind: 'rate_limited', retryAfter: 60 - (Math.floor(Date.now() / 1000) % 60) };
  if (!member && (netDaily > num(env('NETWORK_DAILY_LIMIT'), NETWORK_DAILY) || netMin > num(env('NETWORK_MINUTE_LIMIT'), NETWORK_MINUTE))) return { ok: false, kind: 'rate_limited', retryAfter: 60 - (Math.floor(Date.now() / 1000) % 60) };
  return { ok: true, used: daily, limit };
}

function secondsToMidnight() {
  const now = new Date();
  return Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now) / 1000);
}
