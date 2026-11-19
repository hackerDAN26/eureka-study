// Sharing a workspace: a compressed snapshot in a link, or a .eureka.json file.
const LINK_LIMIT = 1800; // keeps the invite link short enough for email apps

const toB64Url = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = s => {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
};
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export const snapshot = ws => ({
  eureka: 1,
  name: ws.name,
  chats: ws.chats.map(c => ({ ...c, messages: c.messages.filter(m => !m.pending && !m.error).map(({ apiText, ...m }) => m) })),
  events: ws.events
});

export async function encodeWorkspace(ws) {
  const raw = new TextEncoder().encode(JSON.stringify(snapshot(ws)));
  if (typeof CompressionStream === 'function') return `z.${toB64Url(await pipe(raw, new CompressionStream('deflate-raw')))}`;
  return `r.${toB64Url(raw)}`;
}

export async function decodeWorkspace(code) {
  const [kind, body] = [code.slice(0, 2), code.slice(2)];
  let bytes = fromB64Url(body);
  if (kind === 'z.') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return validate(JSON.parse(new TextDecoder().decode(bytes)));
}

const validate = data => {
  if (!data || data.eureka !== 1 || !Array.isArray(data.chats)) throw new Error('That isn’t a EUREKA workspace.');
  return data;
};

export const appUrl = () => (/^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}` : '');

// A link when it's short enough and EUREKA is hosted; otherwise null (use the file).
export async function shareLink(ws) {
  const base = appUrl();
  if (!base) return null;
  const link = `${base}#import=${await encodeWorkspace(ws)}`;
  return link.length <= LINK_LIMIT ? link : null;
}

export function downloadWorkspace(ws) {
  const file = `${ws.name.replace(/[^\w\- ]+/g, '').trim() || 'workspace'}.eureka.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(ws), null, 2)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: file }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return file;
}

export const readWorkspaceFile = async file => validate(JSON.parse(await file.text()));
