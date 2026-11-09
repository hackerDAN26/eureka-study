// What the browser sends with each chat message.
//
// Before: every message re-sent the whole conversation, and every earlier attachment
// (full PDF/notes text, images) was re-sent on every turn — so requests kept growing.
// Now:
//   • conversation: text only; recent turns in full, older turns shortened (the server keeps
//     the last ~10 and turns older ones into a short summary — see server/ai.js + context.js)
//   • images: sent only with the message they were attached to
//   • documents (PDF, Word, PowerPoint, text): split into page/slide-sized pieces once, and
//     only the pieces relevant to the current question are sent as "materials"

const RECENT_FULL = 16; // messages sent in full (server trims further to its budget)
const OLDER_MAX = 40; // older messages sent as short text for the summary
const OLDER_CHARS = 480;
const CHUNK_CHARS = 1100;
const MATERIAL_CHARS = 10_000; // ≈ 2,800 tokens of excerpts per request, before server trimming
const MAX_CHUNKS = 14;

const STOP = new Set(
  'the a an and or but if then so of to in on at by for with from into about as is are was were be been being it its this that these those there their them they you your i me my we our he she his her what which who whom whose why how when where can could should would will shall may might must do does did done have has had not no yes please explain tell show give make help me like just also more most some any each other than very really get got using use used answer question questions page pages slide slides attached attachment file document notes pdf'.split(
    ' '
  )
);
const words = text =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .match(/[a-z0-9][a-z0-9'-]{1,}/g)
    ?.filter(w => w.length > 2 && !STOP.has(w))
    .map(w => w.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1')) ?? [];

/* ── chunking (cached on the resource) ─────────────────── */
export function chunksOf(rec, name) {
  if (rec.chunks) return rec.chunks;
  const raw = String(rec.part?.text ?? '').replace(/^\[Attached resource:[^\]]*\]\n?/, '');
  const sections = [];
  const marker = /^-{2,}\s*(Page|Slide)\s+(\d+)\s*-{2,}\s*$/gim;
  let last = 0;
  let label = '';
  let m;
  while ((m = marker.exec(raw))) {
    if (m.index > last) sections.push({ label, text: raw.slice(last, m.index) });
    label = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
    last = m.index + m[0].length;
  }
  sections.push({ label, text: raw.slice(last) });
  const chunks = [];
  for (const sec of sections) {
    const text = sec.text.trim();
    if (!text) continue;
    if (text.length <= CHUNK_CHARS * 1.3) {
      chunks.push({ label: sec.label, text });
      continue;
    }
    // Long sections: split on paragraph, then sentence boundaries.
    const paras = text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])/);
    let buf = '';
    let part = 1;
    for (const p of paras) {
      if (buf && buf.length + p.length > CHUNK_CHARS) {
        chunks.push({ label: sec.label ? `${sec.label} (part ${part++})` : `Part ${chunks.length + 1}`, text: buf.trim() });
        buf = '';
      }
      buf += (buf ? '\n' : '') + p;
    }
    if (buf.trim()) chunks.push({ label: sec.label ? (part > 1 ? `${sec.label} (part ${part})` : sec.label) : `Part ${chunks.length + 1}`, text: buf.trim() });
  }
  rec.chunks = chunks.map((c, i) => ({ ...c, order: i, terms: words(c.text) }));
  rec.chunkName = name;
  return rec.chunks;
}

