// Automatic plan detection: which plan a signed-in student has paid for, read from Whop.
//
//   1. The student signs in with Google (existing sign-in). The server checks the Google
//      credential and issues a signed EUREKA session (no password, nothing secret in it).
//   2. On every AI request the server looks up that verified email in Whop:
//        GET /members?query=<email>       → the Whop user with exactly that email
//        GET /memberships?user_id=<user>  → their memberships to this account's products
//      Active Pro/Max plans (matched by plan id, see WHOP_PLAN_* / DEFAULT_WHOP_PLANS) decide
//      the tier. The answer is cached for a few minutes (ENTITLEMENT_TTL_SECONDS, default 300).
//   3. Optional Whop webhook (/api/ai/whop-webhook, WHOP_WEBHOOK_SECRET) clears that cache the
//      moment a membership is bought, upgraded, cancelled or expires, so changes apply instantly.
//
// Customers never type a key. Upgrades, downgrades, cancellations and expiry all show up on
// their next request (instantly with the webhook, within the cache time without it).
// If Whop can't be reached, the last known answer (up to a day old) is used, so a Whop outage
// doesn't lock paying students out.

import { del, getJSON, run, setJSON, sha256hex } from './store.js';

export const PLAN_RANK = { free: 0, pro: 1, max: 2 };
export const DEFAULT_WHOP_PLANS = {
  plan_VbdKDteONjAvL: ['pro', 'monthly'],
  plan_P5x4nksgIGQsS: ['pro', 'yearly'],
  plan_T4rb2neFS9qdz: ['max', 'monthly'],
  plan_x1TBsQJ6buHF3: ['max', 'yearly']
};
// Membership states that still grant access.
export const ACTIVE = new Set(['active', 'trialing', 'past_due', 'completed', 'canceling']);

