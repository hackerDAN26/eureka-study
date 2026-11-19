#!/usr/bin/env node
// Real Groq integration test.
//
//   npm run test:ai                          → calls Groq with GROQ_API_KEY from .env, through EUREKA's server code
//   npm run test:ai -- https://your.site     → also tests the deployed /api/ai backend
//
// Never prints the key.
import { readFileSync, existsSync } from 'node:fs';
import { handleAI, DEFAULT_MODEL, findKey } from '../server/ai.js';

const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const found = findKey(k => String(env[k] ?? '').trim());
const key = found.key;
const site = process.argv[2]?.replace(/\/$/, '');
let failed = 0;
const ok = msg => console.log(`  ✓ ${msg}`);
const bad = msg => {
  failed += 1;
  console.log(`  ✗ ${msg}`);
};
// Local checks run as the site owner (like npm run dev).
const local = (path, init = {}) => handleAI(new Request(`http://localhost${path}`, { headers: { origin: 'http://localhost' }, ...init }), k => (k === 'EUREKA_DEV_PLANS' ? '1' : env[k]));
const post = body => local('/api/ai/chat', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const readStream = async res => {
  let text = '';
  let sources = 0;
  for (const line of (await res.text()).split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const c = JSON.parse(line.slice(5));
      if (c.error) throw new Error(c.error.message);
      for (const p of c.candidates?.[0]?.content?.parts ?? []) if (p.text) text += p.text;
      sources += c.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0;
    } catch (e) {
      if (e.message) text += `[error: ${e.message}]`;
    }
  }
  return { text: text.trim(), sources };
};

console.log('\n1. Environment');
if (!key) bad(`No Groq key found. ${found.seen.length ? `Seen: ${found.seen.join(', ')} — none holds a gsk_ key. ` : ''}Add GROQ_API_KEY=gsk_… to .env`);
else {
  ok(`Groq key found in ${found.from} (${key.length} characters)${found.from !== 'GROQ_API_KEY' ? ' — rename it to GROQ_API_KEY when you can' : ''}`);
  if (!key.startsWith('gsk_')) console.log('  ! This key doesn’t start with “gsk_”, the format Groq uses. If step 2 says “invalid key”, create a new key at console.groq.com/keys.');
}
for (const v of ['VITE_GROQ_API_KEY', 'VITE_XAI_API_KEY', 'VITE_GEMINI_API_KEY']) if (env[v]) bad(`${v} is set — remove it; VITE_ variables can be bundled into the website`);

