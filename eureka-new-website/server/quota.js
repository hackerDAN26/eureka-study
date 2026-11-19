// AI allowances, enforced on the server so they can't be bypassed by refreshing, opening
// new tabs or editing the website's data.
//
// Who is counted:
//   • signed-in students — their Google account (the same allowance on every device)
//   • paying students    — their account, or their Whop membership
//   • guests             — the browser, plus a shared cap per network address, so clearing
//                          the browser or opening private windows doesn't reset anything useful
//
// Each request first claims one unit from the per-minute, daily and monthly counters (atomic
// INCR, so simultaneous requests can't slip past a limit), and gives it back if the AI then
// fails. Limits live in server/config.js (PLAN_LIMITS_JSON overrides them). Counts are shared
// by all server instances when Upstash Redis is configured (server/store.js).

import { limitsFrom } from './config.js';
import { run } from './store.js';
import { activeSeason } from '../src/lib/promos.js';

// Network-wide caps. Signed-in and paying students are exempt from the guest cap.
const NETWORK_DAILY = 6000;
const NETWORK_MINUTE = 600;
const GUEST_NETWORK_DAILY = 150; // all guests on one network address together, per day
const num = (v, d) => (Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) > 0 ? parseInt(v, 10) : d);

const day = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);
const minute = () => Math.floor(Date.now() / 60_000);
const clean = id => String(id ?? '').replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 80);
export const secondsToMidnight = () => {
  const n = new Date();
  return Math.ceil((Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n) / 1000);
};
export const secondsToNextMonth = () => {
  const n = new Date();
  return Math.ceil((Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1) - n) / 1000);
};
const toNextMinute = () => 60 - (Math.floor(Date.now() / 1000) % 60);

// The limits that apply to one student right now. Seasonal message boosts (src/lib/promos.js)
// are applied here, on the server, so they can't be faked.
export function limitsFor(env, planKey) {
  const all = limitsFrom(env);
  const L = { ...(all[planKey] ?? all.free) };
  const season = activeSeason();
  if (season?.bonus?.type === 'messages' && L.daily) L.daily = Math.round(L.daily * (1 + season.bonus.boost));
  return L;
}

// Who to count: { key, planKey }.
export function identity({ plan = 'free', account, member, device, ip }) {
  const guest = !account && !member;
  const key = account ? clean(account) : member ? `m:${clean(member)}` : device ? `d:${clean(device)}` : `i:${clean(ip)}`;
  return { key, guest, planKey: guest && plan === 'free' ? 'guest' : plan };
}

const keysFor = (who, ip) => ({
  day: `eq:${day()}:${who}`,
  month: `eqmo:${month()}:${who}`,
  min: `eqm:${minute()}:${who}`,
  web: `eqw:${day()}:${who}`,
  netDay: `eq:${day()}:n:${clean(ip) || 'unknown'}`,
  netMin: `eqm:${minute()}:n:${clean(ip) || 'unknown'}`,
  guestNet: `eqg:${day()}:n:${clean(ip) || 'unknown'}`
});

const allowanceFrom = (L, used) => ({
  day: { used: Math.min(used.day, L.daily || used.day), limit: L.daily || 0 },
  month: { used: L.monthly ? Math.min(used.month, L.monthly) : used.month, limit: L.monthly || 0 },
  web: { used: L.webDaily ? Math.min(used.web, L.webDaily) : used.web, limit: L.webDaily || 0 },
  resetsIn: { day: secondsToMidnight(), month: secondsToNextMonth() }
});

/**
 * Claim one AI request. Returns
 *   { ok: true, allowance, refund(), webAllowed }  — call refund() if the AI request fails
 *   { ok: false, kind, retryAfter, allowance }     — kind: rate_limited | daily_limit | monthly_limit
 * web: the request wants a web/specification search (counted against webDaily).
 */
