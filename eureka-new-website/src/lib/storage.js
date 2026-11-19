// Everything persists in this browser's localStorage.
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const load = (k, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

export const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export const STATE_KEY = 'eureka.state.v2';
const USAGE_KEY = 'eureka.usage.v1';

export const newChat = (subject = 'General') => ({
  id: uid(),
  title: 'New conversation',
  subject,
  pinned: false,
  updatedAt: Date.now(),
  messages: []
});

export const newWorkspace = (name = 'My Workspace') => ({
  id: uid(),
  name,
  createdAt: Date.now(),
  members: [],
  chats: [newChat()],
  events: []
});

export function initialState() {
  const saved = load(STATE_KEY, null);
  if (saved?.version === 2 && saved.workspaces?.length) return saved;
  const ws = newWorkspace('My Workspace');
  const oldChats = load('eureka.studyChats.v1', []);
  if (oldChats?.length) ws.chats = oldChats;
  return {
    version: 2,
    activeWorkspaceId: ws.id,
    workspaces: [ws],
    user: null,
    plan: { tier: 'free', billing: 'monthly', since: Date.now() },
    prompts: [],
    settings: { browserNotifications: false, tutorInstructions: '' },
    dismissed: [],
    notified: [],
    welcomeSeen: false,
    profile: { courses: [], onboarded: false }
  };
}

// Only finished messages are saved.
export const persistable = state => ({
  ...state,
  workspaces: state.workspaces.map(w => ({ ...w, chats: w.chats.map(c => ({ ...c, messages: c.messages.filter(m => !m.pending) })) }))
});

const today = () => new Date().toLocaleDateString('en-CA');

export function getUsage() {
  const u = load(USAGE_KEY, null);
  return u?.date === today() ? u : { date: today(), messages: 0, web: 0 };
}

export function addUsage(kind) {
  const u = getUsage();
  u[kind] += 1;
  save(USAGE_KEY, u);
  return u;
}
