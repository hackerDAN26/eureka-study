// Sales, limited-time bonuses, rewards (Leaves) and the loyalty program.
//
// Every discount has a promo code. Create the same codes in your payment provider
// (Whop → your product → Promo codes). EUREKA copies the student's best code for them to
// paste at Whop checkout. One discount applies per purchase.

const DAY = 86400e3;
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const endOf = (y, m, d) => at(y, m, d, 23, 59);

// Black Friday week: the Friday before through Cyber Monday (US Thanksgiving = 4th Thursday of November).
function blackFriday(y) {
  const nov1 = at(y, 11, 1).getDay();
  const thanksgiving = 1 + ((4 - nov1 + 7) % 7) + 21;
  const friday = at(y, 11, thanksgiving + 1);
  return { start: new Date(friday.getTime() - 7 * DAY), end: endOf(y, 11, thanksgiving + 4) };
}

// Bonus types: messages = extra daily AI messages (fraction), points = Leaves multiplier.
const SEASONS = [
  {
    id: 'black_friday',
    name: 'Black Friday',
    tagline: 'Our biggest sale of the year',
    percent: 40,
    code: 'BLACKFRIDAY40',
    window: y => blackFriday(y),
    bonus: { type: 'points', mult: 2, label: 'Double Leaves on everything you do' }
  },
  {
    id: 'back_to_school',
    name: 'Back to School',
    tagline: 'Start the year organised',
    percent: 25,
    code: 'BACK2SCHOOL25',
    window: y => ({ start: at(y, 8, 20), end: endOf(y, 9, 30) }),
    bonus: { type: 'points', mult: 2, label: 'Double Leaves while you settle in' }
  },
  {
    id: 'autumn_midterm',
    name: 'Midterm Sale',
    tagline: 'Catch up over half term',
    percent: 15,
    code: 'MIDTERM15',
    window: y => ({ start: at(y, 10, 20), end: endOf(y, 11, 10) }),
    bonus: { type: 'messages', boost: 0.25, label: '+25% daily AI messages on every plan' }
  },
  {
    id: 'winter_holiday',
    name: 'Winter Holiday',
    tagline: 'Revise between the celebrations',
    percent: 20,
    code: 'WINTER20',
    window: y => ({ start: at(y, 12, 18), end: endOf(y + 1, 1, 6) }),
    bonus: { type: 'messages', boost: 0.25, label: 'Holiday Revision Boost: +25% daily AI messages' }
  },
  {
    id: 'spring_midterm',
    name: 'Spring Midterm',
    tagline: 'A push before mocks',
    percent: 15,
    code: 'MIDTERM15',
    window: y => ({ start: at(y, 2, 10), end: endOf(y, 2, 28) }),
    bonus: { type: 'points', mult: 2, label: 'Double Leaves' }
  },
  {
    id: 'exam_season',
    name: 'Exam Season',
    tagline: 'Everything you need for the big papers',
    percent: 20,
    code: 'EXAMSEASON20',
    window: y => ({ start: at(y, 4, 15), end: endOf(y, 6, 20) }),
    bonus: { type: 'messages', boost: 0.5, label: 'Exam Boost: +50% daily AI messages on every plan' }
  },
  {
    id: 'summer_holiday',
    name: 'Summer Holiday',
    tagline: 'Get ahead for next year',
    percent: 20,
    code: 'SUMMER20',
    window: y => ({ start: at(y, 6, 21), end: endOf(y, 8, 19) }),
    bonus: { type: 'points', mult: 2, label: 'Double Leaves all summer' }
  }
];

export function activeSeason(now = Date.now()) {
  const y = new Date(now).getFullYear();
  for (const s of SEASONS) {
    for (const year of [y - 1, y]) {
      const { start, end } = s.window(year);
      if (now >= start.getTime() && now <= end.getTime()) return { ...s, start, end };
    }
  }
  return null;
}

export function nextSeason(now = Date.now()) {
  const y = new Date(now).getFullYear();
  return SEASONS.flatMap(s => [y, y + 1].map(year => ({ ...s, ...s.window(year) })))
    .filter(s => s.start.getTime() > now)
    .sort((a, b) => a.start - b.start)[0];
}

/* ── one-off offers ──────────────────────────────────── */
export const WELCOME = { percent: 30, code: 'WELCOME30', hours: 72, billing: 'monthly' };
export const EXAM_YEAR = { percent: 15, code: 'EXAMYEAR15', billing: 'yearly' };

export function welcomeOffer(firstSeen, now = Date.now(), hasPaid = false) {
  if (!firstSeen || hasPaid) return null;
  const end = firstSeen + WELCOME.hours * 3600e3;
  return now < end ? { ...WELCOME, end: new Date(end) } : null;
}

/* ── Leaves: tiered rewards ──────────────────────────── */
export const TIERS = [
  { id: 'seedling', name: 'Seedling', min: 0, messages: 0, prompts: 0, percent: 0 },
  { id: 'sprout', name: 'Sprout', min: 250, messages: 5, prompts: 2, percent: 0 },
  { id: 'sapling', name: 'Sapling', min: 1000, messages: 10, prompts: 5, percent: 5, code: 'LEAVES5' },
  { id: 'evergreen', name: 'Evergreen', min: 2500, messages: 20, prompts: 10, percent: 10, code: 'LEAVES10' },
  { id: 'ancient_oak', name: 'Ancient Oak', min: 6000, messages: 30, prompts: 20, percent: 15, code: 'LEAVES15' }
];