/* ── retrieval ─────────────────────────────────────────── */
const GENERIC = /\b(summar|overview|outline|whole|entire|everything|all of|this (doc|document|file|pdf|resource|presentation|sheet)|the (doc|document|file|pdf|attachment|presentation)|key points|main points|what('s| is) (it|this) about|go through|flashcards? (from|for|on) (this|it|these)|quiz me on (this|it))\b/i;

// Picks the most relevant pieces across all documents in the chat.
export function retrieveMaterials(docs, query, { fresh = new Set(), context = '' } = {}) {
  if (!docs.length) return [];
  const all = docs.flatMap(d => chunksOf(d.rec, d.name).map(c => ({ ...c, file: d.name, fresh: fresh.has(d.name) })));
  if (!all.length) return [];
  const N = all.length;
  const df = new Map();
  for (const c of all) for (const t of new Set(c.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = all.reduce((a, c) => a + c.terms.length, 0) / N || 1;
  const q = new Map();
  for (const t of words(query)) q.set(t, (q.get(t) ?? 0) + 1);
  for (const t of words(context)) q.set(t, (q.get(t) ?? 0) + 0.35);
  // "page 4", "p. 4", "slide 12" in the question → that page/slide.
  const refs = [...String(query).matchAll(/\b(?:page|p\.?|pg\.?|slide)\s*(\d{1,4})\b/gi)].map(m => m[1]);

  const own = new Set(words(query));
  let ownHit = refs.length > 0;
  for (const c of all) {
    const tf = new Map();
    for (const t of c.terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    if (!ownHit) for (const t of own) if (tf.has(t)) ownHit = true;
    for (const [t, w] of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += w * idf * ((f * 2.2) / (f + 1.2 * (0.25 + (0.75 * c.terms.length) / avg)));
    }
    if (refs.length && refs.some(r => new RegExp(`\\b(Page|Slide) ${r}\\b`).test(c.label))) s += 50;
    if (c.fresh) s *= 1.25;
    c.score = s;
  }

  // Words from the previous question only help rank; the new message itself must match.
  const hits = ownHit ? all.filter(c => c.score > 0.5) : [];
  // Broad requests, or a file attached just now, get a spread of the document. A message
  // unrelated to the materials ("thanks!", "next question") gets no excerpts at all.
  const generic = GENERIC.test(query) || (hits.length === 0 && fresh.size > 0);
  if (!generic && hits.length === 0) return [];
  let picked;
  if (generic) {
    // Broad request ("summarise this"): spread across each document, freshest first.
    const byFile = new Map();
    for (const c of all) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
    const files = [...byFile.keys()].sort((a, b) => Number(fresh.has(b)) - Number(fresh.has(a)));
    const per = Math.max(2, Math.floor(MAX_CHUNKS / files.length));
    picked = [];
    for (const f of files) {
      const list = byFile.get(f);
      const step = Math.max(1, list.length / per);
      for (let i = 0; i < list.length && picked.filter(p => p.file === f).length < per; i += step) {
        const c = list[Math.floor(i)];
        picked.push({ ...c, score: (fresh.has(f) ? 2 : 1) + (c.score || 0) + 1 / (1 + Math.floor(i)) });
      }
    }
  } else picked = hits.sort((a, b) => b.score - a.score).slice(0, MAX_CHUNKS);

  // Keep within the character budget, best first.
  let used = 0;
  const kept = [];
  for (const c of [...picked].sort((a, b) => b.score - a.score)) {
    if (used + c.text.length > MATERIAL_CHARS && kept.length) continue;
    kept.push(c);
    used += Math.min(c.text.length, MATERIAL_CHARS);
  }
  const out = new Map();
  for (const c of kept) {
    const f = out.get(c.file) ?? { name: c.file, fresh: fresh.has(c.file), totalChunks: 0, chunks: [] };
    f.chunks.push({ label: c.label, text: c.text.slice(0, 4000), score: Math.round(c.score * 100) / 100, order: c.order });
    out.set(c.file, f);
  }
  for (const f of out.values()) f.totalChunks = all.filter(c => c.file === f.name).length;
  return [...out.values()];
}

/* ── the request ───────────────────────────────────────── */
// messages: the chat's messages + the outgoing one · loaded: Map(name → resource)
export function buildRequest(messages, outgoing, loaded) {
  const usable = messages.filter(m => !m.pending && !m.error && !m.limit && (m.text || m.files?.length));
  const docs = [];
  const seen = new Set();
  for (const m of usable)
    for (const name of m.files ?? []) {
      const rec = loaded.get(name);
      if (rec && rec.part?.text !== undefined && !seen.has(name)) {
        seen.add(name);
        docs.push({ name, rec });
      }
    }

  const history = usable.map((m, i) => {
    const recent = i >= usable.length - RECENT_FULL;
    if (m.role === 'model') return { role: 'model', parts: [{ text: recent ? m.text : String(m.text).slice(0, OLDER_CHARS) }] };
    const isOutgoing = m === outgoing;
    const parts = [];
    for (const name of m.files ?? []) {
      const rec = loaded.get(name);
      if (!rec) parts.push({ text: `[Earlier attachment "${name}" isn’t loaded in this session — ask the student to re-attach it if it’s needed.]` });
      else if (rec.part?.inline_data) {
        // Images: only with the message they were attached to.
        if (isOutgoing) {
          if (rec.note) parts.push(rec.note);
          parts.push(rec.part);
        } else parts.push({ text: `[Image shared earlier: ${name} — see your earlier reply about it.]` });
      } else parts.push({ text: `[Attached: ${name} — relevant excerpts are provided with the latest question.]` });
    }
    const text = m.apiText || m.text || 'Please look at the attached resource(s).';
    parts.push({ text: recent || isOutgoing ? text : text.slice(0, OLDER_CHARS) });
    return { role: 'user', parts };
  });
  // Older history beyond what the summary can use isn't needed at all.
  const trimmed = history.length > RECENT_FULL + OLDER_MAX ? history.slice(-(RECENT_FULL + OLDER_MAX)) : history;
  while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();

  const prevUser = [...usable].reverse().find(m => m.role === 'user' && m !== outgoing);
  const materials = retrieveMaterials(docs, outgoing.apiText || outgoing.text || '', {
    fresh: new Set(outgoing.files ?? []),
    context: prevUser ? prevUser.apiText || prevUser.text : ''
  });
  return { history: trimmed, materials };
}
