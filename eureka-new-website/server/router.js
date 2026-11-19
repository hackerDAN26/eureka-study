// Picks the model for each message from what the question actually needs — not its length.
//
//   Free  → GPT-OSS 20B, always.
//   Pro   → GPT-OSS 120B; GPT-OSS 20B for simple requests (thanks, quick definitions, rephrasing).
//   Max   → GPT-OSS 120B; Qwen 3.8 for genuinely hard work (multi-step maths, proofs, long
//           exam-style analysis) and for images.
//
// The classifier is a few cheap text checks (no extra AI call). Each signal adds to a
// difficulty score; a short follow-up ("next step?", "I don't get it") inherits the score of
// the question it follows, so a hard problem stays on the same model while the student works
// through it.

export const MODEL_IDS = {
  small: 'openai/gpt-oss-20b',
  standard: 'openai/gpt-oss-120b',
  advanced: 'qwen/qwen3.8-27b'
};

const HARD_AT = 4; // score from which Max escalates to Qwen

// Topics where a single short question usually needs several careful reasoning steps.
const ADVANCED_TERMS =
  /\b(integra(l|te|tion)|differentiat|derivative|d[yx]\s*\/\s*d[xt]|partial fraction|implicit|parametric|maclaurin|taylor series|limit of|converge|series expansion|binomial expansion|proof by|induction|contradiction|eigen|matri(x|ces)|determinant|vectors? (equation|product)|cross product|dot product|complex numbers?|argand|de moivre|differential equation|hypothesis test|binomial distribution|normal distribution|poisson|standard deviation|conditional probability|bayes|regression|correlation coefficient|projectile|simple harmonic|circular motion|moments? about|equilibrium of|kinematics|momentum|impulse|work[- ]energy|electromagnetic induction|faraday|lenz|capacitor|electric field|gravitational field|half[- ]life|quantum|photoelectric|wave[- ]particle|special relativity|thermodynamic|entropy|gibbs|enthalpy (change|cycle)|hess'?s law|born[- ]haber|equilibrium constant|\bK[cp]\b|buffer|pH (of|calculation)|titration calculation|rate equation|order of reaction|arrhenius|electrode potential|electrochemical|redox equation|reaction mechanism|nucleophilic|electrophilic|stereoisomer|chirality|organic synthesis|retrosynthesis|nmr|mass spectr|infrared spectr|hardy[- ]weinberg|chi[- ]squared|dihybrid|epistasis|linkage|statistical test|marginal (cost|revenue)|elasticity calculation|algorithm complexity|big[- ]o|recursion|dynamic programming)\b/i;

const PROOF = /\b(prove|proof|show that|hence (show|find|prove|deduce)|derive|deduce|by induction)\b/i;
const MULTI_STEP = /\b(step[- ]by[- ]step|solve|calculate|work out|find the (value|exact|minimum|maximum|area|volume|equation|gradient|probability|roots?)|how many (ways|moles|grams)|determine|evaluate|simplify fully|rearrange|expand and simplify)\b/gi;
const ANALYSIS = /\b(to what extent|critically|evaluate|assess (the|whether|how)|analy[sz]e|compare and contrast|discuss|justify|significance of|how far do you agree)\b/i;
const MARKS = /[[(]\s*(\d{1,2})\s*marks?\s*[\])]|\b(\d{1,2})[- ]?mark(er)?s?\b/gi;
const SUBPARTS = /(^|\s)\(?[a-h]\)\s|(^|\s)\(?(i|ii|iii|iv|v)\)\s/gim;
const MATH_EXPR = /(\d\s*[+\-*/×÷^]\s*[\d(a-z])|([a-z]\s*\^\s*\d)|([a-z]²|[a-z]³)|√|∫|∑|π|≤|≥|≠|\\frac|\bsin\b|\bcos\b|\btan\b|\blog\b|\bln\b|\be\^/gi;

const SIMPLE =
  /^\s*(hi|hey|hello|yo|thanks?( you)?|thank u|ty|thx|ok(ay)?|cool|nice|great|got it|perfect|bye|good (morning|night)|lol|yes|no|sure|nope|yep)\b[\s!.?]*$/i;
const LIGHT_TASK =
  /^\s*(what (is|are|does) (a |an |the )?[\w\s'-]{1,40}\??|define [\w\s'-]{1,40}|meaning of [\w\s'-]{1,40}|(how do you )?spell [\w\s'-]{1,30}|translate .{1,80}|(make it|can you make (it|this)) (shorter|simpler|longer|bullet points?)|rephrase( this| that)?|summari[sz]e( this| that)?( in .{1,30})?|give me (a )?(motivation|motivational quote|study tip)|(fix|check) (my )?(grammar|spelling)( .{0,80})?)\s*[.?!]*\s*$/i;
const FOLLOW_UP =
  /^\s*(continue|go on|next( step)?|keep going|and( then)?|why\??|how\??|what about (part )?\(?[a-h]\)?|i (don'?t|do not) (get|understand)( it| this| that)?|explain (more|again|that)|hint|another hint|show me|can you check (my|this)|is (this|that|it) (right|correct)\??|what'?s next)\b.{0,60}$/i;

// Difficulty of one message: { score, reasons }.
export function assess(text) {
  const t = String(text ?? '');
  const reasons = [];
  let score = 0;
  const add = (n, why) => {
    score += n;
    reasons.push(why);
  };
  if (ADVANCED_TERMS.test(t)) add(2, 'advanced topic');
  if (PROOF.test(t)) add(3, 'proof or derivation');
  const steps = new Set((t.match(MULTI_STEP) ?? []).map(s => s.toLowerCase())).size;
  if (steps) add(Math.min(2, steps), 'multi-step working');
  const exprs = (t.match(MATH_EXPR) ?? []).length;
  if (exprs >= 3) add(2, 'mathematical working');
  else if (exprs >= 1) add(1, 'some maths');
  if (ANALYSIS.test(t)) add(1, 'extended analysis');
  const marks = Math.max(0, ...[...t.matchAll(MARKS)].map(m => Number(m[1] ?? m[2]) || 0));
  if (marks >= 9) add(2, `${marks}-mark question`);
  else if (marks >= 6) add(1, `${marks}-mark question`);
  if ((t.match(SUBPARTS) ?? []).length >= 3) add(1, 'several sub-parts');
  return { score, reasons };
}

export const isSimple = text => {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (SIMPLE.test(t)) return true;
  return t.length <= 140 && LIGHT_TASK.test(t) && assess(t).score === 0;
};

export const isFollowUp = text => String(text ?? '').trim().length <= 80 && FOLLOW_UP.test(String(text ?? ''));

const TIER_RANK = { free: 0, pro: 1, max: 2 };
const MODEL_TIER = { [MODEL_IDS.small]: 'free', [MODEL_IDS.standard]: 'pro', [MODEL_IDS.advanced]: 'max' };

/**
 * Chooses the model for a chat message.
 *   plan        verified plan ('free' | 'pro' | 'max')
 *   requested   the model the student picked, or 'auto'
 *   text        the student's latest message; prevText: their message before it
 *   hasImage    an image is attached; canSeeImages: the plan may send images to the AI
 *   needsSearch web/specification search (only GPT-OSS can search)
 *   budgetUsed  share of the student's monthly AI budget already used (0–1+)
 *   escalateUntil  stop escalating to Qwen beyond this share of the budget
 * Returns { model, route: 'auto' | 'manual', escalated, level, reasons }.
 */
export function chooseModel({ plan = 'free', requested = 'auto', text = '', prevText = '', hasImage = false, canSeeImages = false, needsSearch = false, budgetUsed = 0, escalateUntil = 0.8 }) {
  const rank = TIER_RANK[plan] ?? 0;
  // A specific model the plan includes is honoured (students can still choose).
  if (requested && requested !== 'auto' && MODEL_TIER[requested] && TIER_RANK[MODEL_TIER[requested]] <= rank) {
    return { model: requested, route: 'manual', escalated: requested === MODEL_IDS.advanced, level: null, reasons: ['chosen by student'] };
  }
  if (rank === 0) return { model: MODEL_IDS.small, route: 'auto', escalated: false, level: 'plan', reasons: ['Free plan'] };

  let { score, reasons } = assess(text);
  if (isFollowUp(text)) {
    const prev = assess(prevText);
    if (prev.score > score) [score, reasons] = [prev.score, [...prev.reasons, 'follow-up']];
  }
  const level = score >= HARD_AT ? 'hard' : isSimple(text) && score === 0 ? 'simple' : 'normal';

  if (rank === 1) {
    return level === 'simple'
      ? { model: MODEL_IDS.small, route: 'auto', escalated: false, level, reasons: ['simple request'] }
      : { model: MODEL_IDS.standard, route: 'auto', escalated: false, level, reasons };
  }
  // Max
  const imageTurn = hasImage && canSeeImages;
  const roomInBudget = budgetUsed < escalateUntil;
  if (imageTurn) return { model: MODEL_IDS.advanced, route: 'auto', escalated: true, level, reasons: ['image'] };
  if (level === 'hard' && !needsSearch && roomInBudget) return { model: MODEL_IDS.advanced, route: 'auto', escalated: true, level, reasons };
  return { model: MODEL_IDS.standard, route: 'auto', escalated: false, level, reasons: level === 'hard' && !roomInBudget ? [...reasons, 'monthly budget mostly used'] : reasons };
}
