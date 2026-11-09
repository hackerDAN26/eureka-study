// Google sign-in with Google Identity Services (one button for both sign in and sign up).
//
// The OAuth client ID is public (it's visible in every Google sign-in button), so it's
// built in below. For sign-in to work, Google Cloud Console → APIs & Services →
// Credentials → this OAuth client → "Authorised JavaScript origins" must list every
// address EUREKA runs on, e.g. https://your-site.netlify.app and http://localhost:5173.
//
// After Google returns a credential, EUREKA's server verifies it with Google
// (/api/ai/auth) before the student is signed in.
export const DEFAULT_GOOGLE_CLIENT_ID = '931768065843-721uksotvjdh09s07bs51fo8rl0hmrfa.apps.googleusercontent.com';
const CLIENT_KEY = 'eureka.googleClientId';
const API = `${(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')}/api/ai`;
let loading = null;

export const getClientId = () => {
  try {
    const saved = localStorage.getItem(CLIENT_KEY);
    if (saved) return saved;
  } catch {}
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
};

export const setClientId = id => {
  try {
    if (id && id !== DEFAULT_GOOGLE_CLIENT_ID) localStorage.setItem(CLIENT_KEY, id);
    else localStorage.removeItem(CLIENT_KEY);
  } catch {}
};

export function signInBlocker() {
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  if (framed && !/\[native code\]/.test(Function.prototype.toString.call(window.fetch)))
    return 'Google sign-in can’t open inside this preview window. Open EUREKA from its website to sign in.';
  if (location.protocol === 'file:' || location.origin === 'null')
    return 'Google sign-in only works when EUREKA is served from its website or localhost (npm run dev), not opened as a file.';
  if (!getClientId()) return 'Google sign-in isn’t configured.';
  return '';
}

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve() : reject(new Error('Google sign-in didn’t load. Try again.')));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('Couldn’t load Google sign-in. Check your connection (or an ad/privacy blocker) and try again.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

const decodeJwt = token => {
  let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
};

// Ask EUREKA's server to verify the Google credential. If the site has no server
// (e.g. local static preview), fall back to reading the credential in the browser.
async function verify(credential) {
  let res;
  try {
    res = await fetch(`${API}/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
  } catch {
    res = null;
  }
  const isJson = res && /json/.test(res.headers.get('content-type') || '');
  if (isJson) {
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.user) return { ...data.user, verified: true, signedInAt: Date.now() };
    throw new Error(data.error?.message || 'Google sign-in couldn’t be verified. Please try again.');
  }
  const p = decodeJwt(credential);
  if (p.aud !== getClientId()) throw new Error('This Google sign-in was issued for a different app.');
  if (p.exp * 1000 < Date.now()) throw new Error('This Google sign-in has expired. Please try again.');
  console.warn('[auth] /api/ai/auth is unavailable — signed in without server verification.');
  return { id: p.sub, name: p.name || p.email, email: p.email, picture: p.picture, verified: false, signedInAt: Date.now() };
}

let current = { onUser: null, onError: null };

export async function renderGoogleButton(el, { text = 'continue_with', width = 260, onUser, onError }) {
  current = { onUser, onError };
  await loadGis();
  window.google.accounts.id.initialize({
    client_id: getClientId(),
    ux_mode: 'popup',
    auto_select: false,
    itp_support: true,
    callback: async ({ credential }) => {
      try {
        current.onUser?.(await verify(credential));
      } catch (e) {
        current.onError?.(e.message);
      }
    }
  });
  el.innerHTML = '';
  window.google.accounts.id.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text, width, logo_alignment: 'left' });
}

export function signOutGoogle() {
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {}
}
