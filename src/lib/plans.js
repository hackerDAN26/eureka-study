// Plans, prices and the limits the app enforces.
export const YEARLY_DISCOUNT = 0.1;
export const CONTACT_EMAIL = 'eurekasofficial@gmail.com';

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'For students discovering EUREKA',
    monthly: 0,
    limits: {
      messagesPerDay: 25,
      webPerDay: 5,
      filesPerMessage: 3,
      fileMB: 5,
      workspaces: 1,
      members: 0,
      savedChats: 15,
      customPrompts: 3,
      efforts: 2,
      customTutor: false
    },
    features: [
      '25 AI messages a day',
      'GPT-OSS 20B — fast answers, reads images with Qwen 3.8',
      '3 sources per message, 5 MB each',
      '5 web searches a day',
      '1 workspace · 15 saved chats',
      '3 saved custom prompts',
      'Calendar, deadlines & reminders',
      'Thinking level up to Medium'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'Advanced learning for serious revision',
    monthly: 29.99,
    limits: {
      messagesPerDay: 300,
      webPerDay: 100,
      filesPerMessage: 10,
      fileMB: 18,
      workspaces: 5,
      members: 5,
      savedChats: 250,
      customPrompts: 25,
      efforts: 3,
      customTutor: false
    },
    features: [
      'Everything in Free',
      '300 AI messages a day',
      'Qwen 3.8 — smarter answers, reads images',
      '10 sources per message, 18 MB each',
      '100 web searches a day',
      '5 workspaces · 250 saved chats',
      'Share workspaces with up to 5 people',
      '25 saved custom prompts',
      'High thinking level'
    ]
  },
  max: {
    id: 'max',
    name: 'Max',
    tagline: 'Complete academic intelligence',
    monthly: 44.79,
    limits: {
      messagesPerDay: 1000,
      webPerDay: 400,
      filesPerMessage: 20,
      fileMB: 18,
      workspaces: 25,
      members: 25,
      savedChats: 2000,
      customPrompts: 100,
      efforts: 3,
      customTutor: true
    },
    features: [
      'Everything in Pro',
      '1,000 AI messages a day (fair use)',
      'GPT-OSS 120B — the most capable model',
      '20 sources per message, 18 MB each',
      '400 web searches a day',
      '25 workspaces · 2,000 saved chats',
      'Share workspaces with up to 25 people',
      '100 saved custom prompts',
      'High thinking level',
      'Custom tutor instructions'
    ]
  }
};

export const PLAN_ORDER = ['free', 'pro', 'max'];

const round2 = n => Math.round(n * 100) / 100;
export const money = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// percent = an extra promo discount (sale, welcome offer, rewards or loyalty), applied once.
export function price(plan, billing, percent = 0) {
  if (!plan.monthly) return { perMonth: 0, total: 0, listPerMonth: 0, listTotal: 0 };
  const yearly = billing === 'yearly';
  const listPerMonth = yearly ? round2(plan.monthly * (1 - YEARLY_DISCOUNT)) : plan.monthly;
  const listTotal = yearly ? round2(plan.monthly * 12 * (1 - YEARLY_DISCOUNT)) : plan.monthly;
  const k = 1 - Math.min(90, Math.max(0, percent)) / 100;
  return { perMonth: round2(listPerMonth * k), total: round2(listTotal * k), listPerMonth, listTotal };
}

// Which plan unlocks each model, and each plan's default (its best model).
//   Free → GPT-OSS 20B · Pro → + Qwen 3.8 · Max → + GPT-OSS 120B
export const MODEL_PLAN = {
  'openai/gpt-oss-20b': 'free',
  'qwen/qwen3.8-27b': 'pro',
  'openai/gpt-oss-120b': 'max'
};
export const PLAN_DEFAULT_MODEL = { free: 'openai/gpt-oss-20b', pro: 'qwen/qwen3.8-27b', max: 'openai/gpt-oss-120b' };

export const minPlanForModel = key => MODEL_PLAN[key] ?? (/fast/.test(key) ? 'free' : 'max');
export const modelAllowed = (tier, key) => PLAN_ORDER.indexOf(tier) >= PLAN_ORDER.indexOf(minPlanForModel(key));

// Checkout links (Whop). Override with VITE_CHECKOUT_* in .env if they change.
// EUREKA adds ?onSuccess=… so Whop sends the student back with ?checkout=success&plan=…
export const CHECKOUT = {
  pro: {
    monthly: import.meta.env?.VITE_CHECKOUT_PRO_MONTHLY || 'https://whop.com/checkout/plan_VbdKDteONjAvL',
    yearly: import.meta.env?.VITE_CHECKOUT_PRO_YEARLY || 'https://whop.com/checkout/plan_P5x4nksgIGQsS'
  },
  max: {
    monthly: import.meta.env?.VITE_CHECKOUT_MAX_MONTHLY || 'https://whop.com/checkout/plan_T4rb2neFS9qdz',
    yearly: import.meta.env?.VITE_CHECKOUT_MAX_YEARLY || 'https://whop.com/checkout/plan_x1TBsQJ6buHF3'
  }
};

export function checkoutUrl(planId, billing, { email, code } = {}) {
  const link = CHECKOUT[planId]?.[billing];
  if (!link) return null;
  const url = new URL(link);
  const back = /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}?checkout=return&plan=${planId}&billing=${billing}` : '';
  if (/whop\.com$/.test(url.hostname)) {
    if (back) url.searchParams.set('onSuccess', back);
  } else {
    if (email) url.searchParams.set('prefilled_email', email);
    if (code) url.searchParams.set('prefilled_promo_code', code);
  }
  return url.toString();
}
