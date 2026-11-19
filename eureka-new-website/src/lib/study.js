// EUREKA study engine — the student model, spaced repetition, time allocation, the
// revision timetable, rescheduling, analytics and coaching rules.
//
// Everything here is deterministic and explainable: the same inputs always give the same
// plan, and every session carries the reason it was scheduled. The AI (server/ai.js)
// supplies what needs judgement — topic lists from the specification, exam questions,
// marking, flashcards — and every result flows back in here through recordAssessment()
// and reviewCard(), which is what makes the plan adapt.

const DAY = 86400e3;
export const ymd = d => new Date(d).toLocaleDateString('en-CA');
export const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00`) - new Date(`${a}T12:00`)) / DAY);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ── grades ──────────────────────────────────────────── */
export const GRADE_SCALES = {
  gcse: ['9', '8', '7', '6', '5', '4', '3', '2', '1'],
  igcse: ['9', '8', '7', '6', '5', '4', '3', '2', '1', 'A*', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
  alevel: ['A*', 'A', 'B', 'C', 'D', 'E'],
  intl_alevel: ['A*', 'A', 'B', 'C', 'D', 'E'],
  ib_dp: ['7', '6', '5', '4', '3', '2', '1'],
  ap: ['5', '4', '3', '2', '1'],
  sqa_n5: ['A', 'B', 'C', 'D'],
  sqa_higher: ['A', 'B', 'C', 'D']
};
export const gradeScale = qualId => GRADE_SCALES[qualId] ?? ['A*', 'A', 'B', 'C', 'D', 'E', 'U'];

// How many grade steps the student wants to climb (0 = already at target).
export function gradeGap(course) {
  const scale = gradeScale(course?.qualId);
  const letters = scale.filter(g => /[A-Z]/.test(g));
  const numbers = scale.filter(g => /^\d$/.test(g));
  const pick = g => (letters.includes(g) ? letters : numbers);
  const { currentGrade: c, targetGrade: t } = course ?? {};
  if (!c || !t) return 1;
  const list = pick(t);
  if (!list.includes(c)) return 1;
  return Math.max(0, list.indexOf(c) - list.indexOf(t));
}

/* ── topics & the student model ──────────────────────── */
export const RAG = ['red', 'amber', 'green'];
const RAG_PRIOR = { red: 0.2, amber: 0.5, green: 0.82 };

export const newTopic = (name, extra = {}) => ({
  id: uid(),
  name: String(name).slice(0, 120),
  subtopics: [],
  weight: 3,
  difficulty: 3,
  rag: null,
  confidence: null,
  mastery: null,
  srs: { ease: 2.5, interval: 0, reps: 0, due: null, lapses: 0, last: null },
  stats: { minutes: 0, questions: 0, marks: 0, outOf: 0, reviews: 0, recalled: 0, sessions: 0 },
  mistakes: {},
  cards: [],
  ...extra
});

// Retention falls off after the scheduled review date passes.
export function retention(t, today = ymd(Date.now())) {
  if (!t.srs?.last) return 1;
  const since = daysBetween(t.srs.last, today);
  const iv = Math.max(1, t.srs.interval || 1);
  return clamp(Math.exp(-Math.max(0, since - iv) / (iv * 1.5)), 0.5, 1);
}

export function masteryOf(t, today) {
  const base = t.mastery ?? (t.rag ? RAG_PRIOR[t.rag] : 0.35);
  return clamp(base * retention(t, today), 0, 1);
}

export const ragFromMastery = m => (m < 0.5 ? 'red' : m < 0.78 ? 'amber' : 'green');

// SM-2-style update. q: 0–5 (≥3 = remembered).
export function sm2(srs, q, today = ymd(Date.now())) {
  const s = { ease: 2.5, interval: 0, reps: 0, lapses: 0, ...srs };
  if (q < 3) {
    s.reps = 0;
    s.interval = 1;
    s.lapses += 1;
  } else {
    s.reps += 1;
    s.interval = s.reps === 1 ? 1 : s.reps === 2 ? 3 : Math.round(Math.max(1, s.interval) * s.ease);
  }
  s.ease = clamp(s.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02), 1.3, 3);
  s.interval = clamp(s.interval, 1, 180);
  s.last = today;
  s.due = addDays(today, s.interval);
  return s;
}

const qualityFromScore = f => (f >= 0.9 ? 5 : f >= 0.75 ? 4 : f >= 0.55 ? 3 : f >= 0.3 ? 2 : 1);

// Every assessment — exam question, recall check, self-rating — updates the model.
export function recordAssessment(t, fraction, { source = 'exam', marks, outOf, mistakes = [], minutes = 0, today = ymd(Date.now()) } = {}) {
  const f = clamp(fraction, 0, 1);
  const alpha = source === 'exam' ? 0.4 : source === 'self' ? 0.25 : 0.35;
  const prev = t.mastery ?? (t.rag ? RAG_PRIOR[t.rag] : 0.35);
  const mastery = prev * (1 - alpha) + f * alpha;
  const mist = { ...t.mistakes };
  for (const m of mistakes) {
    const tag = String(m).toLowerCase().slice(0, 60).trim();
    if (tag) mist[tag] = (mist[tag] ?? 0) + 1;
  }
  const stats = { ...t.stats, minutes: t.stats.minutes + minutes };
  if (source === 'exam') {
    stats.questions += 1;
    stats.marks += marks ?? Math.round(f * (outOf ?? 1));
    stats.outOf += outOf ?? 1;
  }
  return { ...t, mastery, rag: t.ragLocked ? t.rag : ragFromMastery(mastery), mistakes: mist, stats, srs: sm2(t.srs, qualityFromScore(f), today), updatedAt: Date.now() };
}

// Student sets RAG themselves: it moves mastery toward that level until evidence arrives.
export function setRag(t, rag) {
  const prior = RAG_PRIOR[rag];
  const evidence = t.stats.questions + t.stats.reviews;
  const mastery = t.mastery == null || evidence === 0 ? prior : t.mastery * 0.5 + prior * 0.5;
  return { ...t, rag, ragLocked: false, mastery, updatedAt: Date.now() };
}

/* ── flashcards (concept-level spaced repetition) ────── */
export const GRADES = [
  { id: 'again', label: 'Again', q: 1 },
  { id: 'hard', label: 'Hard', q: 3 },
  { id: 'good', label: 'Good', q: 4 },
  { id: 'easy', label: 'Easy', q: 5 }
];
export const newCard = (front, back) => ({ id: uid(), front: String(front).slice(0, 400), back: String(back).slice(0, 800), srs: { ease: 2.5, interval: 0, reps: 0, due: null, lapses: 0, last: null } });

export function reviewCard(t, cardId, q, today = ymd(Date.now())) {
  const cards = t.cards.map(c => (c.id === cardId ? { ...c, srs: sm2(c.srs, q, today) } : c));
  const recalled = q >= 3 ? 1 : 0;
  const stats = { ...t.stats, reviews: t.stats.reviews + 1, recalled: t.stats.recalled + recalled };
  const rate = stats.recalled / Math.max(1, stats.reviews);
  const prev = t.mastery ?? (t.rag ? RAG_PRIOR[t.rag] : 0.35);
  const mastery = prev * 0.9 + (q >= 3 ? Math.max(prev, rate) : Math.min(prev, rate * 0.8)) * 0.1;
  // The topic's own review date follows its weakest card.
  const due = cards.map(c => c.srs.due).filter(Boolean).sort()[0] ?? t.srs.due;
  return { ...t, cards, stats, mastery, rag: t.ragLocked ? t.rag : ragFromMastery(mastery), srs: { ...t.srs, due, last: today }, updatedAt: Date.now() };
}

export function dueCards(topicsByCourse, today = ymd(Date.now())) {
  const out = [];
  for (const [courseKey, list] of Object.entries(topicsByCourse ?? {}))
    for (const t of list) for (const c of t.cards ?? []) if (!c.srs.due || c.srs.due <= today) out.push({ courseKey, topic: t, card: c });
  return out.sort((a, b) => (a.card.srs.due ?? '') < (b.card.srs.due ?? '') ? -1 : 1);
}

/* ── evidence-based techniques ───────────────────────── */
export const TECHNIQUES = {
  active_recall: {
    name: 'Active recall',
    what: 'Pulling information out of memory without looking, instead of re-reading it.',
    why: 'Each successful retrieval strengthens the memory and shows you exactly what you don’t know yet. It consistently beats re-reading and highlighting in studies of learning.',
    how: ['Close your notes.', 'Answer questions or write what you remember.', 'Check against the source and fix the gaps.'],
    when: 'Every session, as soon as you have met the content once.'
  },
  spaced_repetition: {
    name: 'Spaced repetition',
    what: 'Reviewing material at growing intervals — 1 day, 3 days, a week, longer.',
    why: 'Memories fade on a forgetting curve; reviewing just as they start to fade resets the curve and makes it flatter each time, so you remember for months rather than days.',
    how: ['Review what EUREKA marks as due today.', 'Rate how well you remembered.', 'EUREKA schedules the next review from your rating.'],
    when: 'Daily, a little at a time — not all at once before the exam.'
  },
  feynman: {
    name: 'The Feynman Technique',
    what: 'Explaining a topic in simple words as if teaching someone younger.',
    why: 'If you can’t explain it simply, you don’t understand it yet. Explaining exposes vague ideas and gaps so you can fix them.',
    how: ['Pick one concept.', 'Explain it in plain language, no jargon.', 'Find where you got stuck, go back to the source, simplify again.'],
    when: 'For hard concepts (processes, causes, proofs), after first learning them.'
  },
  flashcards: {
    name: 'Flashcards',
    what: 'One question or term on the front, the answer on the back.',
    why: 'Cards turn content into quick retrieval practice and work perfectly with spaced repetition. Best for definitions, key facts, equations and quotes.',
    how: ['Keep each card to one idea.', 'Say the answer before flipping.', 'Rate yourself honestly.'],
    when: 'Short daily reviews; definitions and facts.'
  },
  blurting: {
    name: 'Blurting',
    what: 'Writing down everything you remember about a topic from memory, then checking.',
    why: 'A fast, high-effort form of recall that shows the shape of what you know — and the missing pieces — in a few minutes.',
    how: ['Set a timer for 3–5 minutes.', 'Write everything you remember, no notes.', 'Compare with the spec, highlight what you missed, and blurt again later.'],
    when: 'Start or end of a topic session.'
  },
  mind_map: {
    name: 'Mind mapping',
    what: 'A diagram linking ideas around a central topic.',
    why: 'Building links between ideas helps you organise knowledge and answer synoptic or extended questions. Most useful once you know the content.',
    how: ['Topic in the centre.', 'Main branches for sub-topics.', 'Add links between branches — that’s where the learning is.'],
    when: 'Consolidating a topic or connecting several.'
  },
  interleaving: {
    name: 'Interleaving',
    what: 'Mixing different topics or question types in one practice session.',
    why: 'It feels harder, but it trains you to choose the right method — exactly what an exam asks — and leads to better long-term performance than blocked practice.',
    how: ['Mix 2–3 topics in one set of questions.', 'Identify the topic before answering.', 'Keep the mix varied across the week.'],
    when: 'Practice sessions once you know the individual topics.'
  },
  retrieval: {
    name: 'Retrieval practice',
    what: 'Low-stakes quizzing on what you have learned.',
    why: 'Testing is not just measurement — the act of answering builds stronger memories than studying the same material again.',
    how: ['Short questions, one at a time.', 'Answer before checking.', 'Revisit anything you got wrong.'],
    when: 'Every session.'
  },
  note_taking: {
    name: 'Effective note-taking',
    what: 'Concise notes in your own words, organised by the specification.',
    why: 'Processing ideas into your own words (rather than copying) improves understanding. Spec-organised notes make revision targeted.',
    how: ['Follow the spec’s headings.', 'Write questions in the margin to use for recall later.', 'Keep it short — key terms, examples, diagrams.'],
    when: 'First time learning a topic.'
  },
  exam_practice: {
    name: 'Exam-question practice',
    what: 'Answering real-style questions and marking them against a mark scheme.',
    why: 'Exams reward specific skills — command words, structure, using the right terms. Practice with feedback is the most direct way to improve your grade.',
    how: ['Read the command word and mark count.', 'Answer in time.', 'Mark it, then rewrite to full marks.'],
    when: 'Increasingly as the exam gets closer.'
  },
  error_analysis: {
    name: 'Error analysis',
    what: 'Studying your mistakes: what went wrong, why, and how to avoid it.',
    why: 'Mistakes are the fastest route to marks. Correcting a misconception explicitly stops it repeating in the exam.',
    how: ['Log each mistake with its cause.', 'Re-learn the idea.', 'Do a similar question to prove it’s fixed.'],
    when: 'After every marked question or quiz.'
  }
};

export const ACTIVITIES = {
  learn: { name: 'Learn the content', technique: 'note_taking', why: 'You need the content in front of you before you can recall it.' },
  understand: { name: 'Explain it simply', technique: 'feynman', why: 'Explaining exposes gaps in understanding.' },
  recall: { name: 'Active recall', technique: 'blurting', why: 'Retrieving from memory strengthens it far more than re-reading.' },
  flashcards: { name: 'Flashcards', technique: 'flashcards', why: 'Quick spaced retrieval of key facts and definitions.' },
  exam: { name: 'Exam questions', technique: 'exam_practice', why: 'Turns knowledge into marks.' },
  fix: { name: 'Fix mistakes', technique: 'error_analysis', why: 'Your logged mistakes are the quickest marks to win back.' },
  consolidate: { name: 'Consolidate', technique: 'mind_map', why: 'Linking ideas locks the topic in and prepares you for longer questions.' }
};
const ORDER = ['learn', 'understand', 'recall', 'flashcards', 'exam', 'fix', 'consolidate'];

/* ── intelligent time allocation ─────────────────────── */
// How a session's minutes should be split for this topic, right now, and why.
export function allocate(t, minutes, { daysToExam = 60, gap = 1, today } = {}) {
  const m = masteryOf(t, today);
  const d = t.difficulty ?? 3;
  const mistakeCount = Object.values(t.mistakes ?? {}).reduce((a, b) => a + b, 0);
  const w = {
    learn: Math.max(0, 0.6 - m) * 2 * (t.rag === 'red' ? 1.3 : 1),
    understand: (d >= 4 ? 0.4 : d >= 3 ? 0.28 : 0.15) * (m < 0.7 ? 1 : 0.35),
    recall: 0.45 + (m > 0.4 ? 0.15 : 0),
    flashcards: 0.2 + (t.cards?.length ? 0.12 : 0),
    exam: (m > 0.35 ? 0.32 : 0.08) * (daysToExam < 21 ? 1.8 : 1) * (1 + 0.15 * gap),
    fix: mistakeCount ? 0.22 + Math.min(0.3, mistakeCount * 0.04) : 0,
    consolidate: 0.1 + (daysToExam < 10 ? 0.1 : 0) + (m > 0.6 ? 0.05 : 0)
  };
  if (daysToExam <= 3) {
    w.learn *= 0.15;
    w.understand *= 0.5;
    w.exam *= 1.3;
    w.recall *= 1.2;
  }
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  let blocks = ORDER.map(a => ({ activity: a, minutes: Math.round(((w[a] / total) * minutes) / 5) * 5 })).filter(b => b.minutes >= 5);
  const used = blocks.reduce((a, b) => a + b.minutes, 0);
  if (blocks.length && used !== minutes) {
    const biggest = blocks.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    biggest.minutes = Math.max(5, biggest.minutes + (minutes - used));
  }
  const reasons = {
    learn: t.rag === 'red' ? 'Red topic — build the content first.' : m < 0.4 ? 'Mastery is low, so start with the content.' : 'A quick refresh of the content.',
    understand: d >= 4 ? 'This is a hard topic — explaining it simply finds the gaps.' : 'Check you really understand it, not just recognise it.',
    recall: 'Retrieval is the core of every session.',
    flashcards: t.cards?.length ? `${t.cards.length} cards for this topic.` : 'Make and review cards for key facts.',
    exam: daysToExam < 21 ? `Exam in ${daysToExam} days — practise exam questions.` : gap > 1 ? 'You’re aiming several grades higher — practise the hard questions.' : 'Turn knowledge into marks.',
    fix: mistakeCount ? `${mistakeCount} logged mistake${mistakeCount > 1 ? 's' : ''} to correct.` : '',
    consolidate: 'Tie it together so it sticks.'
  };
  blocks = blocks.map(b => ({ ...b, technique: ACTIVITIES[b.activity].technique, reason: reasons[b.activity] }));
  return blocks;
}

/* ── how much time each topic needs ──────────────────── */
const RAG_BASE = { red: 240, amber: 150, green: 75 };
export function requiredMinutes(t, course, today) {
  const m = masteryOf(t, today);
  const base = t.rag ? RAG_BASE[t.rag] : 180;
  const need = base * (0.7 + 0.15 * (t.difficulty ?? 3)) * (0.6 + 0.2 * (t.weight ?? 3)) * (1 + 0.1 * gradeGap(course)) * (1 - 0.6 * m);
  return Math.max(m >= 0.9 ? 0 : 30, Math.round(need / 5) * 5);
}

/* ── the timetable ───────────────────────────────────── */
export const DEFAULT_AVAILABILITY = {
  minutes: [90, 90, 90, 90, 60, 150, 150], // Mon … Sun
  sessionLength: 50,
  start: '17:00',
  daysOff: []
};
const SPACING = [0, 1, 3, 6, 10, 14];
const weekday = dateStr => (new Date(`${dateStr}T12:00`).getDay() + 6) % 7;
const addTime = (hhmm, mins) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// exams: [{ id, courseKey, title, date, topicIds?: [] }]
export function buildPlan({ courses, topicsByCourse, exams, availability = DEFAULT_AVAILABILITY, today = ymd(Date.now()), keep = [] }) {
  const courseByKey = new Map(courses.map(c => [c.key, c]));
  const upcoming = exams.filter(e => e.date >= today && courseByKey.has(e.courseKey)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const horizonEnd = upcoming.length ? upcoming.at(-1).date : addDays(today, 27);
  const days = Math.min(120, Math.max(1, daysBetween(today, horizonEnd) + 1));

  // Each topic's deadline is its earliest exam.
  const items = [];
  for (const [courseKey, list] of Object.entries(topicsByCourse ?? {})) {
    const course = courseByKey.get(courseKey);
    if (!course) continue;
    const courseExams = upcoming.filter(e => e.courseKey === courseKey);
    for (const t of list) {
      const exam = courseExams.find(e => !e.topicIds?.length || e.topicIds.includes(t.id));
      if (!exam && courseExams.length) continue; // not in any exam's scope
      const sim = { ...t, srs: { ...t.srs } };
      items.push({
        t: sim,
        courseKey,
        course,
        exam,
        deadline: exam ? addDays(exam.date, -1) : horizonEnd,
        required: requiredMinutes(t, course, today),
        remaining: requiredMinutes(t, course, today),
        count: 0,
        last: null,
        simDue: t.srs?.due ?? null
      });
    }
  }

  const kept = keep.filter(s => s.date >= today);
  const sessions = [];
  const notes = [];
  let prevCourse = null;

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const off = availability.daysOff?.includes(date);
    let capacity = off ? 0 : availability.minutes[weekday(date)] ?? 0;
    capacity -= kept.filter(s => s.date === date).reduce((a, s) => a + s.minutes, 0);
    const examsToday = upcoming.filter(e => e.date === date);
    if (examsToday.length) capacity = Math.round(capacity * 0.5);
    if (capacity < 15) continue;
    let clock = availability.start ?? '17:00';
    const push = s => {
      sessions.push({ id: `s_${date}_${uid()}`, date, start: clock, status: 'planned', ...s });
      clock = addTime(clock, s.minutes + 10);
      capacity -= s.minutes;
    };

    // 1. Final review the day before an exam.
    for (const e of upcoming.filter(x => x.date === addDays(date, 1))) {
      const topics = items.filter(it => it.courseKey === e.courseKey).sort((a, b) => masteryOf(a.t) - masteryOf(b.t)).slice(0, 4);
      if (!topics.length || capacity < 20) continue;
      const minutes = Math.min(capacity, 45);
      push({
        kind: 'final',
        courseKey: e.courseKey,
        topicIds: topics.map(x => x.t.id),
        minutes,
        blocks: [
          { activity: 'recall', minutes: Math.round(minutes * 0.45 / 5) * 5 || 5, technique: 'blurting', reason: 'Blurt the key ideas of your weakest topics.' },
          { activity: 'flashcards', minutes: Math.round(minutes * 0.35 / 5) * 5 || 5, technique: 'flashcards', reason: 'Quick card run-through — no new content.' },
          { activity: 'consolidate', minutes: Math.max(5, minutes - (Math.round(minutes * 0.45 / 5) * 5 || 5) - (Math.round(minutes * 0.35 / 5) * 5 || 5)), technique: 'mind_map', reason: 'Calm overview, then rest.' }
        ],
        reason: `${e.title} is tomorrow — light final review, then sleep well.`
      });
    }

    // 2. Spaced reviews that are due (interleaved, up to 3 topics).
    const due = items.filter(it => it.simDue && it.simDue <= date && it.deadline >= date).sort((a, b) => masteryOf(a.t) - masteryOf(b.t));
    if (due.length && capacity >= 15) {
      const picks = due.slice(0, 3);
      const minutes = Math.min(capacity, 10 + 5 * picks.length);
      push({
        kind: 'review',
        courseKey: picks[0].courseKey,
        topicIds: picks.map(p => p.t.id),
        minutes,
        blocks: [
          { activity: 'flashcards', minutes: Math.max(5, Math.round(minutes * 0.5 / 5) * 5), technique: 'spaced_repetition', reason: 'These topics are due for review — right before you’d forget them.' },
          { activity: 'recall', minutes: Math.max(5, minutes - Math.max(5, Math.round(minutes * 0.5 / 5) * 5)), technique: 'interleaving', reason: 'Mixed questions across topics.' }
        ],
        reason: `Spaced review: ${picks.length} topic${picks.length > 1 ? 's' : ''} due.`
      });
      for (const p of picks) p.simDue = addDays(date, Math.max(2, Math.round((p.t.srs.interval || 2) * (p.t.srs.ease || 2.5))));
    }

    // 3. Mixed exam practice in the last two weeks before each exam (twice a week).
    for (const e of upcoming) {
      const left = daysBetween(date, e.date);
      if (left < 2 || left > 14 || ![0, 3].includes(left % 7) || capacity < 40) continue;
      const topics = items.filter(it => it.courseKey === e.courseKey).sort((a, b) => masteryOf(a.t) - masteryOf(b.t)).slice(0, 3);
      if (topics.length < 2) continue;
      const minutes = Math.min(capacity, Math.max(40, availability.sessionLength));
      push({
        kind: 'mock',
        courseKey: e.courseKey,
        topicIds: topics.map(x => x.t.id),
        minutes,
        blocks: [
          { activity: 'exam', minutes: Math.round(minutes * 0.65 / 5) * 5, technique: 'interleaving', reason: 'Mixed, timed exam questions — like the real paper.' },
          { activity: 'fix', minutes: Math.round(minutes * 0.25 / 5) * 5, technique: 'error_analysis', reason: 'Mark it and correct every lost mark.' },
          { activity: 'consolidate', minutes: Math.max(5, minutes - Math.round(minutes * 0.65 / 5) * 5 - Math.round(minutes * 0.25 / 5) * 5), technique: 'mind_map', reason: 'Note what to revise next.' }
        ],
        reason: `${e.title} in ${left} days — mixed exam practice.`
      });
    }

    // 4. Topic sessions by priority, with spacing and interleaving.
    const usedToday = new Set(sessions.filter(s => s.date === date).flatMap(s => s.topicIds));
    const perCourse = {};
    while (capacity >= 25) {
      const candidates = items.filter(it => {
        if (it.remaining <= 0 || it.deadline < date || usedToday.has(it.t.id)) return false;
        if (it.last && daysBetween(it.last, date) < SPACING[Math.min(it.count, SPACING.length - 1)]) return false;
        if ((perCourse[it.courseKey] ?? 0) >= 2 && items.some(o => o.courseKey !== it.courseKey && o.remaining > 0)) return false;
        return true;
      });
      if (!candidates.length) break;
      const score = it => {
        const m = masteryOf(it.t);
        const ragF = { red: 1.5, amber: 1.15, green: 0.7 }[it.t.rag] ?? 1.1;
        const need = (it.remaining / Math.max(30, it.required)) * ragF * ((it.t.weight ?? 3) / 3) * (1 + 0.1 * gradeGap(it.course)) * (1.2 - m);
        const urgency = 1 / Math.sqrt(Math.max(1, daysBetween(date, it.deadline) + 1));
        return need * (0.4 + urgency) * (it.courseKey === prevCourse ? 0.75 : 1);
      };
      const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
      const minutes = Math.min(capacity, availability.sessionLength, Math.max(25, Math.ceil(best.remaining / 5) * 5));
      const daysToExam = best.exam ? daysBetween(date, best.exam.date) : 60;
      const m = masteryOf(best.t);
      push({
        kind: m < 0.4 ? 'learn' : daysToExam < 21 ? 'practice' : 'deepen',
        courseKey: best.courseKey,
        topicIds: [best.t.id],
        minutes,
        blocks: allocate(best.t, minutes, { daysToExam, gap: gradeGap(best.course) }),
        reason: [
          best.t.rag ? `${best.t.rag[0].toUpperCase()}${best.t.rag.slice(1)} topic` : 'Not yet rated',
          best.exam ? `${best.exam.title} in ${daysToExam} days` : null,
          best.count ? `session ${best.count + 1}, spaced ${daysBetween(best.last, date)} days after the last` : 'first session'
        ]
          .filter(Boolean)
          .join(' · ')
      });
      best.remaining -= minutes;
      best.count += 1;
      best.last = date;
      best.simDue = addDays(date, SPACING[Math.min(best.count, SPACING.length - 1)] || 1);
      // Simulated progress: later sessions shift from learning towards practice.
      best.t = { ...best.t, mastery: masteryOf(best.t) + (1 - masteryOf(best.t)) * 0.18 };
      usedToday.add(best.t.id);
      perCourse[best.courseKey] = (perCourse[best.courseKey] ?? 0) + 1;
      prevCourse = best.courseKey;
    }
  }

  // Workload check.
  const unscheduled = items.filter(it => it.remaining > 0).reduce((a, it) => a + it.remaining, 0);
  const needed = items.reduce((a, it) => a + it.required, 0);
  if (unscheduled > 30) {
    const perDay = Math.ceil(unscheduled / Math.max(1, days) / 5) * 5;
    notes.push({
      level: 'warn',
      text: `Your topics need about ${Math.round(needed / 60)} hours before your exams, but your available time only fits ${Math.round((needed - unscheduled) / 60)}. EUREKA prioritised red, high-weight and soonest topics. Adding about ${perDay} minutes a day would cover everything.`
    });
  } else if (items.length) notes.push({ level: 'ok', text: `All ${items.length} topics fit into your available time (about ${Math.round(needed / 60)} hours of study).` });

  return { sessions: [...kept, ...sessions].sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1)), notes, generatedAt: Date.now(), needed, unscheduled };
}

// Missed sessions are marked (kept for analytics) and the rest of the plan is rebuilt from
// the student's current model. With stableToday, today's sessions stay as they are and the
// new plan starts tomorrow — used after every assessment so the day doesn't shift under you.
export function reschedule(study, ctx, today = ymd(Date.now()), { stableToday = false } = {}) {
  const old = study.plan?.sessions ?? [];
  let missed = 0;
  const past = old
    .filter(s => s.date < today)
    .map(s => {
      if (s.status !== 'planned') return s;
      missed += 1;
      return { ...s, status: 'missed' };
    });
  const todays = old.filter(s => s.date === today);
  const from = stableToday && todays.length ? addDays(today, 1) : today;
  const keep = from === today ? todays.filter(s => s.status !== 'planned') : [];
  const plan = buildPlan({ ...ctx, availability: study.availability ?? DEFAULT_AVAILABILITY, today: from, keep });
  const sessions = [...past, ...(from === today ? [] : todays), ...plan.sessions];
  return { plan: { ...plan, sessions, from: today }, missed };
}

export const emptyStudy = () => ({
  topics: {},
  availability: DEFAULT_AVAILABILITY,
  plan: null,
  log: [],
  roadmap: false,
  focus: { focus: 25, short: 5, long: 15, cycles: 4, sound: true },
  timer: null,
  activeSession: null,
  practice: {},
  coachAI: null
});

export const logEntry = e => ({ at: Date.now(), ...e });

/* ── roadmap (optional, long-term) ───────────────────── */
export function roadmap(exams, courses, today = ymd(Date.now())) {
  const label = k => courses.find(c => c.key === k)?.subject ?? k;
  return exams
    .filter(e => e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(e => {
      const total = Math.max(4, daysBetween(today, e.date));
      const cut = f => addDays(today, Math.round(total * f));
      const phases = [
        { id: 'foundation', name: 'Foundation', from: today, to: cut(0.45), focus: 'Learn or re-learn every red and unrated topic. Make notes and flashcards as you go.', techniques: ['note_taking', 'feynman', 'flashcards'] },
        { id: 'consolidate', name: 'Consolidation', from: cut(0.45), to: cut(0.75), focus: 'Daily recall and spaced reviews. Turn ambers green.', techniques: ['active_recall', 'spaced_repetition', 'blurting'] },
        { id: 'exam', name: 'Exam mastery', from: cut(0.75), to: cut(0.95), focus: 'Timed exam questions, mixed topics, mark-scheme language. Fix every lost mark.', techniques: ['exam_practice', 'interleaving', 'error_analysis'] },
        { id: 'final', name: 'Final review', from: cut(0.95), to: e.date, focus: 'Light recall of weak areas, sleep, no new content.', techniques: ['retrieval', 'mind_map'] }
      ];
      return { exam: e, subject: label(e.courseKey), days: total, phases };
    });
}

/* ── analytics ───────────────────────────────────────── */
export function analytics(study, courses, now = Date.now()) {
  const today = ymd(now);
  const log = study.log ?? [];
  const since = now - 30 * DAY;
  const recent = log.filter(l => l.at >= since);
  const minutesBy = (key, list = recent) =>
    list.reduce((acc, l) => {
      if (l.minutes) acc[l[key] ?? 'other'] = (acc[l[key] ?? 'other'] ?? 0) + l.minutes;
      return acc;
    }, {});
  const exam = recent.filter(l => l.type === 'exam');
  const marks = exam.reduce((a, l) => a + (l.score ?? 0), 0);
  const outOf = exam.reduce((a, l) => a + (l.outOf ?? 0), 0);
  const reviews = recent.filter(l => l.type === 'card');
  const recalled = reviews.filter(l => l.q >= 3).length;
  const topics = Object.entries(study.topics ?? {}).flatMap(([courseKey, list]) => list.map(t => ({ ...t, courseKey, m: masteryOf(t, today) })));
  const mistakes = {};
  for (const t of topics) for (const [tag, n] of Object.entries(t.mistakes ?? {})) mistakes[tag] = (mistakes[tag] ?? 0) + n;
  const days = new Set(log.map(l => ymd(l.at)));
  let streak = 0;
  for (let d = today; days.has(d); d = addDays(d, -1)) streak += 1;
  const weekAgo = addDays(today, -7);
  const sessions = (study.plan?.sessions ?? []).filter(s => s.date >= weekAgo && s.date <= today);
  const byCourse = courses.map(c => {
    const list = topics.filter(t => t.courseKey === c.key);
    return {
      key: c.key,
      subject: c.subject,
      topics: list.length,
      mastery: list.length ? list.reduce((a, t) => a + t.m, 0) / list.length : null,
      rag: { red: list.filter(t => t.rag === 'red').length, amber: list.filter(t => t.rag === 'amber').length, green: list.filter(t => t.rag === 'green').length, none: list.filter(t => !t.rag).length },
      minutes: minutesBy('courseKey')[c.key] ?? 0
    };
  });
  return {
    minutes30: recent.reduce((a, l) => a + (l.minutes ?? 0), 0),
    minutesByActivity: minutesBy('activity'),
    minutesByDay: Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i - 13);
      return { date: d, minutes: log.filter(l => ymd(l.at) === d).reduce((a, l) => a + (l.minutes ?? 0), 0) };
    }),
    accuracy: outOf ? marks / outOf : null,
    examTrend: exam.slice(-10).map(l => (l.outOf ? l.score / l.outOf : 0)),
    questions: exam.length,
    retention: reviews.length ? recalled / reviews.length : null,
    reviews: reviews.length,
    dueCards: dueCards(study.topics, today).length,
    dueTopics: topics.filter(t => t.srs?.due && t.srs.due <= today).length,
    streak,
    weak: topics.filter(t => t.rag !== 'green').sort((a, b) => a.m - b.m).slice(0, 6),
    strong: topics.filter(t => t.m >= 0.78).length,
    mistakes: Object.entries(mistakes).sort((a, b) => b[1] - a[1]).slice(0, 6),
    byCourse,
    week: { done: sessions.filter(s => s.status === 'done').length, missed: sessions.filter(s => s.status === 'missed').length, planned: sessions.filter(s => s.status === 'planned').length },
    topics
  };
}

/* ── the study coach (rule-based, always on) ─────────── */
export function coachInsights(study, a, exams, now = Date.now()) {
  const today = ymd(now);
  const out = [];
  const act = a.minutesByActivity;
  const total = Object.values(act).reduce((x, y) => x + y, 0);
  const passive = (act.learn ?? 0) + (act.reading ?? 0);
  if (total >= 60 && passive / total > 0.55)
    out.push({ id: 'passive', level: 'warn', title: 'Too much time learning, not enough recalling', why: `${Math.round((passive / total) * 100)}% of your study time is spent taking in content. Re-reading feels productive but is one of the least effective ways to revise; retrieving from memory is what builds lasting knowledge.`, action: 'Start each session with 5 minutes of blurting before you open your notes.', technique: 'active_recall' });
  if (a.dueCards + a.dueTopics >= 10)
    out.push({ id: 'overdue', level: 'warn', title: `${a.dueCards + a.dueTopics} reviews are overdue`, why: 'Spaced reviews work best on time — each day late lets more fade and makes the next review harder.', action: 'Do 10 minutes of reviews before anything else today.', technique: 'spaced_repetition' });
  const massed = (study.log ?? []).filter(l => l.at >= now - DAY && l.topicId).reduce((acc, l) => ((acc[l.topicId] = (acc[l.topicId] ?? 0) + (l.minutes ?? 0)), acc), {});
  if (Object.values(massed).some(m => m >= 90))
    out.push({ id: 'massed', level: 'tip', title: 'Long sessions on one topic', why: 'More than 90 minutes on a single topic in a day gives diminishing returns. Spreading the same time over several days (spacing) and mixing topics (interleaving) leads to better exam performance.', action: 'Split long topics across days — your timetable already does this if you follow it.', technique: 'interleaving' });
  const reds = a.topics.filter(t => t.rag === 'red');
  const touched = new Set((study.log ?? []).filter(l => l.at >= now - 7 * DAY).map(l => l.topicId));
  const avoided = reds.filter(t => !touched.has(t.id));
  if (avoided.length >= 2)
    out.push({ id: 'avoid', level: 'warn', title: `${avoided.length} red topics untouched this week`, why: 'It’s natural to revise what you’re already good at — it feels better — but red topics are where most of your marks are waiting.', action: `Start with “${avoided[0].name}” next session.`, technique: 'feynman' });
  const greenMin = a.topics.filter(t => t.rag === 'green').reduce((x, t) => x + (t.stats?.minutes ?? 0), 0);
  const redMin = reds.reduce((x, t) => x + (t.stats?.minutes ?? 0), 0);
  if (greenMin > 120 && greenMin > redMin * 2)
    out.push({ id: 'overgreen', level: 'tip', title: 'Lots of time on green topics', why: 'Green topics only need short spaced reviews to stay green. Extra time there could turn a red into an amber instead.', action: 'Let spaced reviews handle greens; use full sessions for reds and ambers.', technique: 'spaced_repetition' });
  const soon = exams.filter(e => e.date >= today && daysBetween(today, e.date) <= 14);
  if (soon.length && a.questions < 5)
    out.push({ id: 'noexam', level: 'warn', title: `Exam in ${daysBetween(today, soon[0].date)} days, few exam questions done`, why: 'Close to an exam, practising real-style questions with a mark scheme is the most direct way to gain marks — it trains timing, command words and structure.', action: 'Do 3 exam questions today in the Practice tab.', technique: 'exam_practice' });
  if (a.week.missed >= 3)
    out.push({ id: 'missed', level: 'tip', title: `${a.week.missed} sessions missed this week`, why: 'A plan you can keep beats an ambitious one you can’t. Missed sessions are rescheduled automatically, but a realistic daily target builds consistency.', action: 'Lower your daily minutes in Planner → Availability, so the plan fits your week.', technique: null });
  const over = a.topics.filter(t => t.rag === 'green' && t.stats?.outOf >= 4 && t.stats.marks / t.stats.outOf < 0.55);
  if (over.length)
    out.push({ id: 'calibrate', level: 'tip', title: 'Some “green” topics score low in exam questions', why: `You rated ${over.map(t => `“${t.name}”`).slice(0, 2).join(' and ')} green, but your marks there are under 55%. Feeling familiar isn’t the same as being able to answer — EUREKA has moved them back for more practice.`, action: 'Trust test results over feelings: practise before rating a topic green.', technique: 'retrieval' });
  if (a.mistakes.length && a.mistakes[0][1] >= 3)
    out.push({ id: 'recurring', level: 'tip', title: `Recurring mistake: ${a.mistakes[0][0]}`, why: 'The same mistake keeps costing marks. Fixing a recurring error once, deliberately, is worth more than many new questions.', action: 'Ask the tutor to re-teach this misconception and give you three targeted questions.', technique: 'error_analysis' });
  if (!out.length && a.minutes30 > 0)
    out.push({ id: 'good', level: 'ok', title: 'Your revision habits look effective', why: 'You’re mixing recall, spaced reviews and practice. Keep following the plan — consistency matters more than long sessions.', action: 'Keep your streak going today.', technique: 'spaced_repetition' });
  return out;
}

/* ── context for the tutor ───────────────────────────── */
// A compact summary of the student, sent with every chat so the tutor adapts.
export function studentModelText(study, courses, focusKey, now = Date.now()) {
  const today = ymd(now);
  const lines = [];
  for (const c of courses) {
    const list = study.topics?.[c.key] ?? [];
    const head = `${c.subject}${c.qualification ? ` (${c.qualification}${c.board ? `, ${c.board}` : ''})` : ''}: current ${c.currentGrade || '?'} → target ${c.targetGrade || '?'}`;
    if (!list.length) {
      lines.push(`- ${head}`);
      continue;
    }
    const red = list.filter(t => t.rag === 'red').map(t => t.name);
    const amber = list.filter(t => t.rag === 'amber').map(t => t.name);
    const green = list.filter(t => t.rag === 'green').map(t => t.name);
    lines.push(`- ${head}${c.key === focusKey ? '  ← current focus' : ''}`);
    if (c.key === focusKey || courses.length <= 2) {
      if (red.length) lines.push(`  RED (explain from the basics, check understanding often): ${red.slice(0, 12).join('; ')}`);
      if (amber.length) lines.push(`  AMBER (consolidate, more practice): ${amber.slice(0, 12).join('; ')}`);
      if (green.length) lines.push(`  GREEN (confident — keep brief, challenge with harder questions): ${green.slice(0, 12).join('; ')}`);
      const mist = list.flatMap(t => Object.entries(t.mistakes ?? {}).map(([k, n]) => [k, n, t.name])).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (mist.length) lines.push(`  Recurring mistakes: ${mist.map(([k, n, tn]) => `${k} (${tn}, ×${n})`).join('; ')}`);
      const weak = list.map(t => ({ n: t.name, m: masteryOf(t, today) })).sort((a, b) => a.m - b.m).slice(0, 3);
      lines.push(`  Weakest by evidence: ${weak.map(w => `${w.n} ${Math.round(w.m * 100)}%`).join('; ')}`);
    }
  }
  const session = study.activeSession;
  if (session) lines.push(`The student is in a guided revision session right now (step: ${session.stepName ?? 'starting'}). Keep to that step.`);
  return lines.join('\n').slice(0, 3800);
}
