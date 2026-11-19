// Token and cost tracking for every AI request, for the owner's usage dashboard and for
// per-student monthly budgets (server/config.js).
//
// Stored per calendar month (UTC): totals, per plan, per model, per student, plus daily
// totals for the chart. Uses Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN (or Vercel KV's
// KV_REST_API_URL/TOKEN) are set, so every server instance adds to the same numbers.
// Without Redis the numbers live in this server instance's memory and reset when it restarts.
//
// Costs are kept as integer micro-dollars (1 USD = 1,000,000) so Redis can add them exactly.

import { costOf, pricesFrom } from './config.js';
import { run as store, storageKind } from './store.js';

const P = 'eu:use';
const MONTH_TTL = 60 * 60 * 24 * 400;
const DAY_TTL = 60 * 60 * 24 * 120;
export const monthOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const clean = id => String(id ?? '').replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 80);

const run = (env, commands) => store(env, commands);
const redisFrom = env => storageKind(env) === 'redis';
const asObj = arr => {
  if (!arr) return {};
  if (!Array.isArray(arr)) return arr;
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};
const nums = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v) || 0]));

// Who a request belongs to: the signed-in account, else the verified membership, else the browser.
export const userKey = ({ account, member, device, ip }) => (account ? clean(account) : member ? `m:${clean(member)}` : device ? `d:${clean(device)}` : `i:${clean(ip)}`);

/**
 * Record one AI request.
 *   ok, kind ('chat' | 'task'), tier, user, model, provider, input, output, cached,
 *   estimated (token counts were estimated, not reported by the API), route ('auto' | 'manual'),
 *   escalated (Qwen chosen by routing), fallback (another model answered), failure (error kind)
 */
export async function record(env, e) {
  const prices = pricesFrom(env);
  const month = monthOf();
  const day = dayOf();
  const input = Math.max(0, Math.round(e.input || 0));
  const output = Math.max(0, Math.round(e.output || 0));
  const cached = Math.max(0, Math.round(e.cached || 0));
  const micro = e.ok ? Math.round(costOf({ model: e.model, provider: e.provider, input, output, cached }, prices) * 1e6) : 0;
  const tier = ['free', 'pro', 'max'].includes(e.tier) ? e.tier : 'free';
  const model = clean(e.model || 'unknown');
  const user = clean(e.user || 'unknown');
  const T = `${P}:${month}:total`;
  const TT = `${P}:${month}:tier:${tier}`;
  const M = `${P}:${month}:model:${model}`;
  const U = `${P}:${month}:user:${user}`;
  const D = `${P}:day:${day}`;
  const cmds = [];
  const inc = (key, field, n) => n && cmds.push(['HINCRBY', key, field, String(n)]);
  if (e.ok) {
    for (const key of [T, TT, M, U, D]) {
      inc(key, 'requests', 1);
      inc(key, 'input', input);
      inc(key, 'output', output);
      inc(key, 'cost', micro);
    }
    for (const key of [T, TT, M, U]) inc(key, 'cached', cached);
    for (const key of [T, TT]) {
      inc(key, e.kind === 'task' ? 'tasks' : 'messages', 1);
      if (e.route === 'auto') inc(key, 'auto', 1);
      if (e.escalated) inc(key, 'escalated', 1);
      if (e.fallback) inc(key, 'fallbacks', 1);
      if (e.estimated) inc(key, 'estimated', 1);
    }
    if (e.fallback) inc(M, 'fallbacks', 1);
    cmds.push(['HSET', U, 'tier', tier, 'last', String(Date.now())]);
    cmds.push(['ZINCRBY', `${P}:${month}:top`, String(micro), user]);
    cmds.push(['PFADD', `${P}:${month}:users:${tier}`, user]);
  } else {
    for (const key of [T, TT, M, D]) {
      inc(key, 'failed', 1);
      inc(key, `failed_${clean(e.failure || 'unknown')}`, 1);
    }
  }
  for (const key of [T, TT, M, U, `${P}:${month}:top`, `${P}:${month}:users:${tier}`]) cmds.push(['EXPIRE', key, String(MONTH_TTL)]);
  cmds.push(['EXPIRE', D, String(DAY_TTL)]);
  await run(env, cmds);
  return micro / 1e6;
}

// This student's estimated AI spend so far this month, in USD.
export async function spentThisMonth(env, user) {
  const [v] = await run(env, [['HGET', `${P}:${monthOf()}:user:${clean(user)}`, 'cost']]);
  return (Number(v) || 0) / 1e6;
}

const MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];

// Everything the owner's dashboard shows for one month.
export async function report(env, month = monthOf(), { top = 25, extraModels = [] } = {}) {
  const tiers = ['free', 'pro', 'max'];
  const models = [...new Set([...MODELS, ...extraModels])];
  const [y, m] = month.split('-').map(Number);
  const days = [];
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) days.push(`${month}-${String(d).padStart(2, '0')}`);
  const cmds = [
    ['HGETALL', `${P}:${month}:total`],
    ...tiers.map(t => ['HGETALL', `${P}:${month}:tier:${t}`]),
    ...tiers.map(t => ['PFCOUNT', `${P}:${month}:users:${t}`]),
    ...models.map(x => ['HGETALL', `${P}:${month}:model:${clean(x)}`]),
    ['ZREVRANGE', `${P}:${month}:top`, '0', String(top - 1), 'WITHSCORES'],
    ...days.map(d => ['HGETALL', `${P}:day:${d}`])
  ];
  const r = await run(env, cmds);
  let i = 0;
  const money = o => ({ ...o, costUSD: (o.cost || 0) / 1e6 });
  const total = money(nums(asObj(r[i++])));
  const perTier = tiers.map(t => ({ tier: t, ...money(nums(asObj(r[i++]))) }));
  perTier.forEach(t => (t.users = Number(r[i++]) || 0));
  const perModel = models.map(x => ({ model: x, ...money(nums(asObj(r[i++]))) })).filter(x => x.requests || x.failed || MODELS.includes(x.model));
  const topRaw = asObj(r[i++]);
  const daily = days.map(d => ({ day: d, ...money(nums(asObj(r[i++]))) }));
  const ids = Object.keys(topRaw);
  const userRows = ids.length ? await run(env, ids.map(id => ['HGETALL', `${P}:${month}:user:${id}`])) : [];
  const topUsers = ids.map((id, k) => {
    const o = asObj(userRows[k]);
    return { user: id, tier: o.tier ?? 'free', ...money(nums({ requests: o.requests, input: o.input, output: o.output, cost: o.cost })) };
  });
  return { month, storage: redisFrom(env) ? 'redis' : 'memory', total, perTier, perModel, topUsers, daily };
}
