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
  UserGroupIcon,
  Mortarboard01Icon,
  QuizIcon,
  Idea01Icon,
  FlashIcon,
  Cards01Icon,
  TaskDone01Icon,
  Notebook01Icon
} from '@hugeicons/core-free-icons';
import PromptBar from './components/PromptBar';
import Hyperspeed from './components/Hyperspeed';
import BranchedMenu from './components/BranchedMenu';
import AccountMenu from './components/AccountMenu';
import UsageView from './views/UsageView';
import { ActivateDialog, ConfirmDialog, ContactDialog, PlansDialog, RewardsDialog, SettingsDialog, ShareDialog } from './components/Dialogs';
import { C, Icon, LeafMark, Logo } from './components/ui';
import CalendarView from './views/CalendarView';
import StudyView from './views/StudyView';
import SessionRunner from './components/SessionRunner';
import Pomodoro from './components/Pomodoro';
import Legal from './views/Legal';
import { EFFORTS, IS_PREVIEW_BUILD, MODELS, SPEC_QUESTION, blockedPreview, discoverModels, fetchPlanStatus, runTask, setPlanAuth, streamChat } from './lib/ai';
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
import { applyAppearance, getAppearance, setAppearance, watchSystemAppearance } from './lib/appearance';
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
// An icon for each built-in prompt chip.
const PROMPT_ICONS = {
  'Plan revision for my upcoming deadlines': Calendar03Icon,
  'Teach me this topic': Mortarboard01Icon,
  'Test my knowledge': QuizIcon,
  'Explain this simply': Idea01Icon,
  'Generate difficult questions': FlashIcon,
  'Find my weak areas': Target02Icon,
  'Create flashcards': Cards01Icon,
  'Make a revision plan': TaskDone01Icon,
  'Quiz me using my uploaded resources': Notebook01Icon
};

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
// What else this student has asked about in the same subject's chat area (titles only — cheap).
const subjectMemory = (w, c) => {
  if (!c.subject || c.subject === 'General') return '';
  const titles = w.chats
    .filter(x => x.id !== c.id && x.subject === c.subject && x.messages.length && x.title && x.title !== 'New conversation')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map(x => x.title.slice(0, 60));
  return titles.length ? `\n- Earlier chats in this subject: ${titles.join('; ')}` : '';
};