export function whopPlans(env) {
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
const whopBase = env => (env('WHOP_API_BASE') || 'https://api.whop.com/api/v1').replace(/\/$/, '');
const ttl = env => Math.min(3600, Math.max(30, parseInt(env('ENTITLEMENT_TTL_SECONDS'), 10) || 300));
const STALE_OK = 86_400; // seconds a cached answer may be used while Whop is unreachable

/* ── signed tokens (sessions) ───────────────────────────── */
const enc = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
async function hmac(keyText, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
const secretOf = env => env('PLAN_SECRET') || env('WHOP_API_KEY');
export function sameText(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const SESSION_DAYS = 30;
export async function signSession(env, { sub, email, name }) {
  const secret = secretOf(env);
  if (!secret) return null;
  const body = b64u(enc.encode(JSON.stringify({ sub: String(sub), email: String(email).toLowerCase(), name: String(name ?? '').slice(0, 80), iat: Date.now(), exp: Date.now() + SESSION_DAYS * 864e5 })));
  return `${body}.${await hmac(`eureka-session:${secret}`, body)}`;
}
export async function verifySession(env, token) {
  const secret = secretOf(env);
  if (!secret || typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !sameText(await hmac(`eureka-session:${secret}`, body), sig)) return null;
  try {
    const p = JSON.parse(unb64u(body));
    return p.exp > Date.now() && p.sub && /@/.test(p.email) ? p : null;
  } catch {
    return null;
  }
}

/* ── Whop lookups ─────────────────────────────────────── */
async function whop(env, path) {
  const res = await fetch(`${whopBase(env)}${path}`, {
    headers: { authorization: `Bearer ${env('WHOP_API_KEY')}`, accept: 'application/json' },
    signal: AbortSignal.timeout?.(6000)
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw Object.assign(new Error(`Whop returned ${res.status}`), { status: res.status });
  return res.json();
}
const list = body => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []);

// The best active plan among a user's memberships.
function bestOf(env, memberships) {
  const plans = whopPlans(env);
  const product = env('WHOP_PRODUCT_ID');
  let best = { tier: 'free', billing: null, membership: null, until: null };
  for (const m of memberships) {
    const planId = m.variant_id ?? m.plan?.id ?? m.plan_id ?? (typeof m.plan === 'string' ? m.plan : null);
    const mapped = plans[planId];
    if (!mapped) continue;
    if (product && (m.product_id ?? m.product?.id ?? m.access_pass?.id) && (m.product_id ?? m.product?.id ?? m.access_pass?.id) !== product) continue;
    if (!ACTIVE.has(String(m.status ?? '').toLowerCase()) || m.valid === false) continue;
    const end = m.expires_at ?? m.current_period_end ?? m.renewal_period_end;
    const until = end ? (typeof end === 'number' ? (end < 1e12 ? end * 1000 : end) : Date.parse(end)) : null;
    if (until && until < Date.now() - 864e5) continue; // ended more than a day ago
    if (PLAN_RANK[mapped[0]] > PLAN_RANK[best.tier]) best = { tier: mapped[0], billing: mapped[1], membership: m.id ?? null, until };
  }
  return best;
}

const ownerEmails = env =>
  String(env('OWNER_EMAILS') ?? '')
    .split(/[,\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * The plan a verified email has paid for.
 * Returns { tier, billing, membership, until, source: 'whop'|'owner'|'none', checkedAt, stale? }.
 */
export async function entitlementFor(env, email, { fresh = false } = {}) {
  email = String(email ?? '').toLowerCase();
  if (!email) return { tier: 'free', source: 'none' };
  if (ownerEmails(env).includes(email)) return { tier: 'max', billing: 'yearly', source: 'owner', owner: true };
  if (!env('WHOP_API_KEY')) return { tier: 'free', source: 'none', reason: 'billing_not_setup' };
  const key = `eu:ent:${await sha256hex(email)}`;
  const cached = await getJSON(env, key);
  if (cached && !fresh && Date.now() - cached.checkedAt < ttl(env) * 1000) return cached;
  try {
    const members = list(await whop(env, `/members?query=${encodeURIComponent(email)}&first=20`));
    const users = [...new Set(members.filter(m => String(m.email ?? m.user?.email ?? '').toLowerCase() === email).map(m => m.user?.id ?? m.user_id).filter(Boolean))];
    let memberships = [];
    for (const uid of users.slice(0, 3)) {
      memberships = memberships.concat(list(await whop(env, `/memberships?user_id=${encodeURIComponent(uid)}&first=50`)));
      await setJSON(env, `eu:entu:${uid}`, { key }, 30 * 86400); // lets the webhook find this cache entry
    }
    const out = { ...bestOf(env, memberships), source: 'whop', checkedAt: Date.now() };
    await setJSON(env, key, out, STALE_OK);
    return out;
  } catch (e) {
    console.error('[plans] Whop lookup failed:', e.message);
    if (cached) return { ...cached, stale: true };
    return { tier: 'free', source: 'none', reason: 'billing_error' };
  }
}

/**
 * Re-checks a membership from an older license-key activation, so cancelled or expired
 * memberships lose access automatically. Returns { tier, billing, until, active } or null
 * when Whop isn't configured (the pass's own expiry then applies).
 */
export async function membershipStatus(env, membershipId, { fresh = false } = {}) {
  if (!env('WHOP_API_KEY') || !membershipId) return null;
  const key = `eu:mem:${String(membershipId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`;
  const cached = await getJSON(env, key);
  if (cached && !fresh && Date.now() - cached.checkedAt < ttl(env) * 1000) return cached;
  try {
    const m = await whop(env, `/memberships/${encodeURIComponent(membershipId)}`);
    const best = m.notFound ? { tier: 'free' } : bestOf(env, [m]);
    const out = { ...best, active: best.tier !== 'free', checkedAt: Date.now() };
    await setJSON(env, key, out, STALE_OK);
    return out;
  } catch (e) {
    console.error('[plans] Whop membership check failed:', e.message);
    return cached ? { ...cached, stale: true } : null;
  }
}

/* ── Whop webhook: clear cached plans the moment a membership changes ── */
async function verifyStandardWebhook(secret, headers, body) {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigs = String(headers.get('webhook-signature') ?? '')
    .split(' ')
    .map(s => s.split(',')[1])
    .filter(Boolean);
  if (!id || !ts || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const keys = [enc.encode(secret)];
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  try {
    keys.push(Uint8Array.from(atob(raw), c => c.charCodeAt(0)));
  } catch {}
  keys.push(enc.encode(raw));
  for (const k of keys) {
    const key = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${ts}.${body}`)))));
    if (sigs.some(s => sameText(s, want))) return true;
  }
  return false;
}

export async function handleWhopWebhook(request, env, json) {
  const secret = env('WHOP_WEBHOOK_SECRET');
  if (!secret) return json(503, { error: { kind: 'webhook_not_setup', message: 'Set WHOP_WEBHOOK_SECRET to receive Whop webhooks.' } });
  const body = (await request.text()).slice(0, 262_144);
  if (!(await verifyStandardWebhook(secret, request.headers, body))) return json(401, { error: { kind: 'bad_signature', message: 'Webhook signature check failed.' } });
  let event = {};
  try {
    event = JSON.parse(body);
  } catch {
    return json(400, { error: { kind: 'bad_request', message: 'Webhook body was not JSON.' } });
  }
  const d = event.data ?? {};
  const emails = [d.user?.email, d.member?.email, d.email, d.user_email].filter(e => typeof e === 'string' && /@/.test(e));
  const users = [d.user?.id, d.user_id, d.member?.user?.id].filter(Boolean);
  const keys = [];
  for (const e of emails) keys.push(`eu:ent:${await sha256hex(e.toLowerCase())}`);
  for (const u of users) {
    const link = await getJSON(env, `eu:entu:${u}`);
    if (link?.key) keys.push(link.key);
  }
  if (d.id && String(d.id).startsWith('mem_')) keys.push(`eu:mem:${d.id}`);
  if (keys.length) await del(env, ...keys);
  await run(env, [['INCR', 'eu:webhooks:received']]);
  return json(200, { ok: true, cleared: keys.length });
}
