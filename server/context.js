// Token budgeting for every AI request.
//
// Groq counts a request's input tokens PLUS the max_completion_tokens it reserves against
// the model's tokens-per-minute (TPM) limit — on the free tier that's 8,000 TPM. So every
// request must fit: input (≤ ~5,500 tokens) + reply reservation + safety margin ≤ TPM.
//
// fitChat() assembles what's sent, in priority order:
//   1. tutor instructions and course/spec instructions   (always)
//   2. the student's latest message (+ its images)        (always; very long pastes are clipped)
//   3. student model (RAG, grades, mistakes), deadlines   (capped)
//   4. relevant excerpts from uploaded study materials    (retrieved in the browser, re-ranked here)
//   5. the most recent turns, newest first                (up to 10 messages)
//   6. a short summary of older turns                     (so the tutor still remembers them)
// No extra AI call is made to summarise — the summary is built from the older turns
// themselves, so responses stay fast and don't spend rate limit.

export const DEFAULT_TPM = 8000;
export const INPUT_BUDGET = 5500;
const SAFETY = 350;
const IMAGE_TOKENS = 1100;
const MAX_RECENT = 10;

// ~3.6 characters per token for English prose; a little pessimistic on purpose.
export const est = text => Math.ceil(String(text ?? '').length / 3.6);
const clipTokens = (text, tokens, tail = 0) => {
  const s = String(text ?? '');
  const max = Math.floor(tokens * 3.6);
  if (s.length <= max) return s;
  const tailChars = Math.floor(tail * 3.6);
  return `${s.slice(0, max - tailChars).trimEnd()}\n…[shortened]…${tailChars ? `\n${s.slice(-tailChars).trimStart()}` : ''}`;
};

/* ── per-model rate limits ─────────────────────────────── */
// Learned from Groq's own error messages ("Limit 8000, Requested 8886"), so EUREKA adapts
// automatically when the account moves to a higher tier (or a model has a lower limit).
const learned = new Map();
// key: a model ("openai/gpt-oss-20b") or a provider slot ("openrouter|openai/gpt-oss-20b").
export function tpmFor(key, env, fallback = null) {
  return learned.get(key) ?? (String(key).startsWith('groq|') || !String(key).includes('|') ? Number(env?.('GROQ_TPM_LIMIT')) || DEFAULT_TPM : fallback ?? DEFAULT_TPM);
}
export function setLimit(model, limit) {
  if (Number.isFinite(limit) && limit > 0) learned.set(model, limit);
}
export function learnLimit(model, message) {
  const m = /tokens per minute[^]*?Limit\s*:?\s*(\d+)/i.exec(String(message ?? '')) || /TPM\)?:?\s*Limit\s*:?\s*(\d+)/i.exec(String(message ?? ''));
  if (m) learned.set(model, Number(m[1]));
  return m ? Number(m[1]) : null;
}

// Small per-minute allowances (Groq's free plan: 8,000) are shared by everyone using the
// site, so each request is kept lean there: ~2,600 input + ~1,100 reply ≈ 3,700 tokens,
// which lets a model take two replies in the same minute instead of one. With a paid plan
// (250,000 TPM, learned from Groq's headers) the full budget is used.
export const LEAN_TPM = 12_000;
const LEAN_INPUT = 2600;
export const isLean = tpm => tpm <= LEAN_TPM;

// How many input tokens may be used, and how many reply tokens to reserve.
export function budgetFor(tpm, { squeeze = 0, desiredOutput = 2048 } = {}) {
  const lean = isLean(tpm);
  const usable = Math.max(1500, tpm - SAFETY);
  const minOut = lean ? 600 : 700;
  const cap = lean ? LEAN_INPUT : INPUT_BUDGET;
  const scale = (lean ? [1, 0.75, 0.55] : [1, 0.65, 0.45])[Math.min(squeeze, 2)];
  const input = Math.floor(Math.min(cap, usable - minOut) * scale);
  const out = lean ? Math.min(desiredOutput, desiredOutput >= 2500 ? 1600 : 1100) : desiredOutput;
  return { input, usable, desiredOutput: out, minOut, lean };
}
export function outputFor(budget, inputTokens) {
  return Math.max(budget.minOut, Math.min(budget.desiredOutput, budget.usable - inputTokens));
}

/* ── tokens of a message list ──────────────────────────── */
export function tokensOf(contents) {
  let n = 0;
  for (const m of contents)
    for (const p of m.parts) n += p.text !== undefined ? est(p.text) + 4 : p.inline_data?.mime_type?.startsWith('image/') ? IMAGE_TOKENS : est(p.inline_data?.data ?? '') * 0.75;
  return n;
}

