// Light / dark / system appearance.
// Light = the "Paper" design (data-theme="paper"); dark = EUREKA's original look (no data-theme).
// The choice is a display preference only, so it lives in this browser's storage.
// An inline script in index.html applies the same logic before the page paints, to avoid a flash.

export const APPEARANCE_KEY = 'eureka.appearance';
export const APPEARANCES = ['light', 'dark', 'system'];
const COLORS = { light: '#f6f7f2', dark: '#08140f' };
const query = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function getAppearance() {
  try {
    const v = localStorage.getItem(APPEARANCE_KEY);
    if (APPEARANCES.includes(v)) return v;
  } catch {
    /* storage blocked — fall through */
  }
  return 'system';
}

export function resolveAppearance(a = getAppearance()) {
  if (a === 'light' || a === 'dark') return a;
  return query()?.matches ? 'dark' : 'light';
}

export function applyAppearance(a = getAppearance()) {
  if (typeof document === 'undefined') return 'light';
  const mode = resolveAppearance(a);
  const root = document.documentElement;
  if (mode === 'light') root.dataset.theme = 'paper';
  else delete root.dataset.theme;
  root.style.colorScheme = mode;
  root.style.background = COLORS[mode];
  if (document.body) document.body.style.background = COLORS[mode];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[mode]);
  return mode;
}

export function setAppearance(a) {
  const value = APPEARANCES.includes(a) ? a : 'system';
  try {
    localStorage.setItem(APPEARANCE_KEY, value);
  } catch {
    /* storage blocked — still apply for this visit */
  }
  return applyAppearance(value);
}

// Calls cb(mode) when the device switches between light and dark.
export function watchSystemAppearance(cb) {
  const mq = query();
  if (!mq) return () => {};
  const on = () => cb(resolveAppearance());
  mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
  return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
}
