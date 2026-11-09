import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  Add01Icon,
  ArrowDown01Icon,
  Attachment01Icon,
  Atom01Icon,
  Book02Icon,
  BookOpen01Icon,
  BrainIcon,
  Briefcase01Icon,
  BubbleChatIcon,
  Calendar03Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  ClockIcon,
  CodeIcon,
  Copy01Icon,
  Delete02Icon,
  Dna01Icon,
  EarthIcon,
  File02Icon,
  FunctionIcon,
  Globe02Icon,
  Menu01Icon,
  Notification03Icon,
  PencilEdit02Icon,
  Pin02Icon,
  QuillWrite01Icon,
  Search01Icon,
  SidebarLeftIcon,
  StarIcon,
  TestTube01Icon,
  Tick02Icon,
  Target02Icon,
  Timer02Icon,
  UserGroupIcon
} from '@hugeicons/core-free-icons';
import PromptBar from './components/PromptBar';
import Hyperspeed from './components/Hyperspeed';
import BranchedMenu from './components/BranchedMenu';
import AccountMenu from './components/AccountMenu';
import { ActivateDialog, ConfirmDialog, ContactDialog, PlansDialog, RewardsDialog, SettingsDialog, ShareDialog } from './components/Dialogs';
import { C, Icon, LeafMark, Logo } from './components/ui';
import CalendarView from './views/CalendarView';
import StudyView from './views/StudyView';
import SessionRunner from './components/SessionRunner';
import Pomodoro from './components/Pomodoro';
import Legal from './views/Legal';
import { EFFORTS, IS_PREVIEW_BUILD, MODELS, SPEC_QUESTION, activatePlan, blockedPreview, discoverModels, runTask, setPlanAuth, streamChat } from './lib/ai';
import { buildRequest } from './lib/context';
import { emptyStudy, logEntry, recordAssessment, reschedule, studentModelText, ymd } from './lib/study';
import Onboarding from './components/Onboarding';
import { fileToPart, pickFiles } from './lib/files';
import { PLANS, PLAN_DEFAULT_MODEL, minPlanForModel, modelAllowed } from './lib/plans';
import { activeSeason, award, emptyRewards, EARN, loyaltyStatus, tierFor, timeLeft } from './lib/promos';
import { STATE_KEY, addUsage, getUsage, initialState, newChat, newWorkspace, persistable, save, uid } from './lib/storage';
import { deadlinesSummary, defaultReminders, dueOf, firedReminders, fmtDue, relative } from './lib/reminders';
import { decodeWorkspace } from './lib/share';
import { signOutGoogle } from './lib/auth';
import './App.css';
import './features.css';
import './study.css';

/* ── content ─────────────────────────────────────────────── */
// Icons for the subject menu, matched by subject name.
const SUBJECT_ICONS = [
  [/bio|life and health/i, Dna01Icon],
  [/chem/i, TestTube01Icon],
  [/phys(?!ical educ)|astronom|electron|science/i, Atom01Icon],
  [/math|statist|calcul|numera/i, FunctionIcon],
  [/comput|digital|software|information|\bict\b/i, CodeIcon],
  [/econ|account|commerce/i, ChartLineData01Icon],
  [/business|enterprise|management/i, Briefcase01Icon],
  [/hist/i, ClockIcon],
  [/geog|environment|marine|agricult|travel/i, EarthIcon],
  [/literat|english a/i, BookOpen01Icon],
  [/english|language|french|spanish|german|arabic|chinese|mandarin|welsh|irish|latin|urdu|hindi|gaelic|ab initio/i, QuillWrite01Icon],
  [/psych|socio|anthrop|philos|knowledge|politic|law|religio|islam/i, BrainIcon]
];
const iconFor = name => SUBJECT_ICONS.find(([re]) => re.test(name))?.[1] ?? Book02Icon;
const toApiCourse = c => (c ? { id: c.id ?? null, level: c.level ?? '', board: c.board ?? '', qualification: c.qualification ?? '', subject: c.subject } : null);

const SOURCES = [
  { key: 'files', name: 'Photos & files', description: 'PDF, DOCX, PPTX, notes, images', icon: Attachment01Icon, attach: true },
  { key: 'web', name: 'Web search', description: 'Live web results', icon: Globe02Icon }
];

const COMMANDS = [
  { key: 'teach', name: '/teach', description: 'Step-by-step lesson with check-ins', template: 'Teach me this topic step by step, checking my understanding as we go:' },
  { key: 'quiz', name: '/quiz', description: 'Exam-style questions, one at a time', template: 'Test my knowledge with exam-style questions, one at a time, and mark each answer:' },
  { key: 'explain', name: '/explain', description: 'Plain language with an analogy', template: 'Explain this simply, with an everyday analogy:' },
  { key: 'hard', name: '/hard', description: 'Difficult, top-grade questions', template: 'Generate difficult, top-grade exam questions (don’t give answers until I try) on:' },
  { key: 'weak', name: '/weak', description: 'Diagnose my weak areas', template: 'Ask me short diagnostic questions to find my weak areas in:' },
  { key: 'flashcards', name: '/flashcards', description: 'Front / back cards', template: 'Create flashcards as a two-column table (Front | Back) from:' },
  { key: 'plan', name: '/plan', description: 'A revision plan', template: 'Make me a realistic revision plan for:' },
  { key: 'hint', name: '/hint', description: 'A nudge, not the answer', template: 'Give me a hint only — not the answer — for:' },
  { key: 'planner', name: '/planner', description: 'Open the AI exam planner', template: '' },
  { key: 'spec', name: '/spec', description: 'What my specification says', template: 'Using my exam board’s official specification, tell me exactly what I need to know about:' }
];

const DEFAULT_PROMPTS = [
  'Plan revision for my upcoming deadlines',
  'Teach me this topic',
  'Test my knowledge',
  'Explain this simply',
  'Generate difficult questions',
  'Find my weak areas',
  'Create flashcards',
  'Make a revision plan',
  'Quiz me using my uploaded resources'
];

/* ── markdown ────────────────────────────────────────────── */
marked.setOptions({ gfm: true, breaks: true });
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});
const md = text => ({ __html: DOMPurify.sanitize(marked.parse(text || '')) });

/* ── dictation ───────────────────────────────────────────── */
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const dictate = () =>
  new Promise((resolve, reject) => {
    const rec = new Speech();
    rec.lang = navigator.language || 'en-GB';
    rec.interimResults = false;
    rec.onresult = e => resolve(e.results[0][0].transcript);
    rec.onerror = e => reject(e.error);
    rec.onend = () => resolve('');
    rec.start();
  });

/* ── revision: exams live in the calendar as Exam/Test events ── */
const examsFrom = (workspaces, courses, label) =>
  workspaces
    .flatMap(w => (w.events ?? []).filter(e => (e.type === 'Exam' || e.type === 'Test') && !e.done).map(e => ({ ...e, wsId: w.id })))
    .map(e => ({ id: e.id, wsId: e.wsId, title: e.title, date: e.date, paper: e.paper ?? e.description ?? '', topicIds: e.topicIds, courseKey: e.courseKey ?? courses.find(c => label(c) === e.subject)?.key }))
    .filter(e => e.courseKey);
const courseLabel = c => `${c.subject}${c.level ? ` ${c.level}` : ''}`;