/* ── summary of older turns (no extra AI call) ─────────── */
const firstSentences = (text, chars) => {
  const plain = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/[#>*_`|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= chars) return plain;
  const cut = plain.slice(0, chars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return `${end > chars * 0.5 ? cut.slice(0, end + 1) : cut}…`;
};
const headingsOf = text =>
  [...String(text ?? '').matchAll(/^\s{0,3}(?:#{1,4}\s+(.+)|\*\*(.+?)\*\*)/gm)]
    .map(m => (m[1] ?? m[2]).trim())
    .filter(h => h.length > 2 && h.length < 70)
    .slice(0, 4);

export function summarise(older, maxTokens) {
  if (!older.length) return '';
  const lines = [];
  for (let i = 0; i < older.length; i++) {
    const m = older[i];
    const text = m.parts.map(p => p.text ?? '').join(' ');
    if (m.role === 'user') lines.push(`- Student: ${firstSentences(text, 170)}`);
    else {
      const heads = headingsOf(text);
      lines.push(`- Tutor: ${firstSentences(text, 150)}${heads.length ? ` (covered: ${heads.join('; ')})` : ''}`);
    }
  }
  // Keep the newest of the older turns if it doesn't all fit.
  let out = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = est(lines[i]) + 1;
    if (used + t > maxTokens) break;
    out.unshift(lines[i]);
    used += t;
  }
  const skipped = lines.length - out.length;
  return `Summary of the earlier part of this conversation (${older.length} older messages${skipped ? `, oldest ${skipped} omitted` : ''}) — build on what was already explained and don't repeat it unless asked:\n${out.join('\n')}`;
}

/* ── study-material excerpts ───────────────────────────── */
// materials: [{ name, fresh?, chunks: [{ label, text, score }] }] — already the most relevant
// chunks (chosen in the browser from the full documents). Trim to the budget by score.
export function materialsBlock(materials, maxTokens) {
  if (!Array.isArray(materials) || !materials.length || maxTokens < 150) return { text: '', used: 0, kept: 0, total: 0 };
  const all = [];
  for (const f of materials.slice(0, 12))
    for (const c of (Array.isArray(f?.chunks) ? f.chunks : []).slice(0, 40))
      if (typeof c?.text === 'string' && c.text.trim()) all.push({ file: String(f.name ?? 'material').slice(0, 120), label: String(c.label ?? '').slice(0, 60), text: c.text.slice(0, 4000), score: Number(c.score) || 0, order: Number(c.order) || 0 });
  if (!all.length) return { text: '', used: 0, kept: 0, total: 0 };
  const header = 'Relevant excerpts from the student’s uploaded study materials (only the parts that match this question are included). Base your answer on them where relevant and mention the page/section. If they don’t contain what’s needed, say so and ask which page or section to look at:';
  let used = est(header);
  const keep = [];
  for (const c of [...all].sort((a, b) => b.score - a.score)) {
    const t = est(c.text) + est(c.file) + 8;
    if (used + t > maxTokens) {
      const room = maxTokens - used - est(c.file) - 12;
      if (room > 120 && keep.length < 2) {
        keep.push({ ...c, text: clipTokens(c.text, room) });
        used = maxTokens;
      }
      continue;
    }
    keep.push(c);
    used += t;
  }
  // Present excerpts in document order — easier for the model to follow.
  keep.sort((a, b) => (a.file === b.file ? a.order - b.order : a.file < b.file ? -1 : 1));
  const text = `${header}\n${keep.map(c => `--- ${c.file}${c.label ? ` · ${c.label}` : ''} ---\n${c.text.trim()}`).join('\n\n')}`;
  return { text, used, kept: keep.length, total: all.length };
}

/* ── the whole request ─────────────────────────────────── */
// sections: { base: string, student|deadlines|custom: { raw, wrap(text) } } · contents: cleaned history
// (last item = the student's new message) · materials: see above.
export function fitChat({ sections, contents, materials, tpm, squeeze = 0, desiredOutput = 2048 }) {
  const budget = budgetFor(tpm, { squeeze, desiredOutput });
  const level = Math.min(2, squeeze + (budget.lean ? 1 : 0));
  const caps = [
    { student: 650, deadlines: 260, custom: 380, latest: 2600, materials: 2300, summary: 520, recent: MAX_RECENT, reply: 900 },
    { student: 380, deadlines: 140, custom: 250, latest: 1700, materials: 1200, summary: 320, recent: 6, reply: 550 },
    { student: 220, deadlines: 80, custom: 160, latest: 1100, materials: 600, summary: 200, recent: 4, reply: 350 }
  ][level];

  const base = sections.base ?? '';
  // Each optional section is clipped first, then wrapped in its instructions.
  const piece = (sec, cap) => (sec?.raw ? sec.wrap(clipTokens(sec.raw, cap)) : '');
  const extra = [piece(sections.custom, caps.custom), piece(sections.deadlines, caps.deadlines), piece(sections.student, caps.student)].filter(Boolean);

  // The new message: images only on this turn, very long pastes clipped (head + tail).
  const last = contents.at(-1);
  const images = last.parts.filter(p => p.inline_data?.mime_type?.startsWith('image/'));
  const maxImages = level ? 2 : 4;
  const latestParts = [
    ...last.parts.filter(p => p.text !== undefined).map(p => ({ text: clipTokens(p.text, caps.latest, 300) })),
    ...images.slice(0, maxImages),
    ...last.parts.filter(p => p.inline_data && !p.inline_data.mime_type?.startsWith('image/'))
  ];
  if (images.length > maxImages) latestParts.unshift({ text: `[${images.length - maxImages} more image(s) were attached but left out to stay within limits — ask the student to send them separately if needed.]` });

  // In lean mode an image would use up most of the budget; give it its own room so the
  // recent conversation still fits (the total stays well inside the per-minute limit).
  if (budget.lean) budget.input = Math.min(budget.usable - budget.minOut, budget.input + IMAGE_TOKENS * Math.min(images.length, maxImages));
  let used = est(base) + extra.reduce((a, s) => a + est(s), 0) + tokensOf([{ parts: latestParts }]) + 12;

  const fixedUsed = used;
  const history = contents.slice(0, -1);
  // Keep at least 6 recent messages (or all, if fewer): shorten long tutor replies first,
  // then give study-material excerpts less room — memory of the conversation matters most.
  const wantRecent = Math.min(squeeze ? 4 : 6, history.length);
  // (lean mode keeps 6 recent messages too — it shortens them instead)
  const plans = [
    { reply: caps.reply, share: 0.45 },
    { reply: Math.round(caps.reply / 2), share: 0.45 },
    { reply: Math.round(caps.reply / 2), share: 0.28 },
    { reply: Math.round(caps.reply / 3), share: 0.18 }
  ];
  let mat;
  let recent;
  for (const plan of plans) {
    used = fixedUsed;
    mat = materialsBlock(materials, Math.min(caps.materials, Math.floor((budget.input - used) * plan.share)));
    used += mat.used;
    recent = [];
    const reserveSummary = history.length > caps.recent ? caps.summary : 0;
    for (let i = history.length - 1; i >= 0 && recent.length < caps.recent; i--) {
      const m = history[i];
      const parts = m.parts
        .filter(p => p.text !== undefined)
        .map(p => ({ text: m.role === 'model' ? clipTokens(p.text, plan.reply, Math.min(120, plan.reply / 4)) : clipTokens(p.text, Math.min(700, plan.reply), 60) }));
      if (!parts.length) continue;
      const t = tokensOf([{ parts }]) + 4;
      if (used + t + reserveSummary > budget.input) break;
      recent.unshift({ role: m.role, parts });
      used += t;
    }
    if (recent.length >= wantRecent) break;
  }
  // The conversation must alternate and start with the student.
  while (recent.length && recent[0].role !== 'user') recent.shift();
  const olderCount = history.length - recent.length;
  const older = history.slice(0, olderCount).filter(m => m.parts.some(p => p.text));
  const summary = older.length ? summarise(older, Math.max(80, Math.min(caps.summary, budget.input - used - 20))) : '';
  used += est(summary);

  const system = [base, ...extra, summary].filter(Boolean).join('\n\n');
  const latest = { role: 'user', parts: mat.text ? [{ text: mat.text }, ...latestParts] : latestParts };
  const fitted = [...recent, latest];
  const inputTokens = est(system) + tokensOf(fitted) + 10;
  return {
    system,
    contents: fitted,
    inputTokens,
    maxOutput: outputFor(budget, inputTokens),
    report: { kept: recent.length, summarised: older.length, materials: `${mat.kept}/${mat.total}`, squeeze, lean: budget.lean, input: inputTokens, budget: budget.input }
  };
}