export async function consume(env, { plan = 'free', account, member, device, ip, web = false }) {
  const { key: who, guest, planKey } = identity({ plan, account, member, device, ip });
  const L = limitsFor(env, planKey);
  const k = keysFor(who, ip);
  const dev = env('EUREKA_DEV_PLANS') === '1'; // npm run dev: count, but never block
  const claim = [
    ['INCR', k.min],
    ['EXPIRE', k.min, '120'],
    ['INCR', k.day],
    ['EXPIRE', k.day, '172800'],
    ['INCR', k.month],
    ['EXPIRE', k.month, '3456000'],
    ['INCR', k.netDay],
    ['EXPIRE', k.netDay, '172800'],
    ['INCR', k.netMin],
    ['EXPIRE', k.netMin, '120']
  ];
  if (guest) claim.push(['INCR', k.guestNet], ['EXPIRE', k.guestNet, '172800']);
  const r = await run(env, claim);
  const used = { min: Number(r[0]) || 0, day: Number(r[2]) || 0, month: Number(r[4]) || 0, web: 0 };
  const netDay = Number(r[6]) || 0;
  const netMin = Number(r[8]) || 0;
  const guestNet = guest ? Number(r[10]) || 0 : 0;
  const claimed = [k.min, k.day, k.month, k.netDay, k.netMin, ...(guest ? [k.guestNet] : [])];
  const giveBack = async (keys = claimed) => {
    await run(env, keys.map(x => ['DECR', x]));
  };

  let block = null;
  if (used.min > L.perMinute) block = { kind: 'rate_limited', retryAfter: toNextMinute() };
  else if (L.daily && used.day > L.daily) block = { kind: 'daily_limit', retryAfter: secondsToMidnight() };
  else if (L.monthly && used.month > L.monthly) block = { kind: 'monthly_limit', retryAfter: secondsToNextMonth() };
  else if (!member && !account && (netDay > num(env('NETWORK_DAILY_LIMIT'), NETWORK_DAILY) || netMin > num(env('NETWORK_MINUTE_LIMIT'), NETWORK_MINUTE)))
    block = { kind: 'rate_limited', retryAfter: toNextMinute() };
  else if (guest && planKey === 'guest' && guestNet > num(env('GUEST_NETWORK_DAILY_LIMIT'), GUEST_NETWORK_DAILY)) block = { kind: 'daily_limit', retryAfter: secondsToMidnight() };

  if (block && !dev) {
    // A refused request doesn't count — the counters stay at the limit.
    await giveBack();
    used.day = Math.min(used.day - 1, L.daily || Infinity);
    used.month = Math.max(0, used.month - 1);
    const w = await run(env, [['GET', k.web]]);
    used.web = Number(w[0]) || 0;
    return { ok: false, ...block, guest, allowance: allowanceFrom(L, used) };
  }

  // Web/specification searches have their own daily allowance on Free.
  let webAllowed = true;
  let webClaimed = false;
  if (web) {
    const [w] = await run(env, [
      ['INCR', k.web],
      ['EXPIRE', k.web, '172800']
    ]);
    used.web = Number(w) || 0;
    webClaimed = true;
    if (L.webDaily && used.web > L.webDaily && !dev) {
      webAllowed = false;
      await run(env, [['DECR', k.web]]);
      used.web -= 1;
      webClaimed = false;
    }
  } else {
    const [w] = await run(env, [['GET', k.web]]);
    used.web = Number(w) || 0;
  }

  let refunded = false;
  return {
    ok: true,
    guest,
    webAllowed,
    allowance: allowanceFrom(L, used),
    refund: async () => {
      if (refunded) return;
      refunded = true;
      await giveBack(webClaimed ? [...claimed, k.web] : claimed);
    }
  };
}

// Read-only: what a student has used today and this month (for the account menu).
export async function allowanceOf(env, { plan = 'free', account, member, device, ip }) {
  const { key: who, guest, planKey } = identity({ plan, account, member, device, ip });
  const L = limitsFor(env, planKey);
  const k = keysFor(who, ip);
  const r = await run(env, [
    ['GET', k.day],
    ['GET', k.month],
    ['GET', k.web]
  ]);
  return { guest, plan: planKey, ...allowanceFrom(L, { day: Number(r[0]) || 0, month: Number(r[1]) || 0, web: Number(r[2]) || 0 }) };
}