if (key) {
  console.log(`\n2. Real request to Groq (${DEFAULT_MODEL})`);
  const h = await (await local('/api/ai/health?test=1')).json();
  if (h.test?.ok) ok(`${h.test.model} replied "${h.test.reply}" in ${h.test.ms} ms`);
  else bad(`${h.test?.kind ?? h.error?.kind}: ${h.test?.message ?? h.error?.message}${h.test?.detail ? ` — Groq said: ${h.test.detail}` : ''}`);

  console.log('\n3. Every model in EUREKA’s lineup, on this key');
  const all = await (await local('/api/ai/health?test=all')).json();
  for (const r of all.results ?? []) {
    if (r.ok) ok(`${r.name} (${r.model}) works`);
    else console.log(`  – ${r.name} not usable on this key: ${r.kind}${r.detail ? ` — ${r.detail.slice(0, 140)}` : ''}`);
  }
  if (all.error) bad(`${all.error.kind}: ${all.error.message}`);
  else if (!all.results?.some(r => r.ok)) bad('no model works on this key');

  console.log('\n4. Streaming chat (the same request the website makes)');
  const t0 = Date.now();
  const res = await post({ model: 'qwen/qwen3.8-27b', effort: 'Low', subject: 'Biology', history: [{ role: 'user', parts: [{ text: 'In one sentence, what is osmosis?' }] }] });
  if (!res.ok) {
    const e = (await res.json()).error;
    bad(`${res.status} ${e.kind}: ${e.message}${e.detail ? ` — Groq said: ${e.detail}` : ''}`);
  } else {
    const { text } = await readStream(res);
    if (text && !text.includes('[error')) ok(`streamed reply from ${res.headers.get('x-eureka-model')} in ${Date.now() - t0} ms: "${text.slice(0, 120)}"`);
    else bad(`stream problem: ${text || 'no text'}`);
  }

  console.log('\n5. Spec-aware answer with a web lookup on the board’s site (AQA GCSE Biology)');
  const spec = await post({
    model: 'qwen/qwen3.8-27b',
    effort: 'Low',
    course: { id: 'aqa.gcse.biology' },
    courses: [{ id: 'aqa.gcse.biology' }],
    specLookup: true,
    history: [{ role: 'user', parts: [{ text: 'Which required practicals are on my specification? Just list their names.' }] }]
  });
  if (!spec.ok) bad(`${spec.status}: ${(await spec.json()).error?.message}`);
  else {
    const note = spec.headers.get('x-eureka-note');
    const { text, sources } = await readStream(spec);
    if (text) ok(`answered${sources ? ` with ${sources} source link(s)` : ''}${note === 'search_unavailable' ? ' (web search unavailable on this key — answered without it)' : ''}: "${text.replace(/\s+/g, ' ').slice(0, 140)}…"`);
    else bad('no text in spec answer');
  }

  console.log('\n5b. Revision tasks: spec topics, an exam question, and examiner marking');
  const task = body => local('/api/ai/task', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(body) });
  const t1 = await task({ task: 'topics', course: { id: 'aqa.gcse.biology' } });
  const d1 = await t1.json();
  if (t1.ok && d1.data?.topics?.length) ok(`${d1.data.topics.length} topics from the specification: ${d1.data.topics.slice(0, 4).map(t => t.name).join(', ')}…`);
  else bad(`topics: ${d1.error?.message ?? t1.status} ${d1.error?.detail ?? ''}`);
  const t2 = await task({ task: 'question', course: { id: 'aqa.gcse.biology' }, input: { topic: d1.data?.topics?.[0]?.name ?? 'Cell biology', targetGrade: '7' } });
  const d2 = await t2.json();
  if (t2.ok && d2.data?.question) {
    ok(`question (${d2.data.marks} marks): "${d2.data.question.slice(0, 110)}…"`);
    const t3 = await task({ task: 'mark', course: { id: 'aqa.gcse.biology' }, input: { question: d2.data.question, markScheme: d2.data.markScheme, marks: d2.data.marks, answer: 'I am not sure.' } });
    const d3 = await t3.json();
    if (t3.ok && Number.isFinite(Number(d3.data?.score))) ok(`marked ${d3.data.score}/${d3.data.outOf}: "${String(d3.data.feedback).slice(0, 110)}…"`);
    else bad(`mark: ${d3.error?.message ?? t3.status}`);
  } else bad(`question: ${d2.error?.message ?? t2.status}`);

  console.log('\n6. Invalid key is reported clearly');
  const wrong = await handleAI(new Request('http://localhost/api/ai/health?test=1'), k => (k === 'GROQ_API_KEY' ? 'gsk_not_a_real_key' : k === 'EUREKA_DEV_PLANS' ? '1' : env[k]));
  const wd = await wrong.json();
  if (wd.test?.kind === 'invalid_key') ok(`invalid_key: "${wd.test.message}"`);
  else bad(`expected invalid_key, got ${wd.test?.kind}: ${wd.test?.message}`);
}

if (site) {
  console.log(`\n7. Deployed backend at ${site}`);
  try {
    // Live sites only run connection tests for the owner: set ADMIN_TOKEN in .env to match the host.
    const r = await fetch(`${site}/api/ai/health${env.ADMIN_TOKEN ? `?test=1&admin=${encodeURIComponent(env.ADMIN_TOKEN)}` : ''}`);
    if (!/json/.test(r.headers.get('content-type') || '')) bad(`${site}/api/ai isn’t EUREKA’s server (HTTP ${r.status}). Deploy via GitHub or the Netlify CLI, not drag-and-drop.`);
    else {
      const d = await r.json();
      if (d.test?.ok) ok(`${site} → ${d.test.model} replied "${d.test.reply}" in ${d.test.ms} ms`);
      else bad(`${r.status}: ${d.test?.message ?? d.error?.message}${d.test?.detail ? ` — Groq said: ${d.test.detail}` : ''}`);
      for (const w of d.warnings ?? []) console.log(`  ! ${w}`);
    }
    const page = await (await fetch(site)).text();
    const scripts = [...page.matchAll(/src="([^"]+\.js)"/g)].map(m => new URL(m[1], site).href);
    let leaked = false;
    for (const s of scripts) if (key && (await (await fetch(s)).text()).includes(key)) leaked = true;
    if (leaked) bad('the API key appears in the website’s JavaScript!');
    else ok(`key not found in the site’s ${scripts.length} script file(s)`);
  } catch (e) {
    bad(`couldn’t reach ${site}: ${e.message}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed.\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