/* ── routing ─────────────────────────────────────────────── */
const readRoute = () => {
  const h = location.hash.replace(/^#\/?/, '');
  return ['calendar', 'study', 'terms', 'privacy', 'usage'].includes(h) ? h : 'chat';
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

// Top navigation bar layout (index.html: <html data-layout="topbar">), with the sidebar as a
// slide-out menu. Remove the attribute for the original sidebar layout (src/layout-topbar.css).
const TOPBAR = typeof document !== 'undefined' && document.documentElement.dataset.layout === 'topbar';
// Subject "course cards" on the chat home screen, part of the light Paper style.
const PAGE_HEADS = {
  study: ['Revision', 'Your plan, topics, flashcards and exam practice in one place.'],
  calendar: ['Exam calendar', 'Tests, homework and exams — EUREKA plans your revision around them.']
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
            {msg.action === 'plans' ? 'See plans' : msg.action === 'signin' ? 'Sign in — it’s free' : 'Open settings'}
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
  /* appearance: light, dark or follow the device */
  const [appearance, setAppearanceState] = useState(getAppearance);
  useEffect(() => {
    applyAppearance(appearance);
    if (appearance !== 'system') return undefined;
    return watchSystemAppearance(() => applyAppearance('system'));
  }, [appearance]);
  const chooseAppearance = a => {
    setAppearance(a);
    setAppearanceState(a);
  };
  const route = useRoute();
  const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId) ?? state.workspaces[0];
  const tier = state.plan.tier;
  const baseLimits = PLANS[tier].limits;

  /* the student's own courses (from onboarding) */
  const profile = state.profile ?? { courses: [], onboarded: false };
  const courses = profile.courses;
  const courseByKey = useMemo(() => new Map(courses.map(c => [c.key, c])), [courses]);

  // Each subject has its own chat area. 'all' shows every conversation in the workspace.
  const area = ws.chatArea && (ws.chatArea === 'General' || courseByKey.has(ws.chatArea)) ? ws.chatArea : 'all';
  const inArea = c => area === 'all' || c.subject === area;
  const [activeChatId, setActiveChatId] = useState(null);
  const chat = ws.chats.find(c => c.id === activeChatId) ?? ws.chats.find(inArea) ?? ws.chats[0];
  const isEmpty = chat.messages.length === 0;
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
      { label: 'All chats', value: 'all' },
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
  const [sidebar, setSidebar] = useState(() => !TOPBAR && window.innerWidth > 900);

  const [accountOpen, setAccountOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // 'plans' | 'share' | 'contact' | 'settings' | {confirm} | {activate}

  /* plans: worked out by the server — from the signed-in student's Whop subscription (automatic),
     or an older license-key activation. The website only displays what the server says. */
  setPlanAuth({ token: state.planPass?.token, session: state.user?.session, preview: import.meta.env.DEV ? state.plan.tier : '' });
  const [account, setAccount] = useState(null); // { tier, allowance, guest, signedIn, owner, source } from the server
  const applyPass = useCallback(
    pass =>
      setState(s => ({
        ...s,
        hasPaid: true,
        planPass: { token: pass.token, tier: pass.tier, billing: pass.billing, until: pass.until, licenseKey: pass.licenseKey ?? s.planPass?.licenseKey, owner: pass.membership === 'owner' || Boolean(pass.owner) },
        plan: { tier: pass.tier, billing: pass.billing, since: s.plan.tier === pass.tier ? s.plan.since : Date.now() }
      })),
    []
  );
  const isOwner = import.meta.env.DEV || Boolean(state.planPass?.owner) || Boolean(account?.owner);
  const dropToFree = useCallback(
    (message, keepKey = true) => {
      setState(s => ({ ...s, planPass: keepKey && s.planPass?.licenseKey ? { licenseKey: s.planPass.licenseKey } : null, plan: { tier: 'free', billing: 'monthly', since: Date.now() } }));
      if (message) setToast(message);
    },
    []
  );
  // Show whatever plan the server reports. Upgrades, downgrades, cancellations and expiry
  // arrive here on their own: on load, when the tab comes back into view, every few minutes,
  // after checkout, and with every AI answer.
  const planRef = useRef(state.plan.tier);
  planRef.current = state.plan.tier;
  const applyServerPlan = useCallback(info => {
    if (!info || !PLANS[info.tier]) return;
    setAccount(info);
    if (import.meta.env.DEV || IS_PREVIEW_BUILD) return; // the owner previews plans from Settings on npm run dev
    const before = planRef.current;
    if (info.tier === before) return;
    setState(s => ({ ...s, hasPaid: s.hasPaid || info.tier !== 'free', plan: { tier: info.tier, billing: info.billing || s.plan.billing, since: Date.now() } }));
    if (info.tier !== 'free') setToast(`EUREKA ${PLANS[info.tier].name} is active${info.source === 'whop' ? ' — found from your purchase' : ''}. Enjoy!`);
    else if (before !== 'free') setToast(`Your ${PLANS[before].name} membership isn’t active any more, so you’re on the Free plan. Your chats and workspaces are kept.`);
  }, []);
  const refreshPlan = useCallback(
    (fresh = false) =>
      fetchPlanStatus({ fresh })
        .then(info => {
          applyServerPlan(info);
          return info;
        })
        .catch(() => null),
    [applyServerPlan]
  );
  // The server's own count of this student's messages (can't be reset by refreshing or new tabs).
  const allowanceBlock = () => {
    const a = account?.allowance;
    if (!a || import.meta.env.DEV) return null;
    const who = account?.guest && state.plan.tier === 'free';
    if (a.day.limit && a.day.used >= a.day.limit)
      return who
        ? `You’ve used today’s **${a.day.limit} free messages** without an account. **Sign in with Google** (free) for ${PLANS.free.limits.messagesPerDay} a day — or upgrade.`
        : `You’ve used today’s **${a.day.limit} AI messages** on ${PLANS[state.plan.tier].name}. They reset at midnight (UTC) — or upgrade for more.`;
    if (a.month.limit && a.month.used >= a.month.limit) return `You’ve used this month’s **${a.month.limit} AI messages** on ${PLANS[state.plan.tier].name}. They reset on the 1st — or upgrade for more.`;
    return null;
  };
  useEffect(() => {
    refreshPlan();
    const t = setInterval(() => refreshPlan(), 5 * 60_000);
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 60_000) {
        last = Date.now();
        refreshPlan();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state.user?.session, state.planPass?.token, refreshPlan]);
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [toast, setToast] = useState('');
  const [usage, setUsage] = useState(getUsage);
  const [now, setNow] = useState(() => Date.now());

  /* sales, bonuses and rewards change what each plan includes */
  const season = activeSeason(now);
  const rewardTier = tierFor(state.rewards?.points ?? 0);
  const serverDay = account?.allowance?.day?.limit;
  const serverWeb = account?.allowance?.web?.limit;
  const limits = useMemo(() => {
    // Free: exactly what the server enforces (it applies seasonal boosts itself).
    if (tier === 'free' && serverDay) return { ...baseLimits, messagesPerDay: serverDay, webPerDay: serverWeb || baseLimits.webPerDay, customPrompts: baseLimits.customPrompts + rewardTier.prompts };
    const boost = season?.bonus.type === 'messages' ? season.bonus.boost : 0;
    return {
      ...baseLimits,
      messagesPerDay: Math.round(baseLimits.messagesPerDay * (1 + boost)) + rewardTier.messages,
      customPrompts: baseLimits.customPrompts + rewardTier.prompts
    };
  }, [baseLimits, season?.id, rewardTier.id, serverDay, serverWeb]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // Back from Whop checkout: the URL never switches a plan on. The server looks the purchase
    // up in Whop (by the signed-in student's email) — keep asking for up to two minutes.
    if (q.get('checkout')) {
      history.replaceState(null, '', location.pathname + location.hash);
      setToast('Checking your purchase with Whop…');
      let tries = 0;
      const check = async () => {
        tries++;
        const info = await refreshPlan(true);
        if (info?.tier && info.tier !== 'free') return;
        if (info && !info.signedIn) {
          setToast('Sign in with Google using the email you paid with — your plan switches on automatically.');
          setAccountOpen(true);
          return;
        }
        if (tries < 12) setTimeout(check, 10_000);
        else setDialog({ activate: { returning: true, notFound: true, email: info?.email } });
      };
      setTimeout(check, 1500);
    }
  }, [importWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

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
    else if (allowanceBlock()) block = allowanceBlock();
    else if (u.messages >= limits.messagesPerDay && !(tier === 'free' && account?.allowance)) block = `You’ve used today’s **${limits.messagesPerDay} AI messages** on ${PLANS[tier].name}. Your allowance resets at midnight — or upgrade for more.`;
    else if (webSearch && u.web >= limits.webPerDay) block = `You’ve used today’s **${limits.webPerDay} web searches** on ${PLANS[tier].name}. Send without @Web search, or upgrade for more.`;
    else if (!modelAllowed(tier, model?.key ?? '')) block = `**${model.name}** is part of the ${PLANS[minPlanForModel(model.key)].name} plan. Pick another model in the menu, or upgrade.`;
    if (block) {
      patchChat(w.id, c.id, x => ({ ...x, title, updatedAt: Date.now(), messages: [...x.messages, userMsg, { id: uid(), role: 'model', text: block, limit: true, action: account?.guest && tier === 'free' ? 'signin' : 'plans' }] }));
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
        studentModel: studentModelText({ ...study, activeSession: study.activeSession ? { stepName: study.activeSession.session.blocks[study.activeSession.step]?.activity } : null }, courses, c.subject) + subjectMemory(w, c),
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
      const { text, sources, signature, model: usedModel, fellBackFrom, fallbackReason, searchDropped, imagesSkipped, webLimited, serverPlan, allowance } = result;
      if (allowance) setAccount(a => ({ ...(a ?? {}), allowance: { ...(a?.allowance ?? {}), ...allowance } }));
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
      if (!import.meta.env.DEV && serverPlan && serverPlan !== state.plan.tier && PLANS[serverPlan]) refreshPlan();
      if (fellBackFrom && fallbackReason === 'plan' && !(serverPlan === 'free' && state.plan.tier !== 'free'))
        setToast(`${nameOf(fellBackFrom)} isn’t included in your plan, so ${nameOf(usedModel)} answered.`);
      else if (fellBackFrom && fallbackReason === 'busy') {
        /* another model had spare capacity and answered — normal, no message */
      } else if (fellBackFrom && (fallbackReason === 'vision' || fallbackReason === 'search'))
        setToast(`${nameOf(fellBackFrom)} ${fallbackReason === 'vision' ? 'can’t read images' : 'can’t search the web'}, so ${nameOf(usedModel)} answered this one.`);
      else if (fellBackFrom)
        setToast(`${nameOf(fellBackFrom)} couldn’t answer${why ? ` (${why})` : ''} — answered with ${nameOf(usedModel)} instead.${import.meta.env.DEV ? ' Settings → Test all models shows details.' : ''}`);
      else if (searchDropped) setToast('Web search wasn’t available for this request, so this answer was written without it.');
      else if (imagesSkipped) setToast('Reading images is part of the Max plan, so this answer used your text only.');
      else if (webLimited) setToast(`That’s today’s ${limits.webPerDay} web searches on ${PLANS[tier].name}, so this answer was written without searching. Upgrade for more.`);
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
              : err?.kind === 'daily_limit' || err?.kind === 'monthly_limit'
                ? { ...m, text: err.message, limit: true, action: err.guest ? 'signin' : 'plans', pending: false }
                : { ...m, text: `**${err.title || 'Couldn’t reach the AI.'}** ${err.message || err}`, error: true, pending: false }
            : m
        )
      }));
    } finally {
      setBusy(false);
      controller.current = null;
    }
    // A refused request: refresh the meters from the server.
    if (account && !import.meta.env.DEV) refreshPlan();
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
    const over = allowanceBlock();
    if (over) throw new Error(over.replace(/\*\*/g, ''));
    if (u.messages >= limits.messagesPerDay && !(tier === 'free' && account?.allowance)) throw new Error(`You’ve used today’s ${limits.messagesPerDay} AI messages on ${PLANS[tier].name}. Upgrade or come back tomorrow.`);
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
    } finally {
      refreshPlan();
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
    patchWs(ws.id, w => ({ ...w, chatArea: key, chats: existing ? w.chats : [target, ...w.chats] }));
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
    const subject = area === 'all' ? chat.subject : area;
    if (isEmpty && chat.subject === subject) return;
    const c = { ...newChat(subject), subjectName: subject === 'General' ? '' : courseByKey.get(subject)?.subject };
    patchWs(ws.id, w => ({ ...w, chats: [c, ...w.chats] }));
    setActiveChatId(c.id);
    if (TOPBAR || window.innerWidth <= 900) setSidebar(false);
  };

  const removeChat = id => {
    patchWs(ws.id, w => {
      const chats = w.chats.filter(c => c.id !== id);
      // Keep at least one chat in the subject area you're looking at.
      if (area !== 'all' && !chats.some(c => c.subject === area)) chats.unshift({ ...newChat(area), subjectName: area === 'General' ? '' : courseByKey.get(area)?.subject });
      return { ...w, chats: chats.length ? chats : [newChat()] };
    });
    resources.current.delete(id);
    if (id === chat.id) setActiveChatId(null);
  };

  // Open a subject's chat area: its most recent chat, or a fresh one if it has none yet.
  const openArea = value => {
    go('chat');
    if (value === 'all') {
      patchWs(ws.id, w => ({ ...w, chatArea: 'all' }));
      return;
    }
    const subjectName = value === 'General' ? '' : courseByKey.get(value)?.subject;
    const latest = [...ws.chats].filter(c => c.subject === value).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (latest) {
      patchWs(ws.id, w => ({ ...w, chatArea: value }));
      setActiveChatId(latest.id);
    } else if (isEmpty) {
      patchWs(ws.id, w => ({ ...w, chatArea: value, chats: w.chats.map(c => (c.id === chat.id ? { ...c, subject: value, subjectName } : c)) }));
    } else {
      const c = { ...newChat(value), subjectName };
      patchWs(ws.id, w => ({ ...w, chatArea: value, chats: [c, ...w.chats] }));
      setActiveChatId(c.id);
    }
    if (TOPBAR || window.innerWidth <= 900) setSidebar(false);
  };

  // Move the open chat to another subject; the view follows it.
  const moveChat = value => {
    const subjectName = value === 'General' ? '' : subjectLabel(value);
    patchWs(ws.id, w => ({ ...w, chatArea: w.chatArea && w.chatArea !== 'all' ? value : w.chatArea, chats: w.chats.map(c => (c.id === chat.id ? { ...c, subject: value, subjectName } : c)) }));
    setActiveChatId(chat.id);
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
      c => (q ? true : inArea(c)) && (!q || c.title.toLowerCase().includes(q) || subjectLabel(c.subject, c.subjectName).toLowerCase().includes(q) || c.messages.some(m => m.text?.toLowerCase().includes(q)))
    );
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return { pinned: list.filter(c => c.pinned), recent: list.filter(c => !c.pinned) };
  }, [ws.chats, query, courseByKey, area]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjectSection = subjectItems.findIndex(s => s.children?.some(k => k.value === area));
  const areaName = area === 'all' ? '' : subjectLabel(area);
  const areaCount = key => ws.chats.filter(c => c.subject === key && c.messages.length).length;
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
            if (area !== 'all' && c.subject !== area) patchWs(ws.id, w => ({ ...w, chatArea: c.subject }));
            go('chat');
            if (TOPBAR || window.innerWidth <= 900) setSidebar(false);
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
  const crumbs = route === 'study' ? ['Revision', { today: 'Today', plan: 'Timetable', topics: 'Topics', practice: 'Exam practice', cards: 'Flashcards', analytics: 'Analytics', coach: 'Coach', roadmap: 'Roadmap' }[studyTab]] : route === 'calendar' ? ['Exam Calendar'] : route === 'usage' ? ['AI usage & costs'] : route === 'chat' ? ['AI Conversations', ...(areaName ? [areaName] : []), chat.title] : [route === 'terms' ? 'Terms & Conditions' : 'Privacy Policy'];

  // The slide-out menu closes when you go somewhere or open a window from it.
  useEffect(() => {
    if (TOPBAR) setSidebar(false);
  }, [route, dialog, timerOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const accountMenu = (
  <AccountMenu
    open={accountOpen}
    setOpen={setAccountOpen}
    user={state.user}
    plan={tier}
    billing={state.plan.billing}
    usage={usage}
    limits={limits}
    allowance={import.meta.env.DEV ? null : account?.allowance}
    guest={Boolean(account?.guest) && tier === 'free'}
    points={state.rewards?.points ?? 0}
    season={season}
    now={now}
    onRewards={() => setDialog('rewards')}
    onActivate={null}
    onUsage={isOwner ? () => go('usage') : null}
    onUser={user => {
      update(s => ({ ...s, user }));
      setAccountOpen(false);
      setToast(user.plan?.tier && user.plan.tier !== 'free' ? `Signed in as ${user.email} — EUREKA ${PLANS[user.plan.tier]?.name ?? ''} is active.` : `Signed in as ${user.email}`);
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
    appearance={appearance}
    onAppearance={chooseAppearance}
  />
  );
  const navCounts = {
    study: (study.plan?.sessions ?? []).filter(x => x.date === ymd(now) && x.status === 'planned').length,
    calendar: upcomingCount
  };

  return (
    <div className="app" data-layout={TOPBAR ? 'topbar' : undefined} data-sidebar={sidebar ? '' : undefined} data-runner={study.activeSession && !study.activeSession.min ? '' : undefined}>
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
          <Icon icon={Add01Icon} size={15} stroke={2} /> {areaName ? `New ${areaName} chat` : 'New conversation'}
        </button>

        <label className="search">
          <Icon icon={Search01Icon} size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" />
        </label>

        <div className="sidebar__scroll">
          {route === 'chat' ? (
            <>
              <div className="side-label side-label--row">
                Subjects
                <button type="button" className="link-btn" onClick={() => setSubjectsOpen(true)}>
                  {courses.length ? 'Edit' : 'Add subjects'}
                </button>
              </div>
              <div className="subjects">
                <BranchedMenu
                  key={`${area}:${courses.map(c => c.key).join(',')}`}
                  items={subjectItems.map(it => (it.children ? { ...it, children: it.children.map(k => ({ ...k, label: areaCount(k.value) ? `${k.label} · ${areaCount(k.value)}` : k.label })) } : it.value === 'General' && areaCount('General') ? { ...it, label: `General · ${areaCount('General')}` } : it))}
                  defaultOpen={subjectItems.flatMap((it, i) => (it.children ? [i] : []))}
                  defaultActive={area}
                  onSelect={openArea}
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
          <div className="side-label">{query.trim() ? 'Search results' : areaName ? `${areaName} chats` : 'Conversations'}</div>
          {sorted.recent.map(renderRow)}
          {sorted.pinned.length + sorted.recent.length === 0 ? <div className="side-empty">{query.trim() ? `No chats match “${query}”` : `No ${areaName || ''} chats yet`}</div> : null}
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
        {TOPBAR ? null : accountMenu}
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
        {TOPBAR ? (
          <>
            <header className="masthead">
              <button type="button" className="icon-btn masthead__menu" aria-label="Open menu" onClick={() => setSidebar(true)}>
                <Icon icon={Menu01Icon} />
              </button>
              <button type="button" className="masthead__logo" onClick={() => go('chat')} aria-label="EUREKA home">
                <Logo size={24} />
              </button>
              <nav className="masthead__nav" aria-label="Sections">
                <button type="button" data-active={route === 'chat' ? '' : undefined} onClick={() => go('chat')}>
                  Study chat
                </button>
                <button type="button" data-active={route === 'study' ? '' : undefined} onClick={() => go('study')}>
                  Revision {navCounts.study ? <span className="nav__count">{navCounts.study}</span> : null}
                </button>
                <button type="button" data-active={route === 'calendar' ? '' : undefined} onClick={() => go('calendar')}>
                  Calendar {navCounts.calendar ? <span className="nav__count">{navCounts.calendar}</span> : null}
                </button>
                <button type="button" data-active={timerOpen ? '' : undefined} onClick={() => setTimerOpen(o => !o)}>
                  Focus timer {timer.endsAt ? <span className="nav__count nav__count--live">●</span> : null}
                </button>
              </nav>
              <span className="masthead__spacer" />
              <button
                type="button"
                className="icon-btn masthead__search"
                aria-label="Search chats"
                onClick={() => {
                  setSidebar(true);
                  setTimeout(() => document.querySelector('.sidebar .search input')?.focus(), 250);
                }}
              >
                <Icon icon={Search01Icon} />
              </button>
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
              {state.user ? null : (
                <>
                  <button type="button" className="masthead__login" onClick={() => setAccountOpen(true)}>
                    Log In
                  </button>
                  <button type="button" className="btn masthead__signup" onClick={() => setAccountOpen(true)}>
                    Sign Up
                  </button>
                </>
              )}
              <div className="masthead__account" data-guest={state.user ? undefined : ''}>
                {accountMenu}
              </div>
            </header>
            {route === 'chat' ? (
              <div className="chatbar">
                <button type="button" className="btn btn--ghost-line btn--sm" onClick={() => setSidebar(true)}>
                  <Icon icon={Menu01Icon} size={14} /> Chats
                </button>
                <span className="chatbar__title">{areaName ? `${areaName} · ` : ''}{chat.title}</span>
                <label className="subject-pill subject-pill--select" title="Move this chat to another subject">
                  <Icon icon={Book02Icon} size={13} /> {chat.subject === 'General' ? 'General' : subjectLong(chat.subject)}
                  <select aria-label="Subject for this chat" value={chat.subject === 'General' || courseByKey.has(chat.subject) ? chat.subject : ''} onChange={e => e.target.value && moveChat(e.target.value)}>
                    {chat.subject !== 'General' && !courseByKey.has(chat.subject) ? <option value="">{chatLabel}</option> : null}
                    <option value="General">General</option>
                    {courses.map(c => (
                      <option key={c.key} value={c.key}>
                        {subjectLabel(c.key)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn btn--sm" onClick={startChat}>
                  <Icon icon={Add01Icon} size={14} stroke={2} /> New chat
                </button>
              </div>
            ) : PAGE_HEADS[route] ? (
              <div className="page-head">
                <h1>{PAGE_HEADS[route][0]}</h1>
                <p>{PAGE_HEADS[route][1]}</p>
              </div>
            ) : null}
          </>
        ) : (
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
            <label className="subject-pill subject-pill--select" title="Move this chat to another subject">
              <Icon icon={Book02Icon} size={13} /> {chat.subject === 'General' ? 'General' : subjectLong(chat.subject)}
              <select aria-label="Subject for this chat" value={chat.subject === 'General' || courseByKey.has(chat.subject) ? chat.subject : ''} onChange={e => e.target.value && moveChat(e.target.value)}>
                {chat.subject !== 'General' && !courseByKey.has(chat.subject) ? <option value="">{chatLabel}</option> : null}
                <option value="General">General</option>
                {courses.map(c => (
                  <option key={c.key} value={c.key}>
                    {subjectLabel(c.key)}
                  </option>
                ))}
              </select>
            </label>
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
        )}

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

        {route === 'usage' ? (
          isOwner ? (
            <UsageView />
          ) : (
            <section className="usage">
              <div className="usage__notice">This page is only for the site owner. Activate your owner key from the account menu first.</div>
            </section>
          )
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
                  {courses.length ? (
                    <div className="course-cards" aria-label="Your subjects">
                      {courses.map((c, i) => {
                        const topicsN = (study.topics?.[c.key] ?? []).length;
                        const chatsN = ws.chats.filter(x => x.subject === c.key && x.messages.length).length;
                        return (
                          <button key={c.key} type="button" className="course-card" data-tone={i % 3} onClick={() => openArea(c.key)}>
                            <span className="course-card__strip">{[c.qualification, c.board].filter(Boolean).join(' · ') || 'Your subject'}</span>
                            <span className="course-card__body">
                              <span className="course-card__icon" aria-hidden="true">
                                <Icon icon={iconFor(c.subject)} size={22} />
                              </span>
                              <strong>{c.subject}</strong>
                              <span>Chat with your tutor, revise its topics and practise exam questions — all in one place.</span>
                            </span>
                            <span className="course-card__foot">
                              <span>
                                <Icon icon={Book02Icon} size={14} /> {topicsN ? `${topicsN} topic${topicsN > 1 ? 's' : ''}` : 'No topics yet'}
                              </span>
                              <span>
                                <Icon icon={BubbleChatIcon} size={14} /> {chatsN} chat{chatsN === 1 ? '' : 's'}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="messages">
                  {chat.messages.map(m => (
                    <Message key={m.id} msg={m} onAction={a => (a === 'signin' ? setAccountOpen(true) : setDialog(a))} />
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
                        {custom ? <Icon icon={StarIcon} size={11} /> : PROMPT_ICONS[p] ? <Icon icon={PROMPT_ICONS[p]} size={13} /> : null}
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
          onSignIn={() => {
            setDialog(null);
            setAccountOpen(true);
          }}
          onCheckedOut={() => {
            // Whop opens in a new tab: keep checking here until the purchase shows up.
            let tries = 0;
            const check = async () => {
              const info = await refreshPlan(true);
              if (!(info?.tier && info.tier !== 'free') && ++tries < 24) setTimeout(check, 10_000);
            };
            setTimeout(check, 15_000);
          }}
        />
      ) : null}
      {dialog?.activate ? (
        <ActivateDialog
          returning={dialog.activate.returning}
          notFound={dialog.activate.notFound}
          email={dialog.activate.email ?? state.user?.email}
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