export const EARN = {
  message: { points: 2, dailyCap: 60, label: 'Ask the tutor a question', note: '+2 each, up to 60 a day' },
  streak: { points: 10, label: 'Study on a new day', note: '+10, plus +2 per day of your streak (up to +20)' },
  deadline: { points: 15, dailyCap: 75, label: 'Complete a deadline', note: '+15 each, up to 5 a day' },
  invite: { points: 50, totalCap: 500, label: 'Invite a classmate', note: '+50 each, up to 10 invites' },
  session: { points: 10, dailyCap: 50, label: 'Finish a guided study session', note: '+10 each, up to 50 a day' },
  question: { points: 5, dailyCap: 50, label: 'Answer an exam question', note: '+5 each, up to 50 a day' },
  review: { points: 1, dailyCap: 40, label: 'Review a flashcard', note: '+1 each, up to 40 a day' },
  setup: { points: 25, once: true, label: 'Choose your subjects', note: '+25 once' },
  paidMonth: { points: 150, label: 'Each month on Pro or Max', note: '+150 a month' }
};

export const tierFor = points => [...TIERS].reverse().find(t => points >= t.min) ?? TIERS[0];
export const nextTier = points => TIERS.find(t => t.min > points) ?? null;

export const emptyRewards = () => ({ points: 0, earnedToday: {}, day: '', streak: 0, lastStudyDay: '', totals: {}, history: [], paidMonthsAwarded: 0 });

const today = (now = Date.now()) => new Date(now).toLocaleDateString('en-CA');

// Returns the updated rewards object and how many Leaves were added.
export function award(rewards, kind, now = Date.now()) {
  const rule = EARN[kind];
  if (!rule) return { rewards, added: 0 };
  const r = { ...emptyRewards(), ...rewards, earnedToday: { ...(rewards?.earnedToday ?? {}) }, totals: { ...(rewards?.totals ?? {}) } };
  const d = today(now);
  if (r.day !== d) {
    r.day = d;
    r.earnedToday = {};
  }
  let base = rule.points;
  if (rule.once && r.totals[kind]) return { rewards, added: 0 };
  if (rule.totalCap && (r.totals[kind] ?? 0) >= rule.totalCap) return { rewards, added: 0 };
  if (rule.dailyCap) base = Math.min(base, Math.max(0, rule.dailyCap - (r.earnedToday[kind] ?? 0)));
  let added = base;
  const entries = [];
  if (base > 0) entries.push(rule.label);

  // A new study day extends (or restarts) the streak.
  if (kind === 'message' && r.lastStudyDay !== d) {
    const yesterday = today(now - DAY);
    r.streak = r.lastStudyDay === yesterday ? r.streak + 1 : 1;
    r.lastStudyDay = d;
    const streakPts = EARN.streak.points + Math.min(20, 2 * (r.streak - 1));
    added += streakPts;
    entries.push(`${r.streak}-day study streak`);
  }
  if (!added) return { rewards, added: 0 };

  const season = activeSeason(now);
  const mult = season?.bonus.type === 'points' ? season.bonus.mult : 1;
  added = Math.round(added * mult);
  r.points += added;
  r.earnedToday[kind] = (r.earnedToday[kind] ?? 0) + base;
  r.totals[kind] = (r.totals[kind] ?? 0) + base;
  r.history = [{ at: now, kind, points: added, label: entries.join(' · ') + (mult > 1 ? ` (×${mult} ${season.name})` : '') }, ...r.history].slice(0, 30);
  return { rewards: r, added };
}

/* ── loyalty (continuous paid subscription) ──────────── */
export const LOYALTY = [
  { id: 'bronze', name: 'Bronze', months: 3, percent: 5, code: 'LOYAL5' },
  { id: 'silver', name: 'Silver', months: 6, percent: 10, code: 'LOYAL10' },
  { id: 'gold', name: 'Gold', months: 12, percent: 15, code: 'LOYAL15' }
];

export function loyaltyStatus(plan, now = Date.now()) {
  const months = plan?.tier && plan.tier !== 'free' && plan.since ? Math.floor((now - plan.since) / (30.44 * DAY)) : 0;
  const level = [...LOYALTY].reverse().find(l => months >= l.months) ?? null;
  const next = LOYALTY.find(l => months < l.months) ?? null;
  return { months, level, next };
}

/* ── best discount for a purchase ────────────────────── */
// One discount per purchase: EUREKA picks the biggest one the student qualifies for.
export function offersFor({ planId, billing, now = Date.now(), firstSeen, hasPaid, examYear, points, plan }) {
  if (planId === 'free') return [];
  const list = [];
  const season = activeSeason(now);
  if (season) list.push({ source: 'season', name: /sale$/i.test(season.name) ? season.name : `${season.name} sale`, percent: season.percent, code: season.code, ends: season.end });
  const welcome = welcomeOffer(firstSeen, now, hasPaid);
  if (welcome && billing === 'monthly') list.push({ source: 'welcome', name: 'Welcome offer (first month)', percent: welcome.percent, code: welcome.code, ends: welcome.end });
  if (examYear && billing === 'yearly') list.push({ source: 'exam_year', name: 'Exam Year discount', percent: EXAM_YEAR.percent, code: EXAM_YEAR.code });
  const tier = tierFor(points ?? 0);
  if (tier.percent) list.push({ source: 'rewards', name: `${tier.name} rewards discount`, percent: tier.percent, code: tier.code });
  const loyal = loyaltyStatus(plan, now).level;
  if (loyal) list.push({ source: 'loyalty', name: `${loyal.name} loyalty discount`, percent: loyal.percent, code: loyal.code });
  return list.sort((a, b) => b.percent - a.percent);
}

export function timeLeft(end, now = Date.now()) {
  const ms = end - now;
  if (ms <= 0) return 'ended';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / 3600e3);
  if (d >= 2) return `${d} days left`;
  if (d === 1) return `1 day ${h}h left`;
  const m = Math.floor((ms % 3600e3) / 60e3);
  return h ? `${h}h ${m}m left` : `${m}m left`;
}