/* ── routing ─────────────────────────────────────────────── */
const readRoute = () => {
  const h = location.hash.replace(/^#\/?/, '');
  return ['calendar', 'study', 'terms', 'privacy'].includes(h) ? h : 'chat';
};
function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
const go = r => {
  location.hash = `#/${r}`;
};

function Message({ msg, onAction }) {
  const [copied, setCopied] = useState(false);
  if (msg.role === 'user') {
    return (
      <div className="msg msg--user">
        {msg.files?.length ? (
          <div className="msg__files">
            {msg.files.map(f => (
              <span key={f} className="msg__file">
                <Icon icon={File02Icon} size={12} /> {f}
              </span>
            ))}
          </div>
        ) : null}
        {msg.text ? <div className="msg__bubble">{msg.text}</div> : null}
      </div>
    );
  }
  return (
    <div className={`msg msg--ai${msg.error ? ' msg--error' : ''}${msg.limit ? ' msg--limit' : ''}`}>
      <span className="msg__mark" aria-hidden="true">
        <LeafMark size={14} />
      </span>
      <div className="msg__body">
        {msg.pending && !msg.text ? (
          <div className="thinking">
            <i />
            <i />
            <i />
          </div>
        ) : (
          <div className="prose" dangerouslySetInnerHTML={md(msg.text)} />
        )}
        {msg.action ? (
          <button type="button" className="btn btn--sm msg__cta" onClick={() => onAction(msg.action)}>
            {msg.action === 'plans' ? 'See plans' : 'Open settings'}
          </button>
        ) : null}
        {msg.sources?.length ? (
          <div className="msg__sources">
            {msg.sources.slice(0, 6).map((s, i) => (
              <a key={s.uri} href={s.uri} target="_blank" rel="noopener noreferrer">
                <span>{i + 1}</span>
                {s.title}
              </a>
            ))}
          </div>
        ) : null}
        {!msg.pending && msg.text && !msg.error && !msg.limit ? (
          <div className="msg__tools">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(msg.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              <Icon icon={copied ? Tick02Icon : Copy01Icon} size={13} /> {copied ? 'Copied' : 'Copy'}
            </button>
            {msg.model ? <span className="msg__meta">{msg.model}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── workspace switcher ──────────────────────────────────── */
function WorkspaceSwitcher({ workspaces, active, onSwitch, onCreate, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = e => !root.current?.contains(e.target) && !e.target.closest?.('.dialog') && setOpen(false);
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [open]);

  return (
    <div className="ws" ref={root}>
      <button type="button" className="ws__trigger" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="ws__glyph">{active.name.slice(0, 1).toUpperCase()}</span>
        <span className="ws__name">
          <strong>{active.name}</strong>
          <span>
            {active.members?.length ? `${active.members.length + 1} members` : 'Private'} · {active.chats.length} chat{active.chats.length === 1 ? '' : 's'}
          </span>
        </span>
        <Icon icon={ArrowDown01Icon} size={13} stroke={2.2} />
      </button>
      {open ? (
        <div className="ws__menu" role="menu">
          <div className="side-label">Workspaces</div>
          {workspaces.map(w => (
            <div key={w.id} className="ws__row" data-active={w.id === active.id ? '' : undefined}>
              {renaming === w.id ? (
                <input
                  className="chat-row__rename"
                  defaultValue={w.name}
                  autoFocus
                  maxLength={60}
                  onBlur={e => {
                    onRename(w.id, e.target.value.trim() || w.name);
                    setRenaming(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="ws__pick"
                  onClick={() => {
                    onSwitch(w.id);
                    setOpen(false);
                  }}
                  onDoubleClick={() => setRenaming(w.id)}
                >
                  <span className="ws__glyph ws__glyph--sm">{w.name.slice(0, 1).toUpperCase()}</span>
                  <span className="ws__row-name">{w.name}</span>
                  {w.members?.length ? <Icon icon={UserGroupIcon} size={12} /> : null}
                  {w.id === active.id ? <Icon icon={Tick02Icon} size={13} stroke={2.4} /> : null}
                </button>
              )}
              <span className="chat-row__actions">
                <button type="button" title="Rename" onClick={() => setRenaming(w.id)}>
                  <Icon icon={PencilEdit02Icon} size={13} />
                </button>
                <button type="button" title="Delete" onClick={() => onDelete(w)}>
                  <Icon icon={Delete02Icon} size={13} />
                </button>
              </span>
            </div>
          ))}
          <button
            type="button"
            className="ws__new"
            onClick={() => {
              const id = onCreate();
              if (id) setRenaming(id);
            }}
          >
            <Icon icon={Add01Icon} size={14} stroke={2.2} /> New workspace
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── notifications bell ──────────────────────────────────── */
function Bell({ items, now, browserOn, onToggleBrowser, onDismiss, onOpen }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = e => !root.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [open]);
  return (
    <div className="bell" ref={root}>
      <button type="button" className="icon-btn bell__btn" aria-label={`Notifications (${items.length})`} onClick={() => setOpen(v => !v)}>
        <Icon icon={Notification03Icon} />
        {items.length ? <span className="bell__count">{items.length}</span> : null}
      </button>
      {open ? (
        <div className="bell__pop" role="dialog" aria-label="Notifications">
          <div className="bell__head">
            <strong>Reminders</strong>
            {items.length ? (
              <button type="button" className="link-btn" onClick={() => items.forEach(i => onDismiss(i.id))}>
                Clear all
              </button>
            ) : null}
          </div>
          {items.length === 0 ? <p className="bell__empty">You’re all caught up. Reminders for your deadlines show up here.</p> : null}
          {items.map(i => (
            <div key={i.id} className="note" data-priority={i.event.priority}>
              <button
                type="button"
                className="note__body"
                onClick={() => {
                  setOpen(false);
                  onOpen(i.workspace.id);
                }}
              >
                <span className="note__title">
                  {i.event.type}: {i.event.title}
                </span>
                <span className="note__meta">
                  {relative(dueOf(i.event), now)} · {fmtDue(i.event)}
                  {i.workspace ? ` · ${i.workspace.name}` : ''}
                </span>
              </button>
              <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => onDismiss(i.id)}>
                <Icon icon={Cancel01Icon} size={13} />
              </button>
            </div>
          ))}
          <label className="bell__toggle">
            <input type="checkbox" checked={browserOn} onChange={e => onToggleBrowser(e.target.checked)} />
            <span>
              Desktop notifications
              <em>Shown while EUREKA is open. For reminders when it’s closed, use “Add to my calendar app”.</em>
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

/* ── app ─────────────────────────────────────────────────── */
export default function App() {
  const [state, setState] = useState(initialState);
  const route = useRoute();
  const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId) ?? state.workspaces[0];
  const tier = state.plan.tier;
  const baseLimits = PLANS[tier].limits;

  const [activeChatId, setActiveChatId] = useState(null);
  const chat = ws.chats.find(c => c.id === activeChatId) ?? ws.chats[0];
  const isEmpty = chat.messages.length === 0;

  /* the student's own courses (from onboarding) */
  const profile = state.profile ?? { courses: [], onboarded: false };
  const courses = profile.courses;
  const courseByKey = useMemo(() => new Map(courses.map(c => [c.key, c])), [courses]);
  const subjectLabel = (key, fallback) => {
    const c = courseByKey.get(key);
    if (!c) return fallback || key || 'General';
    const dupe = courses.some(o => o !== c && o.subject === c.subject && o.qualification === c.qualification);
    return `${c.subject}${c.level ? ` ${c.level}` : ''}${dupe ? ` · ${c.board}` : ''}`;
  };
  const subjectLong = key => {
    const c = courseByKey.get(key);
    return c ? [/^IB/.test(c.qualification) ? '' : c.board, c.qualification, `${c.subject}${c.level ? ` ${c.level}` : ''}`].filter(Boolean).join(' · ') : subjectLabel(key, chat.subjectName);
  };
  const subjectItems = useMemo(() => {
    const groups = new Map();
    for (const c of courses) {
      const g = c.qualification || 'My subjects';
      groups.set(g, [...(groups.get(g) ?? []), c]);
    }
    return [
      { label: 'General', value: 'General' },
      ...[...groups].map(([label, list]) => ({
        label,
        children: list.map(c => ({
          value: c.key,
          label: `${c.subject}${c.level ? ` ${c.level}` : ''}${list.some(o => o !== c && o.subject === c.subject) ? ` · ${c.board}` : ''}`,
          icon: iconFor(c.subject)
        }))
      }))
    ];
  }, [courses]);
  const chatLabel = subjectLabel(chat.subject, chat.subjectName);
  const [subjectsOpen, setSubjectsOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState(MODELS);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900);
  const [accountOpen, setAccountOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // 'plans' | 'share' | 'contact' | 'settings' | {confirm} | {activate}

  /* paid plans: verified by the server from a Whop license key */
  setPlanAuth({ token: state.planPass?.token, preview: import.meta.env.DEV ? state.plan.tier : '' });
  const applyPass = useCallback(
    pass =>
      setState(s => ({
        ...s,
        hasPaid: true,
        planPass: { token: pass.token, tier: pass.tier, billing: pass.billing, until: pass.until, licenseKey: pass.licenseKey ?? s.planPass?.licenseKey },
        plan: { tier: pass.tier, billing: pass.billing, since: s.plan.tier === pass.tier ? s.plan.since : Date.now() }
      })),
    []
  );
  const dropToFree = useCallback(
    (message, keepKey = true) => {
      setState(s => ({ ...s, planPass: keepKey && s.planPass?.licenseKey ? { licenseKey: s.planPass.licenseKey } : null, plan: { tier: 'free', billing: 'monthly', since: Date.now() } }));
      if (message) setToast(message);
    },
    []
  );
  useEffect(() => {
    if (import.meta.env.DEV || IS_PREVIEW_BUILD) return; // the owner previews plans from Settings when running npm run dev
    const pass = state.planPass;
    const fresh = pass?.token && pass.until > Date.now() + 2 * 86400e3;
    if (fresh) {
      if (state.plan.tier !== pass.tier) applyPass(pass);
      return;
    }
    if (pass?.licenseKey) {
      activatePlan(pass.licenseKey)
        .then(p => applyPass({ ...p, licenseKey: pass.licenseKey }))
        .catch(e => {
          if (['license_inactive', 'license_invalid', 'license_other'].includes(e.kind)) dropToFree(`${e.message} You’re on the Free plan for now.`);
          else if (!pass.token || pass.until <= Date.now()) dropToFree('We couldn’t re-check your plan with Whop, so you’re on Free for now. It switches back once the check works — or use Activate a purchase.');
        });
      return;
    }
    if (state.plan.tier !== 'free') dropToFree('Please activate your plan with the license key from your Whop receipt (account menu → Activate a purchase).', false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [toast, setToast] = useState('');
  const [usage, setUsage] = useState(getUsage);
  const [now, setNow] = useState(() => Date.now());

  /* sales, bonuses and rewards change what each plan includes */
  const season = activeSeason(now);
  const rewardTier = tierFor(state.rewards?.points ?? 0);
  const limits = useMemo(() => {
    const boost = season?.bonus.type === 'messages' ? season.bonus.boost : 0;
    return {
      ...baseLimits,
      messagesPerDay: Math.round(baseLimits.messagesPerDay * (1 + boost)) + rewardTier.messages,
      customPrompts: baseLimits.customPrompts + rewardTier.prompts
    };
  }, [baseLimits, season?.id, rewardTier.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [previewBlocked, setPreviewBlocked] = useState(blockedPreview);

  const controller = useRef(null);
  const pending = useRef(new Map());
  const resources = useRef(new Map());
  const scroller = useRef(null);
  const settings = useRef({ model: MODELS.find(m => m.key === PLAN_DEFAULT_MODEL[state.plan.tier]) ?? MODELS[1], effort: 'Low' });

  // Switching plan selects that plan's best model.
  useEffect(() => {
    settings.current = { ...settings.current, model: MODELS.find(m => m.key === PLAN_DEFAULT_MODEL[tier]) ?? MODELS[1] };
  }, [tier]);

  /* persistence & timers */
  useEffect(() => save(STATE_KEY, persistable(state)), [state]);
  useEffect(() => {
    discoverModels().then(setModels);
    const t = setInterval(() => {
      setNow(Date.now());
      setUsage(getUsage());
    }, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), toast.length > 90 ? 7000 : 3600);
    return () => clearTimeout(t);
  }, [toast]);

  const update = useCallback(fn => setState(s => fn(s)), []);
  const patchWs = useCallback((id, fn) => setState(s => ({ ...s, workspaces: s.workspaces.map(w => (w.id === id ? fn(w) : w)) })), []);
  const patchChat = useCallback((wsId, chatId, fn) => patchWs(wsId, w => ({ ...w, chats: w.chats.map(c => (c.id === chatId ? fn(c) : c)) })), [patchWs]);

  /* the bottom-left sign-in pop on first visit */
  useEffect(() => {
    if (state.user || state.welcomeSeen || !state.profile?.onboarded) return undefined;
    const t = setTimeout(() => {
      setAccountOpen(true);
      update(s => ({ ...s, welcomeSeen: true }));
    }, 1200);
    return () => clearTimeout(t);
  }, [state.user, state.welcomeSeen, state.profile?.onboarded, update]);

  /* shared-workspace links and checkout returns */
  const stateRef = useRef(state);
  stateRef.current = state;
  const importWorkspace = useCallback(data => {
    const s0 = stateRef.current;
    if (s0.workspaces.length >= PLANS[s0.plan.tier].limits.workspaces) {
      setToast('Your plan’s workspace limit is reached — upgrade or delete a workspace to import this one.');
      setDialog('plans');
      return;
    }
    const w = {
      ...newWorkspace(`${data.name} (shared)`),
      chats: data.chats.length ? data.chats.map(c => ({ ...c, id: uid() })) : [newChat()],
      events: (data.events ?? []).map(e => ({ ...e, id: uid() }))
    };
    setState(s => ({ ...s, workspaces: [...s.workspaces, w], activeWorkspaceId: w.id }));
    setActiveChatId(null);
    setToast(`Imported “${data.name}”.`);
  }, []);

  useEffect(() => {
    const m = location.hash.match(/^#import=(.+)$/);
    if (m) {
      decodeWorkspace(m[1])
        .then(data => setDialog({ confirm: { title: `Import “${data.name}”?`, body: `Someone shared a EUREKA workspace with ${data.chats.length} chats and ${(data.events ?? []).length} deadlines. Add it to your workspaces?`, confirm: 'Import', danger: false, onConfirm: () => importWorkspace(data) } }))
        .catch(() => setToast('That share link is incomplete or damaged.'));
      history.replaceState(null, '', location.pathname + location.search + '#/chat');
    }
    const q = new URLSearchParams(location.search);
    // Back from Whop checkout: plans are only switched on by a verified license key, never by the URL.
    if (q.get('checkout')) {
      setDialog({ activate: { returning: true } });
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }, [importWorkspace]);

  /* reminders */
  const reminders = useMemo(() => firedReminders(state.workspaces, now, state.dismissed), [state.workspaces, now, state.dismissed]);
  useEffect(() => {
    if (!state.settings.browserNotifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const fresh = reminders.filter(r => !state.notified.includes(r.id));
    if (!fresh.length) return;
    for (const r of fresh) {
      try {
        new Notification(`${r.event.type}: ${r.event.title}`, { body: `${relative(dueOf(r.event), now)} · ${fmtDue(r.event)}`, tag: r.id, icon: './favicon.svg' });
      } catch {}
    }
    update(s => ({ ...s, notified: [...s.notified, ...fresh.map(r => r.id)].slice(-500) }));
  }, [reminders, state.settings.browserNotifications, state.notified, now, update]);

  /* Leaves */
  const reward = useCallback(kind => setState(s => {
    const { rewards, added } = award(s.rewards ?? emptyRewards(), kind);
    return added ? { ...s, rewards } : s;
  }), []);
  const lastTier = useRef(rewardTier.id);
  useEffect(() => {
    if (lastTier.current !== rewardTier.id && (state.rewards?.points ?? 0) > 0) setToast(`You reached ${rewardTier.name}! New perks are unlocked — see Rewards.`);
    lastTier.current = rewardTier.id;
  }, [rewardTier.id, rewardTier.name, state.rewards?.points]);
  // First visit (for the welcome offer) and monthly Leaves for subscribers.
  useEffect(() => {
    if (!state.firstSeen) update(s => ({ ...s, firstSeen: Date.now() }));
  }, [state.firstSeen, update]);
  const paidMonths = loyaltyStatus(state.plan, now).months;
  useEffect(() => {
    const given = state.rewards?.paidMonthsAwarded ?? 0;
    if (paidMonths <= given) return;
    setState(s => {
      let r = s.rewards ?? emptyRewards();
      for (let i = r.paidMonthsAwarded ?? 0; i < paidMonths; i++) r = award(r, 'paidMonth').rewards;
      return { ...s, rewards: { ...r, paidMonthsAwarded: paidMonths } };
    });
  }, [paidMonths, state.rewards?.paidMonthsAwarded]);

  const toggleBrowser = async on => {
    if (on) {
      if (typeof Notification === 'undefined') return setToast('This browser doesn’t support notifications.');
      const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission().catch(() => 'denied');
      if (p !== 'granted') return setToast('Notifications are blocked for this site — allow them in your browser’s site settings.');
    }
    update(s => ({ ...s, settings: { ...s.settings, browserNotifications: on } }));
  };

  /* scroll */
  const lastText = chat.messages.at(-1)?.text;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 220) el.scrollTo({ top: el.scrollHeight });
  }, [lastText, chat.messages.length, route]);

  /* ── chat ── */
  const totalChats = state.workspaces.reduce((n, w) => n + w.chats.filter(c => c.messages.length).length, 0);
  const pickerModels = useMemo(
    () => models.map(m => (modelAllowed(tier, m.key) ? (m.available === false ? { ...m, tag: `${m.tag} · not on key` } : m) : { ...m, tag: `${PLANS[minPlanForModel(m.key)].name} plan` })),
    [models, tier]
  );
  const efforts = EFFORTS.slice(0, limits.efforts);

  // Conversation + relevant study-material excerpts for one request (src/lib/context.js).
  // The server then fits it to the model's token budget (server/context.js).
  const buildHistory = (c, outgoing) => buildRequest([...c.messages, outgoing], outgoing, resources.current.get(c.id) ?? new Map());

  const send = async (raw, { attachments = [], model, effort, title: forcedTitle } = {}) => {
    if (busy) return;
    const w = ws;
    const c = chat;
    settings.current = { model: model ?? settings.current.model, effort: effort ?? settings.current.effort };
    model = settings.current.model;
    effort = efforts.includes(settings.current.effort) ? settings.current.effort : efforts.at(-1);

    const webSearch = /@Web search\b/i.test(raw);
    const userMsg = { id: uid(), role: 'user', text: raw, files: attachments };
    const title = c.messages.length === 0 && forcedTitle ? forcedTitle.slice(0, 46) : c.messages.length === 0 ? (raw.replace(/@(Web search|Photos & files)\b/gi, '').trim() || attachments[0] || 'New conversation').replace(/^\/\w+\s*/, '').slice(0, 46) || 'New conversation' : c.title;

    // plan limits — keep the student's message and explain in the thread
    const u = getUsage();
    let block = null;
    if (c.messages.length === 0 && totalChats >= limits.savedChats) block = `You’ve reached **${limits.savedChats} saved conversations** on ${PLANS[tier].name}. Delete an old chat or upgrade to keep going.`;
    else if (u.messages >= limits.messagesPerDay) block = `You’ve used today’s **${limits.messagesPerDay} AI messages** on ${PLANS[tier].name}. Your allowance resets at midnight — or upgrade for more.`;
    else if (webSearch && u.web >= limits.webPerDay) block = `You’ve used today’s **${limits.webPerDay} web searches** on ${PLANS[tier].name}. Send without @Web search, or upgrade for more.`;
    else if (!modelAllowed(tier, model?.key ?? '')) block = `**${model.name}** is part of the ${PLANS[minPlanForModel(model.key)].name} plan. Pick another model in the menu, or upgrade.`;
    if (block) {
      patchChat(w.id, c.id, x => ({ ...x, title, updatedAt: Date.now(), messages: [...x.messages, userMsg, { id: uid(), role: 'model', text: block, limit: true, action: 'plans' }] }));
      return;
    }

    const bucket = resources.current.get(c.id) ?? new Map();
    for (const name of attachments) {
      const rec = pending.current.get(name);
      if (rec) bucket.set(name, rec);
      pending.current.delete(name);
    }
    resources.current.set(c.id, bucket);

    let apiText = raw.replace(/@Web search\b/gi, '').replace(/@Photos & files\b/gi, '').trim();
    const cmd = COMMANDS.find(k => apiText === k.name || apiText.startsWith(`${k.name} `));
    if (cmd?.key === 'planner') {
      setStudyTab('today');
      setPlanner(true);
      go('study');
      return;
    }
    if (cmd) {
      const rest = apiText.slice(cmd.name.length).trim();
      apiText = `${cmd.template} ${rest || (attachments.length ? 'the attached resource(s)' : `a key topic in ${subjectLabel(c.subject, c.subjectName)} — ask me which one first`)}`;
    }
    if (webSearch) apiText += '\n\n(Use web search for current, citable information.)';
    // Spec questions look up the official specification (counts as a web search).
    const course = courseByKey.get(c.subject) ?? null;
    const specLookup = Boolean(course) && (cmd?.key === 'spec' || SPEC_QUESTION.test(raw)) && getUsage().web < limits.webPerDay;
    userMsg.apiText = apiText;

    const aiMsg = { id: uid(), role: 'model', text: '', pending: true, model: model?.name };
    const { history: historyParts, materials } = buildHistory(c, userMsg);
    patchChat(w.id, c.id, x => ({ ...x, title, updatedAt: Date.now(), messages: [...x.messages, userMsg, aiMsg] }));
    addUsage('messages');
    if (webSearch || specLookup) addUsage('web');
    setUsage(getUsage());
    setBusy(true);
    controller.current = new AbortController();

    let frame = 0;
    let latest = '';
    const flush = () => {
      frame = 0;
      patchChat(w.id, c.id, x => ({ ...x, messages: x.messages.map(m => (m.id === aiMsg.id ? { ...m, text: latest } : m)) }));
    };

    // One automatic retry when the AI is briefly rate-limited (the wait comes from Groq).
    const waitThenRetry = async err => {
      const secs = Math.min(30, Math.max(3, Math.ceil(err.retryAfter ?? 8)));
      for (let left = secs; left > 0; left--) {
        patchChat(w.id, c.id, x => ({ ...x, messages: x.messages.map(m => (m.id === aiMsg.id ? { ...m, text: `_Lots of students are studying right now — EUREKA will try again in ${left} second${left === 1 ? '' : 's'}…_` } : m)) }));
        await new Promise(r => setTimeout(r, 1000));
        if (controller.current?.signal.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
      }
      patchChat(w.id, c.id, x => ({ ...x, messages: x.messages.map(m => (m.id === aiMsg.id ? { ...m, text: '' } : m)) }));
    };
    const ask = () =>
      streamChat({
        model: model?.key ?? MODELS[0].key,
        effort,
        subject: c.subject === 'General' ? '' : subjectLabel(c.subject, c.subjectName),
        course: toApiCourse(course),
        courses: courses.map(toApiCourse),
        specLookup,
        deadlines: deadlinesSummary(w.events ?? []),
        customInstructions: limits.customTutor ? state.settings.tutorInstructions : '',
        studentModel: studentModelText({ ...study, activeSession: study.activeSession ? { stepName: study.activeSession.session.blocks[study.activeSession.step]?.activity } : null }, courses, c.subject),
        history: historyParts,
        materials,
        webSearch,
        signal: controller.current.signal,
        onText: t => {
          latest = t;
          if (!frame) frame = requestAnimationFrame(flush);
        }
      });

    try {
      let result;
      try {
        result = await ask();
      } catch (err) {
        const shortWait = (err?.kind === 'quota' || err?.kind === 'rate_limited') && (err.retryAfter == null || err.retryAfter <= 30) && !latest;
        if (!shortWait) throw err;
        await waitThenRetry(err);
        result = await ask();
      }
      const { text, sources, signature, model: usedModel, fellBackFrom, fallbackReason, searchDropped, serverPlan } = result;
      cancelAnimationFrame(frame);
      if (text) reward('message');
      const nameOf = k => models.find(x2 => x2.key === k)?.name ?? k;
      const why = {
        quota: 'its rate or spending limit was reached',
        forbidden: 'this API key isn’t allowed to use it',
        no_credits: 'the Groq account needs billing',
        model_unavailable: 'Groq doesn’t offer it to this key',
        vision: 'it can’t read images',
        search: 'it can’t search the web',
        unavailable: 'it’s temporarily down',
        bad_request: 'it rejected the request'
      }[fallbackReason];
      // The server is the source of truth for the plan.
      if (!import.meta.env.DEV && serverPlan && serverPlan !== state.plan.tier && PLANS[serverPlan]) {
        if (serverPlan === 'free') dropToFree('Your plan couldn’t be verified, so you’re on Free. Use account menu → Activate a purchase with your Whop license key.');
        else update(s => ({ ...s, plan: { ...s.plan, tier: serverPlan } }));
      }
      if (fellBackFrom && fallbackReason === 'plan' && !(serverPlan === 'free' && state.plan.tier !== 'free'))
        setToast(`${nameOf(fellBackFrom)} isn’t included in your plan, so ${nameOf(usedModel)} answered.`);
      else if (fellBackFrom && (fallbackReason === 'vision' || fallbackReason === 'search'))
        setToast(`${nameOf(fellBackFrom)} ${fallbackReason === 'vision' ? 'can’t read images' : 'can’t search the web'}, so ${nameOf(usedModel)} answered this one.`);
      else if (fellBackFrom)
        setToast(`${nameOf(fellBackFrom)} couldn’t answer${why ? ` (${why})` : ''} — answered with ${nameOf(usedModel)} instead.${import.meta.env.DEV ? ' Settings → Test all models shows details.' : ''}`);
      else if (searchDropped) setToast('Web search wasn’t available for this request, so this answer was written without it.');
      patchChat(w.id, c.id, x => ({
        ...x,
        messages: x.messages.map(m =>
          m.id === aiMsg.id
            ? {
                ...m,
                text: text || '_No response — try rephrasing._',
                sources,
                sig: signature || undefined,
                model: models.find(x2 => x2.key === usedModel)?.name ?? usedModel ?? m.model,
                pending: false
              }
            : m
        )
      }));
    } catch (err) {
      cancelAnimationFrame(frame);
      const aborted = err?.name === 'AbortError';
      patchChat(w.id, c.id, x => ({
        ...x,
        messages: x.messages.map(m =>
          m.id === aiMsg.id
            ? aborted
              ? { ...m, text: (latest ? `${latest}\n\n` : '') + '_Stopped._', pending: false }
              : { ...m, text: `**${err.title || 'Couldn’t reach the AI.'}** ${err.message || err}`, error: true, pending: false }
            : m
        )
      }));
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };

  const attach = async () => {
    const files = await pickFiles();
    const names = [];
    for (const file of files) {
      if (pending.current.size >= limits.filesPerMessage) {
        setToast(`${PLANS[tier].name} allows ${limits.filesPerMessage} sources per message.`);
        break;
      }
      try {
        const rec = await fileToPart(file, limits.fileMB);
        let label = rec.label;
        let n = 2;
        while (pending.current.has(label)) label = `${rec.label} (${n++})`;
        pending.current.set(label, rec);
        names.push(label);
      } catch (e) {
        setToast(e.message);
      }
    }
    return names;
  };

  /* ── revision system ── */
  const study = useMemo(() => ({ ...emptyStudy(), ...(state.study ?? {}) }), [state.study]);
  const exams = useMemo(() => examsFrom(state.workspaces, courses, courseLabel), [state.workspaces, courses]);
  const [studyTab, setStudyTabRaw] = useState('today');
  const [practiceTarget, setPracticeTarget] = useState(null);
  const [planner, setPlanner] = useState(false);
  const setStudyTab = (t, target) => {
    setStudyTabRaw(t);
    if (target) setPracticeTarget(target);
  };
  // Every change to the student model can rebuild the plan: 'stable' keeps today as it is,
  // 'full' replans from today, 'force' builds a plan even if none exists yet.
  const patchStudy = useCallback(
    (fn, { replan = false } = {}) =>
      setState(s => {
        let st = fn({ ...emptyStudy(), ...(s.study ?? {}) });
        if (replan && (st.plan || replan === 'force')) {
          const cs = s.profile?.courses ?? [];
          const r = reschedule(st, { courses: cs, topicsByCourse: st.topics, exams: examsFrom(s.workspaces, cs, courseLabel) }, ymd(Date.now()), { stableToday: replan === 'stable' });
          st = { ...st, plan: r.plan };
        }
        return { ...s, study: st };
      }),
    []
  );
  // Structured AI tasks count as AI messages.
  const runAiTask = async (kind, courseKey, input) => {
    const u = getUsage();
    if (u.messages >= limits.messagesPerDay) throw new Error(`You’ve used today’s ${limits.messagesPerDay} AI messages on ${PLANS[tier].name}. Upgrade or come back tomorrow.`);
    addUsage('messages');
    setUsage(getUsage());
    const course = courseByKey.get(courseKey) ?? null;
    try {
      return await runTask(kind, {
        model: PLAN_DEFAULT_MODEL[tier],
        course: toApiCourse(course),
        studentModel: studentModelText(study, courses, courseKey),
        input
      });
    } catch (e) {
      throw new Error(e?.message || 'The AI couldn’t do that just now. Please try again.');
    }
  };
  const addExam = ({ courseKey, title, date, paper }) =>
    patchWs(ws.id, w => ({
      ...w,
      events: [
        ...(w.events ?? []),
        { id: uid(), title, type: 'Exam', subject: subjectLabel(courseKey), courseKey, paper, date, time: '09:00', priority: 'high', description: paper, done: false, reminders: defaultReminders('Exam') }
      ]
    }));
  const removeExam = e => patchWs(e.wsId, w => ({ ...w, events: (w.events ?? []).filter(x => x.id !== e.id) }));
  const onGrade = (key, field, value) => update(s => ({ ...s, profile: { ...s.profile, courses: s.profile.courses.map(c => (c.key === key ? { ...c, [field]: value } : c)) } }));

  // Ask the tutor from anywhere in Study: open (or make) a chat for that subject, then send.
  const [queued, setQueued] = useState(null);
  const askTutor = (courseKey, text, title) => {
    const key = courseKey && courseByKey.has(courseKey) ? courseKey : 'General';
    const existing = ws.chats.find(c => c.subject === key && c.messages.length === 0);
    const target = existing ?? { ...newChat(key), subjectName: courseByKey.get(key)?.subject };
    if (!existing) patchWs(ws.id, w => ({ ...w, chats: [target, ...w.chats] }));
    setActiveChatId(target.id);
    setQueued({ chatId: target.id, text, title });
    go('chat');
  };
  useEffect(() => {
    if (queued && chat.id === queued.chatId && !busy) {
      setQueued(null);
      send(queued.text, { title: queued.title });
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const startSession = sess => {
    patchStudy(st => ({ ...st, activeSession: { session: sess, step: 0, spent: [], runningSince: null, min: false, startedAt: Date.now() } }));
  };
  const patchRun = fn => patchStudy(st => (st.activeSession ? { ...st, activeSession: fn(st.activeSession) } : st));
  const finishSession = (ratings, spent) => {
    const run = study.activeSession;
    const sess = run.session;
    const today = ymd(Date.now());
    patchStudy(
      st => {
        const list = st.topics?.[sess.courseKey] ?? [];
        const per = sess.topicIds.length || 1;
        const minutesTotal = Math.max(1, Math.round(spent.reduce((a, b) => a + (b ?? 0), 0) / 60));
        const topics = { ...st.topics, [sess.courseKey]: list.map(t => (ratings[t.id] ? recordAssessment(t, (ratings[t.id] - 1) / 4, { source: 'self', minutes: minutesTotal / per, today }) : t)) };
        const blockLogs = sess.blocks.map((b, i) => logEntry({ type: 'session', courseKey: sess.courseKey, topicId: sess.topicIds[0], activity: b.activity, minutes: Math.round((spent[i] ?? 0) / 60) })).filter(l => l.minutes > 0);
        const sessions = (st.plan?.sessions ?? []).map(x => (x.id === sess.id ? { ...x, status: 'done', actualMinutes: minutesTotal } : x));
        topics[sess.courseKey] = topics[sess.courseKey].map(t => (sess.topicIds.includes(t.id) ? { ...t, stats: { ...t.stats, sessions: t.stats.sessions + 1 } } : t));
        return { ...st, topics, activeSession: null, plan: st.plan ? { ...st.plan, sessions } : st.plan, log: [...st.log, ...blockLogs].slice(-3000) };
      },
      { replan: 'stable' }
    );
    reward('session');
    setToast('Session complete — your plan, reviews and ratings have been updated.');
  };

  // Pomodoro focus timer (survives navigation and reloads).
  const [timerOpen, setTimerOpen] = useState(false);
  const timer = useMemo(() => {
    const t = { phase: 'focus', cycle: 1, endsAt: null, left: null, ...(study.timer ?? {}) };
    // Timers saved before sets had an end could be on "block 7 of 4".
    if (t.cycle > study.focus.cycles) t.cycle = study.focus.cycles;
    if (!['focus', 'short', 'long', 'done'].includes(t.phase)) t.phase = 'focus';
    return t;
  }, [study.timer, study.focus.cycles]);
  const todayFocus = study.log.filter(l => l.type === 'focus' && ymd(l.at) === ymd(now)).reduce((a, l) => a + l.minutes, 0);
  const startFocus = ({ label, courseKey, topicId } = {}) => {
    patchStudy(st => ({ ...st, timer: { ...(st.timer ?? { phase: 'focus', cycle: 1 }), label: label ?? st.timer?.label, courseKey, topicId } }));
    setTimerOpen(true);
  };
  const notify = text => {
    if (state.settings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('EUREKA focus timer', { body: text, icon: './favicon.svg' });
        return;
      } catch {}
    }
    setToast(text);
  };

  const startChat = () => {
    go('chat');
    if (isEmpty) return;
    const c = { ...newChat(chat.subject), subjectName: chat.subjectName };
    patchWs(ws.id, w => ({ ...w, chats: [c, ...w.chats] }));
    setActiveChatId(c.id);
    if (window.innerWidth <= 900) setSidebar(false);
  };

  const removeChat = id => {
    patchWs(ws.id, w => {
      const chats = w.chats.filter(c => c.id !== id);
      return { ...w, chats: chats.length ? chats : [newChat()] };
    });
    resources.current.delete(id);
    if (id === chat.id) setActiveChatId(null);
  };

  /* ── workspaces ── */
  const createWorkspace = () => {
    if (state.workspaces.length >= limits.workspaces) {
      setToast(`${PLANS[tier].name} includes ${limits.workspaces} workspace${limits.workspaces > 1 ? 's' : ''}.`);
      setDialog('plans');
      return null;
    }
    const w = newWorkspace(`Workspace ${state.workspaces.length + 1}`);
    update(s => ({ ...s, workspaces: [...s.workspaces, w], activeWorkspaceId: w.id }));
    setActiveChatId(null);
    return w.id;
  };

  const deleteWorkspace = w =>
    setDialog({
      confirm: {
        title: `Delete “${w.name}”?`,
        body: `This permanently deletes its ${w.chats.length} chat${w.chats.length === 1 ? '' : 's'} and ${w.events.length} deadline${w.events.length === 1 ? '' : 's'} from this browser. People you invited keep their own copies.`,
        onConfirm: () => {
          update(s => {
            let list = s.workspaces.filter(x => x.id !== w.id);
            if (!list.length) list = [newWorkspace('My Workspace')];
            return { ...s, workspaces: list, activeWorkspaceId: s.activeWorkspaceId === w.id ? list[0].id : s.activeWorkspaceId };
          });
          setActiveChatId(null);
          setToast(`Deleted “${w.name}”.`);
        }
      }
    });

  const deleteAll = () =>
    setDialog({
      confirm: {
        title: 'Delete all EUREKA data?',
        body: 'This removes every workspace, chat, deadline, saved prompt, setting, API key and sign-in from this browser. It can’t be undone.',
        confirm: 'Delete everything',
        onConfirm: () => {
          try {
            Object.keys(localStorage)
              .filter(k => k.startsWith('eureka.'))
              .forEach(k => localStorage.removeItem(k));
          } catch {}
          signOutGoogle();
          location.hash = '#/chat';
          location.reload();
        }
      }
    });

  /* ── sidebar lists ── */
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = ws.chats.filter(
      c => !q || c.title.toLowerCase().includes(q) || subjectLabel(c.subject, c.subjectName).toLowerCase().includes(q) || c.messages.some(m => m.text?.toLowerCase().includes(q))
    );
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return { pinned: list.filter(c => c.pinned), recent: list.filter(c => !c.pinned) };
  }, [ws.chats, query, courseByKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjectSection = subjectItems.findIndex(s => s.children?.some(k => k.value === chat.subject));
  const upcomingCount = (ws.events ?? []).filter(e => !e.done && dueOf(e) > now - 86400e3).length;

  const renderRow = c => (
    <div key={c.id} className="chat-row" data-active={route === 'chat' && c.id === chat.id ? '' : undefined}>
      {renaming === c.id ? (
        <input
          className="chat-row__rename"
          defaultValue={c.title}
          autoFocus
          onBlur={e => {
            patchChat(ws.id, c.id, x => ({ ...x, title: e.target.value.trim() || x.title }));
            setRenaming(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(null);
          }}
        />
      ) : (
        <button
          type="button"
          className="chat-row__main"
          onClick={() => {
            setActiveChatId(c.id);
            go('chat');
            if (window.innerWidth <= 900) setSidebar(false);
          }}
          onDoubleClick={() => setRenaming(c.id)}
        >
          <span className="chat-row__title">{c.title}</span>
          <span className="chat-row__sub">{subjectLabel(c.subject, c.subjectName)}</span>
        </button>
      )}
      <span className="chat-row__actions">
        <button type="button" title={c.pinned ? 'Unpin' : 'Pin'} data-on={c.pinned ? '' : undefined} onClick={() => patchChat(ws.id, c.id, x => ({ ...x, pinned: !x.pinned }))}>
          <Icon icon={Pin02Icon} size={13} />
        </button>
        <button type="button" title="Rename" onClick={() => setRenaming(c.id)}>
          <Icon icon={PencilEdit02Icon} size={13} />
        </button>
        <button type="button" title="Delete" onClick={() => removeChat(c.id)}>
          <Icon icon={Delete02Icon} size={13} />
        </button>
      </span>
    </div>
  );

  const prompts = [...DEFAULT_PROMPTS, ...state.prompts];
  const crumbs = route === 'study' ? ['Revision', { today: 'Today', plan: 'Timetable', topics: 'Topics', practice: 'Exam practice', cards: 'Flashcards', analytics: 'Analytics', coach: 'Coach', roadmap: 'Roadmap' }[studyTab]] : route === 'calendar' ? ['Exam Calendar'] : route === 'chat' ? ['AI Conversations', chat.title] : [route === 'terms' ? 'Terms & Conditions' : 'Privacy Policy'];

  return (
    <div className="app" data-sidebar={sidebar ? '' : undefined} data-runner={study.activeSession && !study.activeSession.min ? '' : undefined}>
      {/* ── Sidebar ── */}
      <aside className="sidebar" aria-label="Workspace">
        <div className="sidebar__brand">
          <Logo size={24} />
          <button type="button" className="icon-btn" aria-label="Collapse sidebar" onClick={() => setSidebar(false)}>
            <Icon icon={SidebarLeftIcon} />
          </button>
        </div>

        <WorkspaceSwitcher
          workspaces={state.workspaces}
          active={ws}
          onSwitch={id => {
            update(s => ({ ...s, activeWorkspaceId: id }));
            setActiveChatId(null);
          }}
          onCreate={createWorkspace}
          onRename={(id, name) => patchWs(id, w => ({ ...w, name }))}
          onDelete={deleteWorkspace}
        />

        <nav className="nav">
          <button type="button" data-active={route === 'chat' ? '' : undefined} onClick={() => go('chat')}>
            <Icon icon={BubbleChatIcon} size={15} /> Study chat
          </button>
          <button type="button" data-active={route === 'study' ? '' : undefined} onClick={() => go('study')}>
            <Icon icon={Target02Icon} size={15} /> Revision
            {(study.plan?.sessions ?? []).filter(x => x.date === ymd(now) && x.status === 'planned').length ? (
              <span className="nav__count">{study.plan.sessions.filter(x => x.date === ymd(now) && x.status === 'planned').length}</span>
            ) : null}
          </button>
          <button type="button" data-active={timerOpen ? '' : undefined} onClick={() => setTimerOpen(o => !o)}>
            <Icon icon={Timer02Icon} size={15} /> Focus timer
            {timer.endsAt ? <span className="nav__count nav__count--live">●</span> : null}
          </button>
          <button type="button" data-active={route === 'calendar' ? '' : undefined} onClick={() => go('calendar')}>
            <Icon icon={Calendar03Icon} size={15} /> Calendar
            {upcomingCount ? <span className="nav__count">{upcomingCount}</span> : null}
          </button>
          <button type="button" onClick={() => setDialog('share')}>
            <Icon icon={UserGroupIcon} size={15} /> Share workspace
          </button>
        </nav>

        <button type="button" className="new-chat" onClick={startChat}>
          <Icon icon={Add01Icon} size={15} stroke={2} /> New conversation
        </button>

        <label className="search">
          <Icon icon={Search01Icon} size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" />
        </label>

        <div className="sidebar__scroll">
          {route === 'chat' ? (
            <>
              <div className="side-label side-label--row">
                Subject context
                <button type="button" className="link-btn" onClick={() => setSubjectsOpen(true)}>
                  {courses.length ? 'Edit' : 'Add subjects'}
                </button>
              </div>
              <div className="subjects">
                <BranchedMenu
                  key={`${chat.id}:${courses.map(c => c.key).join(',')}`}
                  items={subjectItems}
                  defaultOpen={subjectSection >= 0 ? [subjectSection] : -1}
                  defaultActive={chat.subject}
                  onSelect={value => patchChat(ws.id, chat.id, x => ({ ...x, subject: value, subjectName: value === 'General' ? '' : subjectLabel(value) }))}
                  color={C.text}
                  accentColor={C.emerald}
                  lineColor={C.line}
                  width={230}
                  rowHeight={32}
                  fontSize={13}
                />
              </div>
            </>
          ) : null}

          {sorted.pinned.length ? (
            <>
              <div className="side-label">Pinned</div>
              {sorted.pinned.map(renderRow)}
            </>
          ) : null}
          <div className="side-label">Conversations</div>
          {sorted.recent.map(renderRow)}
          {sorted.pinned.length + sorted.recent.length === 0 ? <div className="side-empty">No chats match “{query}”</div> : null}
        </div>

        {season ? (
          <button type="button" className="sale-ribbon" onClick={() => setDialog('plans')}>
            <span className="sale-ribbon__dot" />
            <span className="sale-ribbon__text">
              <strong>
                {season.name} · {season.percent}% off
              </strong>
              <span>
                {season.bonus.type === 'messages' ? `${season.bonus.label.replace(/^.*?: /, '')} · ` : ''}
                {timeLeft(season.end, now)}
              </span>
            </span>
          </button>
        ) : null}
        <AccountMenu
          open={accountOpen}
          setOpen={setAccountOpen}
          user={state.user}
          plan={tier}
          billing={state.plan.billing}
          usage={usage}
          limits={limits}
          points={state.rewards?.points ?? 0}
          season={season}
          now={now}
          onRewards={() => setDialog('rewards')}
          onActivate={IS_PREVIEW_BUILD ? null : () => setDialog({ activate: {} })}
          onUser={user => {
            update(s => ({ ...s, user }));
            setAccountOpen(false);
            setToast(`Signed in as ${user.email}`);
          }}
          onSignOut={() => {
            signOutGoogle();
            update(s => ({ ...s, user: null }));
            setToast('Signed out');
          }}
          onPlans={() => setDialog('plans')}
          onShare={() => setDialog('share')}
          onSettings={() => setDialog('settings')}
          onContact={() => setDialog('contact')}
        />
      </aside>
      {sidebar ? <div className="scrim" onClick={() => setSidebar(false)} /> : null}

      {/* ── Main ── */}
      <main className="main" data-route={route}>
        {route === 'chat' ? (
          <div className="road" data-quiet={isEmpty ? undefined : ''} aria-hidden="true">
            <Hyperspeed
              curve="gentle"
              curvature={0.7}
              speed={0.55}
              boost={4}
              fov={88}
              boostFov={120}
              lanes={3}
              roadWidth={9}
              medianWidth={2.5}
              density={34}
              trailLength={1.1}
              lightSize={0.9}
              poles={18}
              poleHeight={0.9}
              dust={60}
              glow={0.55}
              reflections={0.45}
              roadOpacity={0.14}
              steer={0.2}
              tailColors={['#39A875', '#1F7A52', '#6FCF97']}
              headColors={['#E4F2D5', '#A0B3A6', '#9BE3BE']}
              poleColors={['#39A875', '#5FBF8A']}
              roadColor={C.dark}
              lineColor="#1C4A36"
              interactive={false}
              boosting={busy}
            />
            <div className="road__veil" />
          </div>
        ) : null}

        {previewBlocked ? (
          <div className="preview-banner" role="status">
            {IS_PREVIEW_BUILD ? (
              <>
                <strong>Standalone version of EUREKA.</strong>
                <span>Everything is clickable and your work is saved in this browser, but the AI (tutor replies, importing spec topics, writing and marking questions, AI flashcards and coach) and Google sign-in need EUREKA’s server: run npm run dev in the project folder, or open your deployed site. Add topics by hand to try the planner, timetable, sessions, flashcards and timer.</span>
              </>
            ) : (
              <>
                <strong>You’re viewing EUREKA in a preview window.</strong>
                <span>It blocks connections, so the tutor and Google sign-in can’t work here. Download the file and open it in Chrome, Edge or Safari — or open EUREKA from its website.</span>
              </>
            )}
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setPreviewBlocked(false)}>
              <Icon icon={Cancel01Icon} size={14} />
            </button>
          </div>
        ) : null}
        <header className="topbar">
          {!sidebar ? (
            <button type="button" className="icon-btn" aria-label="Open sidebar" onClick={() => setSidebar(true)}>
              <Icon icon={Menu01Icon} />
            </button>
          ) : null}
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>{ws.name}</span>
            {crumbs.map((c, i) => (
              <span key={i} className={i === crumbs.length - 1 ? 'crumbs__here' : ''}>
                <span className="crumbs__sep">/</span> {c}
              </span>
            ))}
          </nav>
          {route === 'chat' ? (
            <span className="subject-pill">
              <Icon icon={Book02Icon} size={13} /> {chat.subject === 'General' ? 'General' : subjectLong(chat.subject)}
            </span>
          ) : null}
          <Bell
            items={reminders}
            now={now}
            browserOn={state.settings.browserNotifications}
            onToggleBrowser={toggleBrowser}
            onDismiss={id => update(s => ({ ...s, dismissed: [...s.dismissed, id].slice(-1000) }))}
            onOpen={id => {
              update(s => ({ ...s, activeWorkspaceId: id }));
              go('calendar');
            }}
          />
        </header>

        {route === 'calendar' ? (
          <CalendarView
            events={ws.events ?? []}
            subjects={['General', ...courses.map(c => subjectLabel(c.key))]}
            workspaceName={ws.name}
            now={now}
            onChange={fn => patchWs(ws.id, w => ({ ...w, events: fn(w.events ?? []) }))}
            onComplete={() => reward('deadline')}
          />
        ) : null}

        {route === 'study' ? (
          <StudyView
            study={study}
            patch={patchStudy}
            courses={courses}
            exams={exams}
            outstanding={state.workspaces.flatMap(w => (w.events ?? []).filter(e => !e.done && e.type !== 'Exam' && e.type !== 'Test')).sort((x, y) => dueOf(x) - dueOf(y))}
            now={now}
            tab={studyTab}
            onTab={setStudyTab}
            focusTarget={practiceTarget}
            planner={planner}
            setPlanner={setPlanner}
            subjectLabel={k => subjectLabel(k)}
            onEditSubjects={() => setSubjectsOpen(true)}
            runTask={runAiTask}
            askTutor={askTutor}
            startSession={startSession}
            startFocus={startFocus}
            onAddExam={addExam}
            onRemoveExam={removeExam}
            onGrade={onGrade}
            reward={reward}
            setToast={setToast}
          />
        ) : null}

        {route === 'terms' || route === 'privacy' ? (
          <section className="thread">
            <Legal page={route} onDeleteAll={deleteAll} />
          </section>
        ) : null}

        {route === 'chat' ? (
          <>
            <section className="thread" ref={scroller}>
              {isEmpty ? (
                <div className="hero">
                  <span className="hero__eyebrow">
                    <Icon icon={BrainIcon} size={14} /> Study chat · {chatLabel}
                  </span>
                  <h1>
                    What are we <em>learning</em> today?
                  </h1>
                  <p>
                    Ask a question, attach your notes or slides, or type <kbd>/</kbd> for study modes and <kbd>@</kbd> for sources. EUREKA tutors — it
                    guides you to the answer rather than handing it over.
                  </p>
                  {upcomingCount ? (
                    <button type="button" className="hero__due" onClick={() => go('calendar')}>
                      <Icon icon={Calendar03Icon} size={14} /> {upcomingCount} upcoming deadline{upcomingCount > 1 ? 's' : ''} — the tutor will plan around them
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="messages">
                  {chat.messages.map(m => (
                    <Message key={m.id} msg={m} onAction={a => setDialog(a)} />
                  ))}
                </div>
              )}
            </section>

            <footer className="composer">
              <div className="suggestions" role="list">
                {prompts.map(p => {
                  const custom = !DEFAULT_PROMPTS.includes(p);
                  return (
                    <span key={p} className="chip" role="listitem">
                      <button type="button" disabled={busy} onClick={() => send(`${p}${chat.subject !== 'General' ? ` (${chatLabel})` : ''}`, settings.current)}>
                        {custom ? <Icon icon={StarIcon} size={11} /> : null}
                        {p}
                      </button>
                      {custom ? (
                        <button type="button" className="chip__x" aria-label={`Remove ${p}`} onClick={() => update(s => ({ ...s, prompts: s.prompts.filter(x => x !== p) }))}>
                          <Icon icon={Cancel01Icon} size={10} stroke={2.4} />
                        </button>
                      ) : null}
                    </span>
                  );
                })}
                {addingPrompt ? (
                  <input
                    className="chip chip--input"
                    autoFocus
                    placeholder="Save a prompt…"
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v && !prompts.includes(v)) {
                        if (state.prompts.length >= limits.customPrompts) {
                          setToast(`${PLANS[tier].name} saves up to ${limits.customPrompts} custom prompts.`);
                        } else update(s => ({ ...s, prompts: [...s.prompts, v] }));
                      }
                      setAddingPrompt(false);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setAddingPrompt(false);
                    }}
                  />
                ) : (
                  <span className="chip chip--add">
                    <button type="button" onClick={() => setAddingPrompt(true)} aria-label="Save a custom prompt">
                      <Icon icon={Add01Icon} size={12} stroke={2.2} />
                    </button>
                  </span>
                )}
              </div>

              <PromptBar
                key={tier}
                defaultModel={PLAN_DEFAULT_MODEL[tier]}
                placeholder={`Ask EUREKA about ${chat.subject === 'General' ? 'anything you’re studying' : chatLabel}…`}
                sources={SOURCES}
                commands={COMMANDS}
                models={pickerModels}
                efforts={efforts}
                defaultEffort="Low"
                onEffortChange={e => (settings.current = { ...settings.current, effort: e })}
                busy={busy}
                onSend={send}
                onStop={() => controller.current?.abort()}
                onAttach={attach}
                onDictate={Speech ? dictate : undefined}
                background={C.surface}
                color={C.text}
                menuBackground={C.forest}
                sparkColor={C.emerald}
                sparkBoost={1}
                width={760}
                radius={18}
                maxRows={7}
              />
              <p className="composer__note">
                AI can make mistakes — check key facts against your notes. <a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a>
              </p>
            </footer>
          </>
        ) : null}
      </main>

      {/* ── Dialogs ── */}
      {dialog === 'plans' ? (
        <PlansDialog
          current={tier}
          billing={state.plan.billing}
          user={state.user}
          offerCtx={{ now, firstSeen: state.firstSeen, hasPaid: state.hasPaid, examYear: state.examYear, points: state.rewards?.points ?? 0, plan: state.plan }}
          onExamYear={on => update(s => ({ ...s, examYear: on }))}
          onRewards={() => setDialog('rewards')}
          onClose={() => setDialog(null)}
          onDowngrade={() => dropToFree('', false)}
          onActivate={IS_PREVIEW_BUILD ? null : () => setDialog({ activate: {} })}
        />
      ) : null}
      {dialog?.activate ? (
        <ActivateDialog
          returning={dialog.activate.returning}
          initialKey={state.planPass?.licenseKey ?? ''}
          onPlans={() => setDialog('plans')}
          onClose={() => setDialog(null)}
          onActivated={pass => {
            applyPass(pass);
            setDialog(null);
            setToast(`EUREKA ${PLANS[pass.tier].name} is active. Enjoy!`);
          }}
        />
      ) : null}
      {dialog === 'rewards' ? (
        <RewardsDialog rewards={state.rewards} plan={state.plan} now={now} onPlans={() => setDialog('plans')} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'share' ? (
        <ShareDialog
          workspace={ws}
          user={state.user}
          limits={limits}
          onMembers={members => {
            if (members.length > (ws.members?.length ?? 0)) reward('invite');
            patchWs(ws.id, w => ({ ...w, members }));
          }}
          onImport={importWorkspace}
          onUpgrade={() => setDialog('plans')}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'contact' ? <ContactDialog user={state.user} onClose={() => setDialog(null)} /> : null}
      {dialog === 'settings' ? (
        <SettingsDialog
          plan={tier}
          settings={state.settings}
          onSettings={patch => update(s => ({ ...s, settings: { ...s.settings, ...patch } }))}
          onPreviewPlan={t => update(s => ({ ...s, plan: { ...s.plan, tier: t } }))}
          onUpgrade={() => setDialog('plans')}
          onEditSubjects={() => {
            setDialog(null);
            setSubjectsOpen(true);
          }}
          onClose={saved => {
            setDialog(null);
            if (saved) {
              setToast('Settings saved');
              discoverModels().then(setModels);
            }
          }}
        />
      ) : null}
      {!profile.onboarded || subjectsOpen ? (
        <Onboarding
          initial={courses}
          firstRun={!profile.onboarded}
          onClose={() => setSubjectsOpen(false)}
          roadmap={Boolean(study.roadmap)}
          onSave={(list, opts = {}) => {
            setSubjectsOpen(false);
            if (opts.roadmap !== undefined) patchStudy(st => ({ ...st, roadmap: opts.roadmap }));
            update(s => {
              const first = list[0];
              // Point a still-empty "General" chat at the student's first subject.
              const workspaces =
                first && !s.profile?.onboarded
                  ? s.workspaces.map(w => ({
                      ...w,
                      chats: w.chats.map(c => (c.messages.length === 0 && c.subject === 'General' ? { ...c, subject: first.key, subjectName: first.subject } : c))
                    }))
                  : s.workspaces;
              return { ...s, workspaces, profile: { ...s.profile, courses: list, onboarded: true, updatedAt: Date.now() } };
            });
            if (list.length) reward('setup');
            if (list.length) setToast(`Saved ${list.length} subject${list.length > 1 ? 's' : ''}. The tutor will follow your specifications.`);
          }}
        />
      ) : null}
      {study.activeSession ? (
        <SessionRunner
          run={study.activeSession}
          topicById={new Map(Object.values(study.topics ?? {}).flat().map(t => [t.id, t]))}
          subjectLabel={k => subjectLabel(k)}
          onPatch={patchRun}
          onTutor={askTutor}
          onPractice={(courseKey, topicId) => {
            setStudyTab('practice', { courseKey, topicId });
            go('study');
          }}
          onCards={() => {
            setStudyTab('cards');
            go('study');
          }}
          onFinish={finishSession}
          onAbandon={() =>
            setDialog({
              confirm: {
                title: 'End this session?',
                body: 'It stays in your plan as not done, and EUREKA will reschedule it.',
                confirm: 'End session',
                danger: false,
                onConfirm: () => patchStudy(st => ({ ...st, activeSession: null }))
              }
            })
          }
        />
      ) : null}
      {timerOpen || timer.endsAt ? (
        <Pomodoro
          collapsed={!timerOpen}
          onExpand={() => setTimerOpen(true)}
          settings={study.focus}
          timer={{ ...timer, todayFocus }}
          onSettings={f => patchStudy(st => ({ ...st, focus: f }))}
          onTimer={fn => patchStudy(st => ({ ...st, timer: fn(st.timer ?? { phase: 'focus', cycle: 1, endsAt: null, left: null }) }))}
          onLog={(minutes, t) => patchStudy(st => ({ ...st, log: [...st.log, logEntry({ type: 'focus', activity: 'focus', minutes, courseKey: t.courseKey, topicId: t.topicId })].slice(-3000) }))}
          onClose={() => setTimerOpen(false)}
          notify={notify}
        />
      ) : null}
      {dialog?.confirm ? <ConfirmDialog {...dialog.confirm} onClose={() => setDialog(null)} /> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
