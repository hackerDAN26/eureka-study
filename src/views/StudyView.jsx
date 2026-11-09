import { useEffect, useMemo, useState } from 'react';
import {
  Add01Icon,
  Analytics01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  Brain02Icon,
  Calendar03Icon,
  Cards01Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  Fire02Icon,
  Idea01Icon,
  PlayIcon,
  RefreshIcon,
  Route01Icon,
  SparklesIcon,
  Target02Icon,
  Timer02Icon
} from '@hugeicons/core-free-icons';
import { Icon } from '../components/ui';
import {
  ACTIVITIES,
  GRADES,
  RAG,
  TECHNIQUES,
  addDays,
  analytics,
  coachInsights,
  daysBetween,
  dueCards,
  gradeScale,
  logEntry,
  masteryOf,
  newCard,
  newTopic,
  recordAssessment,
  reviewCard,
  roadmap,
  setRag,
  ymd
} from '../lib/study';
import Planner from './Planner';

export const TABS = [
  { id: 'today', label: 'Today', icon: DashboardSquare01Icon },
  { id: 'plan', label: 'Timetable', icon: Calendar03Icon },
  { id: 'topics', label: 'Topics', icon: CheckListIcon },
  { id: 'practice', label: 'Exam practice', icon: Target02Icon },
  { id: 'cards', label: 'Flashcards', icon: Cards01Icon },
  { id: 'analytics', label: 'Analytics', icon: Analytics01Icon },
  { id: 'coach', label: 'Coach', icon: Idea01Icon },
  { id: 'roadmap', label: 'Roadmap', icon: Route01Icon }
];

const RAG_LABEL = { red: 'Red — not confident', amber: 'Amber — getting there', green: 'Green — confident' };
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmtDay = (d, today) => {
  const n = daysBetween(today, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};
const mins = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

export function RagDot({ rag }) {
  return <span className="rag-dot" data-rag={rag ?? 'none'} aria-label={rag ? RAG_LABEL[rag] : 'Not rated'} />;
}

function Bar({ value, rag }) {
  return (
    <span className="mbar" data-rag={rag ?? undefined}>
      <i style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </span>
  );
}

function Blocks({ blocks }) {
  const total = blocks.reduce((a, b) => a + b.minutes, 0) || 1;
  return (
    <span className="blocks" aria-label={blocks.map(b => `${ACTIVITIES[b.activity]?.name} ${b.minutes} minutes`).join(', ')}>
      {blocks.map((b, i) => (
        <i key={i} data-act={b.activity} style={{ flexGrow: b.minutes / total }} title={`${ACTIVITIES[b.activity]?.name} · ${b.minutes} min`} />
      ))}
    </span>
  );
}

function Empty({ icon, title, children, action }) {
  return (
    <div className="study-empty">
      <span className="study-empty__icon">
        <Icon icon={icon} size={22} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export default function StudyView(props) {
  const { study, patch, courses, exams, outstanding, now, subjectLabel, onEditSubjects, tab, onTab } = props;
  const today = ymd(now);
  const { planner, setPlanner } = props;
  const a = useMemo(() => analytics(study, courses, now), [study, courses, now]);
  const insights = useMemo(() => coachInsights(study, a, exams, now), [study, a, exams, now]);
  const topicById = useMemo(() => {
    const m = new Map();
    for (const [k, list] of Object.entries(study.topics ?? {})) for (const t of list) m.set(t.id, { ...t, courseKey: k });
    return m;
  }, [study.topics]);

  // Smart rescheduling: past sessions that weren't done are marked missed and the plan rebuilt.
  const missedWaiting = (study.plan?.sessions ?? []).filter(s => s.date < today && s.status === 'planned').length;
  useEffect(() => {
    if (missedWaiting) {
      patch(s => s, { replan: 'full' });
      props.setToast?.(`${missedWaiting} missed session${missedWaiting > 1 ? 's were' : ' was'} rescheduled into your plan.`);
    }
  }, [missedWaiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const shared = { ...props, a, insights, topicById, today, openPlanner: () => setPlanner(true) };
  const visibleTabs = TABS.filter(t => t.id !== 'roadmap' || study.roadmap || tab === 'roadmap');

  return (
    <div className="study">
      <div className="study__tabs" role="tablist" aria-label="Revision">
        {visibleTabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)}>
            <Icon icon={t.icon} size={14} /> {t.label}
            {t.id === 'cards' && a.dueCards ? <span className="nav__count">{a.dueCards}</span> : null}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="btn btn--sm" onClick={() => setPlanner(true)}>
          <Icon icon={SparklesIcon} size={14} /> {study.plan ? 'Exam planner' : 'Create my revision plan'}
        </button>
      </div>
      <div className="study__body">
        {!courses.length ? (
          <Empty icon={BookOpen01Icon} title="Add your subjects first" action={<button type="button" className="btn" onClick={onEditSubjects}>Choose subjects</button>}>
            EUREKA builds your plan from your exact courses, exam boards and grades.
          </Empty>
        ) : tab === 'plan' ? (
          <PlanTab {...shared} />
        ) : tab === 'topics' ? (
          <TopicsTab {...shared} />
        ) : tab === 'practice' ? (
          <PracticeTab {...shared} />
        ) : tab === 'cards' ? (
          <CardsTab {...shared} />
        ) : tab === 'analytics' ? (
          <AnalyticsTab {...shared} />
        ) : tab === 'coach' ? (
          <CoachTab {...shared} />
        ) : tab === 'roadmap' ? (
          <RoadmapTab {...shared} />
        ) : (
          <TodayTab {...shared} />
        )}
      </div>
      {planner ? (
        <Planner
          study={study}
          courses={courses}
          exams={exams}
          subjectLabel={subjectLabel}
          runTask={props.runTask}
          onAddExam={props.onAddExam}
          onRemoveExam={props.onRemoveExam}
          onClose={() => setPlanner(false)}
          onGenerate={next => {
            patch(s => ({ ...s, ...next }), { replan: 'force' });
            setPlanner(false);
            onTab('plan');
            props.setToast?.('Your revision timetable is ready. It updates itself as you study.');
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Today ───────────────────────────────────────────── */
function SessionCard({ s, topicById, subjectLabel, startSession, onSkip, compact }) {
  const names = s.topicIds.map(id => topicById.get(id)?.name).filter(Boolean);
  return (
    <div className="sess" data-status={s.status} data-kind={s.kind}>
      <div className="sess__time">
        <strong>{s.start}</strong>
        <span>{mins(s.minutes)}</span>
      </div>
      <div className="sess__main">
        <div className="sess__title">
          {names.length ? names.join(' + ') : 'Revision'}
          <span className="sess__kind">{{ learn: 'Learn', deepen: 'Deepen', practice: 'Practice', review: 'Spaced review', mock: 'Mixed exam practice', final: 'Final review' }[s.kind]}</span>
        </div>
        <div className="sess__sub">{subjectLabel(s.courseKey)}{compact ? '' : ` · ${s.reason}`}</div>
        <Blocks blocks={s.blocks} />
      </div>
      <div className="sess__actions">
        {s.status === 'planned' ? (
          <>
            <button type="button" className="btn btn--sm" onClick={() => startSession(s)}>
              <Icon icon={PlayIcon} size={12} /> Start
            </button>
            {onSkip ? (
              <button type="button" className="link-btn" onClick={() => onSkip(s)}>
                Skip
              </button>
            ) : null}
          </>
        ) : (
          <span className="sess__status">{s.status === 'done' ? '✓ Done' : s.status === 'missed' ? 'Missed — rescheduled' : 'Skipped'}</span>
        )}
      </div>
    </div>
  );
}

function TodayTab({ study, patch, a, insights, exams, outstanding, today, topicById, subjectLabel, startSession, onTab, openPlanner, startFocus, courses }) {
  const sessions = (study.plan?.sessions ?? []).filter(s => s.date === today);
  const nextDay = (study.plan?.sessions ?? []).find(s => s.date > today && s.status === 'planned');
  const upcoming = exams.filter(e => e.date >= today).sort((x, y) => (x.date < y.date ? -1 : 1));
  const skip = s =>
    patch(st => ({ ...st, plan: { ...st.plan, sessions: st.plan.sessions.map(x => (x.id === s.id ? { ...x, status: 'skipped' } : x)) } }), { replan: 'stable' });
  const doneToday = sessions.filter(s => s.status === 'done').length;
  return (
    <div className="today">
      <section className="tiles">
        <div className="tile">
          <span>
            <Icon icon={Fire02Icon} size={14} /> Streak
          </span>
          <strong>{a.streak} day{a.streak === 1 ? '' : 's'}</strong>
        </div>
        <div className="tile">
          <span>
            <Icon icon={Clock01Icon} size={14} /> Last 30 days
          </span>
          <strong>{mins(a.minutes30)}</strong>
        </div>
        <div className="tile">
          <span>
            <Icon icon={Target02Icon} size={14} /> Exam accuracy
          </span>
          <strong>{pct(a.accuracy)}</strong>
        </div>
        <div className="tile">
          <span>
            <Icon icon={Brain02Icon} size={14} /> Retention
          </span>
          <strong>{pct(a.retention)}</strong>
        </div>
        <div className="tile">
          <span>
            <Icon icon={CheckmarkCircle02Icon} size={14} /> Topics mastered
          </span>
          <strong>
            {a.strong}/{a.topics.length}
          </strong>
        </div>
      </section>

      {upcoming.length ? (
        <section className="countdowns" aria-label="Exam countdowns">
          {upcoming.slice(0, 4).map(e => {
            const c = a.byCourse.find(x => x.key === e.courseKey);
            const left = daysBetween(today, e.date);
            return (
              <div key={e.id} className="countdown" data-soon={left <= 7 ? '' : undefined}>
                <strong className="countdown__days">{left}</strong>
                <span className="countdown__unit">day{left === 1 ? '' : 's'}</span>
                <div className="countdown__text">
                  <b>{e.title}</b>
                  <span>
                    {fmtDay(e.date, today)} · {subjectLabel(e.courseKey)}
                  </span>
                  {c?.mastery != null ? <Bar value={c.mastery} /> : null}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      <div className="today__grid">
        <section className="panel">
          <header className="panel__head">
            <h3>Today’s plan</h3>
            <span className="fine">{sessions.length ? `${doneToday}/${sessions.length} done · ${mins(sessions.reduce((x, s) => x + s.minutes, 0))}` : ''}</span>
          </header>
          {!study.plan ? (
            <Empty icon={SparklesIcon} title="No plan yet" action={<button type="button" className="btn" onClick={openPlanner}>Create my revision plan</button>}>
              Tell EUREKA about your exams, topics, confidence and free time — it builds a day-by-day timetable that adapts as you study.
            </Empty>
          ) : sessions.length ? (
            sessions.map(s => <SessionCard key={s.id} s={s} topicById={topicById} subjectLabel={subjectLabel} startSession={startSession} onSkip={skip} />)
          ) : (
            <p className="fine">
              Nothing planned today — a rest day. {nextDay ? `Next: ${fmtDay(nextDay.date, today)} at ${nextDay.start}.` : ''}{' '}
              <button type="button" className="link-btn" onClick={() => startFocus({})}>
                Start a free focus session
              </button>
            </p>
          )}
        </section>

        <div className="today__side">
          <section className="panel">
            <header className="panel__head">
              <h3>Reviews due</h3>
            </header>
            <p className="fine">
              {a.dueCards} flashcard{a.dueCards === 1 ? '' : 's'} · {a.dueTopics} topic{a.dueTopics === 1 ? '' : 's'} due for spaced review
            </p>
            <button type="button" className="btn btn--ghost-line btn--sm" disabled={!a.dueCards} onClick={() => onTab('cards')}>
              <Icon icon={Cards01Icon} size={13} /> Review now
            </button>
          </section>

          <section className="panel">
            <header className="panel__head">
              <h3>Weak areas</h3>
              <button type="button" className="link-btn" onClick={() => onTab('topics')}>
                All topics
              </button>
            </header>
            {a.weak.length ? (
              <ul className="weak">
                {a.weak.slice(0, 5).map(t => (
                  <li key={t.id}>
                    <RagDot rag={t.rag} />
                    <span>
                      {t.name}
                      <small>{subjectLabel(t.courseKey)}</small>
                    </span>
                    <Bar value={t.m} rag={t.rag} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fine">Rate your topics red, amber or green and EUREKA will track them here.</p>
            )}
          </section>

          {outstanding.length ? (
            <section className="panel">
              <header className="panel__head">
                <h3>Outstanding work</h3>
              </header>
              <ul className="weak">
                {outstanding.slice(0, 4).map(e => (
                  <li key={e.id}>
                    <span className="rag-dot" data-rag="none" />
                    <span>
                      {e.title}
                      <small>
                        {e.type} · {fmtDay(e.date, today)}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {insights[0] ? (
            <section className="panel panel--coach">
              <header className="panel__head">
                <h3>
                  <Icon icon={Idea01Icon} size={14} /> Coach
                </h3>
                <button type="button" className="link-btn" onClick={() => onTab('coach')}>
                  More
                </button>
              </header>
              <strong>{insights[0].title}</strong>
              <p className="fine">{insights[0].action}</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Timetable ───────────────────────────────────────── */
function PlanTab({ study, patch, today, topicById, subjectLabel, startSession, openPlanner }) {
  const [range, setRange] = useState(14);
  if (!study.plan)
    return (
      <Empty icon={Calendar03Icon} title="No timetable yet" action={<button type="button" className="btn" onClick={openPlanner}>Open the exam planner</button>}>
        The planner asks about your exams, topics, confidence and available time, then generates a daily timetable.
      </Empty>
    );
  const end = addDays(today, range - 1);
  const list = study.plan.sessions.filter(s => s.date >= addDays(today, -3) && s.date <= end);
  const byDay = list.reduce((m, s) => m.set(s.date, [...(m.get(s.date) ?? []), s]), new Map());
  return (
    <div className="tt">
      <div className="tt__bar">
        {study.plan.notes?.map((n, i) => (
          <p key={i} className="tt__note" data-level={n.level}>
            {n.text}
          </p>
        ))}
        <div className="tt__actions">
          <div className="seg" role="group" aria-label="Range">
            {[7, 14, 28].map(n => (
              <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)}>
                {n} days
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn--ghost-line btn--sm" onClick={() => patch(s => s, { replan: 'full' })}>
            <Icon icon={RefreshIcon} size={13} /> Rebuild from my progress
          </button>
          <button type="button" className="btn btn--ghost-line btn--sm" onClick={openPlanner}>
            Edit exams & time
          </button>
        </div>
        <div className="legend">
          {Object.entries(ACTIVITIES).map(([k, v]) => (
            <span key={k}>
              <i data-act={k} /> {v.name}
            </span>
          ))}
        </div>
      </div>
      {[...byDay].map(([date, sessions]) => (
        <section key={date} className="tt__day" data-past={date < today ? '' : undefined}>
          <h4>
            {fmtDay(date, today)} <span>{mins(sessions.reduce((x, s) => x + s.minutes, 0))}</span>
          </h4>
          {sessions.map(s => (
            <SessionCard key={s.id} s={s} topicById={topicById} subjectLabel={subjectLabel} startSession={startSession} />
          ))}
        </section>
      ))}
      {!byDay.size ? <p className="fine">No sessions in this range.</p> : null}
    </div>
  );
}

/* ── Topics (RAG checklist) ──────────────────────────── */
function useCourseTab(courses, initial) {
  const [key, setKey] = useState(initial ?? courses[0]?.key);
  const course = courses.find(c => c.key === key) ?? courses[0];
  return [course, setKey];
}

function CourseTabs({ courses, course, setKey, subjectLabel, count }) {
  return (
    <div className="pick__tabs course-tabs" role="tablist">
      {courses.map(c => (
        <button key={c.key} type="button" role="tab" aria-selected={course?.key === c.key} onClick={() => setKey(c.key)}>
          {subjectLabel(c.key)}
          {count ? <span className="fine"> {count(c)}</span> : null}
        </button>
      ))}
    </div>
  );
}

function TopicsTab({ study, patch, courses, subjectLabel, runTask, askTutor, onTab, onGrade, today, setToast }) {
  const [course, setKey] = useCourseTab(courses);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(null);
  const list = study.topics?.[course.key] ?? [];
  const setList = (fn, replan = 'stable') => patch(s => ({ ...s, topics: { ...s.topics, [course.key]: fn(s.topics?.[course.key] ?? []) } }), { replan });
  const importTopics = async () => {
    setBusy(true);
    try {
      const data = await runTask('topics', course.key, {});
      const have = new Set(list.map(t => t.name.toLowerCase()));
      const fresh = data.topics
        .filter(t => t?.name && !have.has(String(t.name).toLowerCase()))
        .map(t => newTopic(t.name, { subtopics: (t.subtopics ?? []).slice(0, 8).map(String), weight: Math.round(Math.min(5, Math.max(1, t.weight ?? 3))), difficulty: Math.round(Math.min(5, Math.max(1, t.difficulty ?? 3))) }));
      setList(l => [...l, ...fresh]);
      setToast(`Added ${fresh.length} topics from the ${subjectLabel(course.key)} specification. Rate each one red, amber or green.`);
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const counts = c => {
    const l = study.topics?.[c.key] ?? [];
    return l.length ? `${l.filter(t => t.rag === 'green').length}/${l.length}` : '';
  };
  const scale = gradeScale(course.qualId);
  const gradeField = f =>
    course.qualId ? (
      <select value={course[f] ?? ''} onChange={e => onGrade(course.key, f, e.target.value)}>
        <option value="">—</option>
        {scale.map(g => (
          <option key={g}>{g}</option>
        ))}
      </select>
    ) : (
      <input value={course[f] ?? ''} maxLength={6} onChange={e => onGrade(course.key, f, e.target.value)} placeholder="—" />
    );
  return (
    <div className="topics">
      <CourseTabs courses={courses} course={course} setKey={setKey} subjectLabel={subjectLabel} count={counts} />
      <div className="topics__bar">
        <label className="grade-pick">
          Current {gradeField('currentGrade')}
        </label>
        <label className="grade-pick">
          Target {gradeField('targetGrade')}
        </label>
        <span className="spacer" />
        <button type="button" className="btn btn--sm" disabled={busy} onClick={importTopics}>
          <Icon icon={SparklesIcon} size={13} /> {busy ? 'Reading the specification…' : list.length ? 'Find missing spec topics' : 'Import topics from the specification'}
        </button>
      </div>
      <p className="fine topics__help">
        Your red/amber/green ratings tell the tutor what to explain more and decide how much time each topic gets. EUREKA updates them from your exam answers and reviews — your
        marks count for more than feelings.
      </p>
      {list.length === 0 ? (
        <Empty icon={CheckListIcon} title="No topics yet">
          Import the topics from your {course.board ? `${course.board} ` : ''}specification, or add them yourself below.
        </Empty>
      ) : (
        <div className="topic-list">
          {list.map(t => {
            const m = masteryOf(t, today);
            const mistakes = Object.entries(t.mistakes ?? {}).sort((x, y) => y[1] - x[1]);
            return (
              <div key={t.id} className="topic" data-rag={t.rag ?? 'none'}>
                <div className="topic__row">
                  <button type="button" className="topic__name" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                    {t.name}
                    <small>
                      {t.stats.questions ? `${t.stats.marks}/${t.stats.outOf} marks · ` : ''}
                      {t.srs?.due ? `review ${fmtDay(t.srs.due, today).toLowerCase()}` : 'not started'}
                    </small>
                  </button>
                  <Bar value={m} rag={t.rag} />
                  <span className="topic__pct">{Math.round(m * 100)}%</span>
                  <div className="rag" role="radiogroup" aria-label={`Confidence in ${t.name}`}>
                    {RAG.map(r => (
                      <button key={r} type="button" role="radio" aria-checked={t.rag === r} data-rag={r} title={RAG_LABEL[r]} onClick={() => setList(l => l.map(x => (x.id === t.id ? setRag(x, r) : x)))}>
                        {r[0].toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                {open === t.id ? (
                  <div className="topic__more">
                    {t.subtopics?.length ? <p className="fine">{t.subtopics.join(' · ')}</p> : null}
                    <div className="topic__fields">
                      <label>
                        Difficulty
                        <input type="range" min="1" max="5" value={t.difficulty} onChange={e => setList(l => l.map(x => (x.id === t.id ? { ...x, difficulty: +e.target.value } : x)))} />
                      </label>
                      <label>
                        Exam weight
                        <input type="range" min="1" max="5" value={t.weight} onChange={e => setList(l => l.map(x => (x.id === t.id ? { ...x, weight: +e.target.value } : x)))} />
                      </label>
                    </div>
                    {mistakes.length ? (
                      <p className="fine">
                        Recurring mistakes: {mistakes.slice(0, 4).map(([k, n]) => `${k} ×${n}`).join(' · ')}
                      </p>
                    ) : null}
                    <div className="topic__actions">
                      <button type="button" className="btn btn--ghost-line btn--sm" onClick={() => askTutor(course.key, `Explain "${t.name}" for my ${subjectLabel(course.key)} course. I've rated it ${t.rag ?? 'unrated'}. Start from where I am, use the specification's key terms, and check my understanding with a question.`, `${t.name} · explain`)}>
                        Explain with the tutor
                      </button>
                      <button type="button" className="btn btn--ghost-line btn--sm" onClick={() => onTab('practice', { courseKey: course.key, topicId: t.id })}>
                        Practise exam questions
                      </button>
                      <span className="spacer" />
                      <button type="button" className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => setList(l => l.filter(x => x.id !== t.id))}>
                        <Icon icon={Delete02Icon} size={14} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <form
        className="custom-course"
        onSubmit={e => {
          e.preventDefault();
          if (!name.trim()) return;
          setList(l => [...l, newTopic(name.trim())]);
          setName('');
        }}
      >
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Add a topic" aria-label="New topic" />
        <button type="submit" className="btn btn--ghost-line btn--sm" disabled={!name.trim()}>
          <Icon icon={Add01Icon} size={13} /> Add
        </button>
      </form>
    </div>
  );
}

/* ── Exam practice ───────────────────────────────────── */
function TopicPicker({ courses, course, setKey, topic, setTopic, list, subjectLabel }) {
  return (
    <div className="field-row">
      <label className="field">
        <span>Subject</span>
        <select value={course.key} onChange={e => setKey(e.target.value)}>
          {courses.map(c => (
            <option key={c.key} value={c.key}>
              {subjectLabel(c.key)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Topic</span>
        <select value={topic?.id ?? ''} onChange={e => setTopic(e.target.value)}>
          {list.map(t => (
            <option key={t.id} value={t.id}>
              {t.rag ? `${t.rag === 'red' ? '🔴' : t.rag === 'amber' ? '🟠' : '🟢'} ` : ''}
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function PracticeTab({ study, patch, courses, subjectLabel, runTask, focusTarget, today, reward, setToast, onTab }) {
  const [course, setKey] = useCourseTab(courses, focusTarget?.courseKey);
  const list = study.topics?.[course.key] ?? [];
  const weakest = [...list].sort((x, y) => masteryOf(x, today) - masteryOf(y, today))[0];
  const [topicId, setTopic] = useState(focusTarget?.topicId);
  const topic = list.find(t => t.id === topicId) ?? weakest;
  const cur = study.practice?.current?.courseKey === course.key ? study.practice.current : null;
  const [answer, setAnswer] = useState(cur?.answer ?? '');
  const [busy, setBusy] = useState('');
  const [started, setStarted] = useState(null);
  const setCur = c => patch(s => ({ ...s, practice: { ...s.practice, current: c } }));

  const generate = async () => {
    if (!topic) return;
    setBusy('question');
    try {
      const avoid = (study.practice?.history ?? []).filter(h => h.topicId === topic.id).slice(-5).map(h => h.question.slice(0, 120));
      const q = await runTask('question', course.key, {
        topic: topic.name,
        subtopic: topic.subtopics?.length ? topic.subtopics[Math.floor(Math.random() * topic.subtopics.length)] : '',
        rag: topic.rag ?? '',
        currentGrade: course.currentGrade ?? '',
        targetGrade: course.targetGrade ?? '',
        mistakes: Object.keys(topic.mistakes ?? {}).slice(0, 5),
        avoid
      });
      setAnswer('');
      setStarted(Date.now());
      setCur({ courseKey: course.key, topicId: topic.id, q, result: null, answer: '' });
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy('');
    }
  };
  const mark = async () => {
    setBusy('mark');
    try {
      const r = await runTask('mark', course.key, { question: cur.q.question, markScheme: cur.q.markScheme, marks: cur.q.marks, answer });
      const outOf = Number(r.outOf) || cur.q.marks;
      const score = Math.max(0, Math.min(outOf, Number(r.score) || 0));
      const minutes = started ? Math.max(1, Math.round((Date.now() - started) / 60000)) : cur.q.timeMinutes ?? 5;
      patch(
        s => {
          const tl = s.topics?.[course.key] ?? [];
          const topics = { ...s.topics, [course.key]: tl.map(t => (t.id === cur.topicId ? recordAssessment(t, score / outOf, { source: 'exam', marks: score, outOf, mistakes: r.mistakes ?? [], minutes, today }) : t)) };
          const history = [...(s.practice?.history ?? []), { at: Date.now(), courseKey: course.key, topicId: cur.topicId, question: cur.q.question, score, outOf }].slice(-80);
          return {
            ...s,
            topics,
            practice: { ...s.practice, current: { ...cur, answer, result: { ...r, score, outOf } }, history },
            log: [...(s.log ?? []), logEntry({ type: 'exam', courseKey: course.key, topicId: cur.topicId, activity: 'exam', minutes, score, outOf })].slice(-3000)
          };
        },
        { replan: 'stable' }
      );
      reward('question');
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy('');
    }
  };
  const toCards = () => {
    const r = cur.result;
    const cards = [newCard(cur.q.question.slice(0, 380), r.improvedAnswer ?? r.missing?.join('\n') ?? '')];
    patch(s => ({ ...s, topics: { ...s.topics, [course.key]: s.topics[course.key].map(t => (t.id === cur.topicId ? { ...t, cards: [...t.cards, ...cards] } : t)) } }));
    setToast('Added to your flashcards — it will come back for spaced review.');
  };

  if (!list.length)
    return (
      <div className="practice">
        <CourseTabs courses={courses} course={course} setKey={setKey} subjectLabel={subjectLabel} />
        <Empty icon={Target02Icon} title="Add topics first" action={<button type="button" className="btn" onClick={() => onTab('topics')}>Go to Topics</button>}>
          Questions are written for a specific topic of your {subjectLabel(course.key)} specification.
        </Empty>
      </div>
    );
  const r = cur?.result;
  return (
    <div className="practice">
      <TopicPicker courses={courses} course={course} setKey={setKey} topic={topic} setTopic={setTopic} list={list} subjectLabel={subjectLabel} />
      <div className="practice__bar">
        <button type="button" className="btn" disabled={Boolean(busy)} onClick={generate}>
          <Icon icon={SparklesIcon} size={14} /> {busy === 'question' ? 'Writing a question…' : cur ? 'New question' : 'Generate exam question'}
        </button>
        <span className="fine">
          Pitched at your target {course.targetGrade ? `(${course.targetGrade})` : 'grade'}, your confidence on this topic and your past mistakes.
        </span>
      </div>
      {cur ? (
        <article className="question">
          <header>
            <span className="qtag">{cur.q.commandWord ?? 'Question'}</span>
            <span className="qtag">
              {cur.q.marks} mark{cur.q.marks > 1 ? 's' : ''}
            </span>
            {cur.q.assessmentObjective ? <span className="qtag">{cur.q.assessmentObjective}</span> : null}
            {cur.q.timeMinutes ? (
              <span className="qtag">
                <Icon icon={Timer02Icon} size={11} /> ~{cur.q.timeMinutes} min
              </span>
            ) : null}
          </header>
          <p className="question__text">{cur.q.question}</p>
          {!r ? (
            <>
              <textarea className="answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Write your answer as you would in the exam…" rows={8} />
              <div className="dialog__row">
                <span className="fine">{answer.trim().split(/\s+/).filter(Boolean).length} words</span>
                <span className="spacer" />
                <button type="button" className="btn" disabled={!answer.trim() || Boolean(busy)} onClick={mark}>
                  {busy === 'mark' ? 'Marking like an examiner…' : 'Mark my answer'}
                </button>
              </div>
            </>
          ) : (
            <div className="result">
              <div className="result__score" data-good={r.score / r.outOf >= 0.7 ? '' : undefined}>
                <strong>
                  {r.score}/{r.outOf}
                </strong>
                <span>{r.feedback}</span>
              </div>
              <details open>
                <summary>Your answer</summary>
                <p className="result__answer">{cur.answer}</p>
              </details>
              {r.awarded?.length ? (
                <div className="result__list" data-kind="got">
                  <h5>Marks you earned</h5>
                  <ul>{r.awarded.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              ) : null}
              {r.missing?.length ? (
                <div className="result__list" data-kind="miss">
                  <h5>Missing marks — and how to get them</h5>
                  <ul>{r.missing.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              ) : null}
              {r.examinerTip ? (
                <p className="result__tip">
                  <b>Examiner’s tip:</b> {r.examinerTip}
                </p>
              ) : null}
              {r.improvedAnswer ? (
                <details>
                  <summary>Full-marks answer</summary>
                  <p className="result__answer">{r.improvedAnswer}</p>
                </details>
              ) : null}
              {r.mistakes?.length ? <p className="fine">Logged for your study plan: {r.mistakes.join(' · ')}</p> : null}
              <div className="dialog__row">
                <button type="button" className="btn btn--ghost-line btn--sm" onClick={toCards}>
                  <Icon icon={Cards01Icon} size={13} /> Save as flashcard
                </button>
                <span className="spacer" />
                <button type="button" className="btn" disabled={Boolean(busy)} onClick={generate}>
                  Next question <Icon icon={ArrowRight01Icon} size={13} />
                </button>
              </div>
            </div>
          )}
        </article>
      ) : null}
    </div>
  );
}

/* ── Flashcards ──────────────────────────────────────── */
function CardsTab({ study, patch, courses, subjectLabel, runTask, today, reward, setToast }) {
  const due = dueCards(study.topics, today);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [course, setKey] = useCourseTab(courses);
  const list = study.topics?.[course.key] ?? [];
  const [topicId, setTopic] = useState(null);
  const topic = list.find(t => t.id === topicId) ?? list[0];
  const [busy, setBusy] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const item = due[Math.min(i, due.length - 1)];

  const grade = q => {
    const { courseKey, topic: t, card } = item;
    patch(
      s => ({
        ...s,
        topics: { ...s.topics, [courseKey]: s.topics[courseKey].map(x => (x.id === t.id ? reviewCard(x, card.id, q, today) : x)) },
        log: [...(s.log ?? []), logEntry({ type: 'card', courseKey, topicId: t.id, activity: 'flashcards', minutes: 0.5, q })].slice(-3000)
      }),
      { replan: due.length <= 1 ? 'stable' : false }
    );
    reward('review');
    setShown(false);
    setI(0);
  };
  const make = async () => {
    setBusy(true);
    try {
      const data = await runTask('flashcards', course.key, { topic: topic.name, rag: topic.rag ?? '', count: 8, existing: topic.cards.map(c => c.front.slice(0, 80)) });
      const cards = data.cards.filter(c => c?.front && c?.back).map(c => newCard(c.front, c.back));
      patch(s => ({ ...s, topics: { ...s.topics, [course.key]: s.topics[course.key].map(t => (t.id === topic.id ? { ...t, cards: [...t.cards, ...cards] } : t)) } }));
      setToast(`${cards.length} new cards for ${topic.name}. They’re due now.`);
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const add = e => {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return;
    patch(s => ({ ...s, topics: { ...s.topics, [course.key]: s.topics[course.key].map(t => (t.id === topic.id ? { ...t, cards: [...t.cards, newCard(front.trim(), back.trim())] } : t)) } }));
    setFront('');
    setBack('');
  };

  return (
    <div className="cards">
      <section className="panel review">
        <header className="panel__head">
          <h3>Spaced review</h3>
          <span className="fine">{due.length} due</span>
        </header>
        {item ? (
          <>
            <div className="flash" data-shown={shown ? '' : undefined}>
              <span className="fine">
                {subjectLabel(item.courseKey)} · {item.topic.name}
              </span>
              <p className="flash__front">{item.card.front}</p>
              {shown ? <p className="flash__back">{item.card.back}</p> : null}
            </div>
            {shown ? (
              <div className="grades-row">
                {GRADES.map(g => (
                  <button key={g.id} type="button" className="btn btn--ghost-line" data-grade={g.id} onClick={() => grade(g.q)}>
                    {g.label}
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" className="btn" onClick={() => setShown(true)}>
                Say it, then show the answer
              </button>
            )}
            <p className="fine">Rate honestly — “Again” brings it back tomorrow, “Easy” pushes it weeks away. Each rating updates the topic’s mastery.</p>
          </>
        ) : (
          <p className="fine">All caught up. New and forgotten cards will appear here on the day they’re due.</p>
        )}
      </section>
      <section className="panel">
        <header className="panel__head">
          <h3>Make cards</h3>
        </header>
        {list.length ? (
          <>
            <TopicPicker courses={courses} course={course} setKey={setKey} topic={topic} setTopic={setTopic} list={list} subjectLabel={subjectLabel} />
            <button type="button" className="btn btn--sm" disabled={busy} onClick={make}>
              <Icon icon={SparklesIcon} size={13} /> {busy ? 'Writing cards…' : `Generate cards for ${topic?.name}`}
            </button>
            <form className="card-form" onSubmit={add}>
              <input value={front} onChange={e => setFront(e.target.value)} placeholder="Front (question)" aria-label="Card front" />
              <input value={back} onChange={e => setBack(e.target.value)} placeholder="Back (answer)" aria-label="Card back" />
              <button type="submit" className="btn btn--ghost-line btn--sm" disabled={!front.trim() || !back.trim()}>
                Add
              </button>
            </form>
            <p className="fine">{topic?.cards.length ?? 0} cards in this topic.</p>
          </>
        ) : (
          <p className="fine">Add topics in the Topics tab first.</p>
        )}
      </section>
    </div>
  );
}

/* ── Analytics ───────────────────────────────────────── */
function AnalyticsTab({ a, subjectLabel }) {
  const maxDay = Math.max(30, ...a.minutesByDay.map(d => d.minutes));
  const actTotal = Object.values(a.minutesByActivity).reduce((x, y) => x + y, 0) || 1;
  return (
    <div className="analytics">
      <section className="tiles">
        <div className="tile">
          <span>Exam-question accuracy</span>
          <strong>{pct(a.accuracy)}</strong>
          <small>{a.questions} question{a.questions === 1 ? '' : 's'} (30 days)</small>
        </div>
        <div className="tile">
          <span>Retention</span>
          <strong>{pct(a.retention)}</strong>
          <small>{a.reviews} card review{a.reviews === 1 ? '' : 's'}</small>
        </div>
        <div className="tile">
          <span>Study time</span>
          <strong>{mins(Math.round(a.minutes30))}</strong>
          <small>last 30 days</small>
        </div>
        <div className="tile">
          <span>This week</span>
          <strong>
            {a.week.done} done · {a.week.missed} missed
          </strong>
          <small>sessions</small>
        </div>
      </section>
      <div className="analytics__grid">
        <section className="panel">
          <h3>Study time, last 14 days</h3>
          <div className="daybars">
            {a.minutesByDay.map(d => (
              <span key={d.date} title={`${d.date}: ${Math.round(d.minutes)} min`}>
                <i style={{ height: `${(d.minutes / maxDay) * 100}%` }} />
                <small>{new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
              </span>
            ))}
          </div>
        </section>
        <section className="panel">
          <h3>Mastery by subject</h3>
          {a.byCourse.map(c => (
            <div key={c.key} className="mastery-row">
              <span>{subjectLabel(c.key)}</span>
              <span className="ragstack" aria-label={`${c.rag.red} red, ${c.rag.amber} amber, ${c.rag.green} green`}>
                {['red', 'amber', 'green', 'none'].map(r => (c.rag[r] ? <i key={r} data-rag={r} style={{ flexGrow: c.rag[r] }} /> : null))}
              </span>
              <b>{c.mastery == null ? '—' : pct(c.mastery)}</b>
            </div>
          ))}
        </section>
        <section className="panel">
          <h3>Where your time goes</h3>
          {Object.keys(ACTIVITIES).map(k => (
            <div key={k} className="mastery-row">
              <span>
                <i className="act-dot" data-act={k} /> {ACTIVITIES[k].name}
              </span>
              <span className="mbar">
                <i style={{ width: `${((a.minutesByActivity[k] ?? 0) / actTotal) * 100}%` }} />
              </span>
              <b>{mins(Math.round(a.minutesByActivity[k] ?? 0))}</b>
            </div>
          ))}
          {a.minutesByActivity.focus ? <p className="fine">Plus {mins(Math.round(a.minutesByActivity.focus))} of free focus-timer study.</p> : null}
        </section>
        <section className="panel">
          <h3>Exam-question trend</h3>
          {a.examTrend.length ? (
            <div className="trend">
              {a.examTrend.map((v, i) => (
                <i key={i} style={{ height: `${Math.max(4, v * 100)}%` }} data-good={v >= 0.7 ? '' : undefined} title={pct(v)} />
              ))}
            </div>
          ) : (
            <p className="fine">Answer exam questions in Practice to see your trend.</p>
          )}
          <h3>Recurring mistakes</h3>
          {a.mistakes.length ? (
            <ul className="mistakes">
              {a.mistakes.map(([k, n]) => (
                <li key={k}>
                  <span>{k}</span>
                  <b>×{n}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fine">None logged yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── Coach ───────────────────────────────────────────── */
function TechniqueCard({ id, askTutor, courseKey }) {
  const t = TECHNIQUES[id];
  return (
    <details className="tech">
      <summary>
        <strong>{t.name}</strong>
        <span>{t.what}</span>
      </summary>
      <p>
        <b>Why it works:</b> {t.why}
      </p>
      <ol>
        {t.how.map(h => (
          <li key={h}>{h}</li>
        ))}
      </ol>
      <p className="fine">When: {t.when}</p>
      {askTutor ? (
        <button type="button" className="btn btn--ghost-line btn--sm" onClick={() => askTutor(courseKey, `Teach me how to use ${t.name} for my revision, then guide me through it on one of my weakest topics right now, step by step.`, `Technique · ${t.name}`)}>
          Try it with the tutor
        </button>
      ) : null}
    </details>
  );
}

function CoachTab({ study, patch, a, insights, runTask, askTutor, courses, setToast }) {
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    try {
      const summary = JSON.stringify({
        minutesByActivity: a.minutesByActivity,
        minutes30: a.minutes30,
        accuracy: a.accuracy,
        retention: a.retention,
        dueReviews: a.dueCards + a.dueTopics,
        week: a.week,
        streak: a.streak,
        mistakes: a.mistakes,
        subjects: a.byCourse.map(c => ({ subject: c.subject, mastery: c.mastery, rag: c.rag, minutes: c.minutes })),
        weakTopics: a.weak.map(t => ({ name: t.name, rag: t.rag, mastery: Math.round(t.m * 100), minutes: t.stats?.minutes })),
        ruleFindings: insights.map(i => i.title)
      });
      const data = await runTask('coach', courses[0]?.key, { summary });
      patch(s => ({ ...s, coachAI: { at: Date.now(), insights: data.insights.slice(0, 4) } }));
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const all = [...insights, ...(study.coachAI?.insights ?? []).map((x, i) => ({ ...x, id: `ai${i}`, level: 'ai' }))];
  return (
    <div className="coach">
      <div className="coach__list">
        <div className="panel__head">
          <h3>Your study habits</h3>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={ask}>
            <Icon icon={SparklesIcon} size={13} /> {busy ? 'Analysing…' : 'Ask the AI coach'}
          </button>
        </div>
        {all.length ? (
          all.map(x => (
            <article key={x.id} className="insight" data-level={x.level}>
              <h4>{x.title}</h4>
              <p>{x.why}</p>
              <p className="insight__action">
                <Icon icon={ArrowRight01Icon} size={12} /> {x.action}
              </p>
              {x.technique && TECHNIQUES[x.technique] ? <span className="qtag">{TECHNIQUES[x.technique].name}</span> : null}
            </article>
          ))
        ) : (
          <p className="fine">Study for a few days and your coach will spot patterns — what’s working, and what to change.</p>
        )}
      </div>
      <div className="coach__lib">
        <h3>Evidence-based techniques</h3>
        <p className="fine">Every session in your timetable uses these. Tap one to learn why it works and how to do it.</p>
        {Object.keys(TECHNIQUES).map(id => (
          <TechniqueCard key={id} id={id} askTutor={askTutor} courseKey={courses[0]?.key} />
        ))}
      </div>
    </div>
  );
}

/* ── Roadmap ─────────────────────────────────────────── */
function RoadmapTab({ study, patch, exams, courses, today, openPlanner }) {
  const maps = roadmap(exams, courses, today);
  return (
    <div className="roadmap">
      <div className="panel__head">
        <label className="check">
          <input type="checkbox" checked={Boolean(study.roadmap)} onChange={e => patch(s => ({ ...s, roadmap: e.target.checked }))} />
          <span>Show my study roadmap</span>
        </label>
      </div>
      {!maps.length ? (
        <Empty icon={Route01Icon} title="Add an exam to see your roadmap" action={<button type="button" className="btn" onClick={openPlanner}>Add exams</button>}>
          The roadmap splits the time before each exam into phases, each with its own focus and techniques.
        </Empty>
      ) : (
        maps.map(m => (
          <section key={m.exam.id} className="road-map">
            <h4>
              {m.exam.title} <span className="fine">· {m.subject} · in {m.days} days</span>
            </h4>
            <div className="phases">
              {m.phases.map(p => {
                const now = today >= p.from && today < p.to;
                return (
                  <div key={p.id} className="phase" data-now={now ? '' : undefined} data-done={today >= p.to ? '' : undefined} style={{ flexGrow: Math.max(1, daysBetween(p.from, p.to)) }}>
                    <strong>{p.name}</strong>
                    <small>
                      {new Date(`${p.from}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {new Date(`${p.to}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </small>
                    <p>{p.focus}</p>
                    <span className="fine">{p.techniques.map(t => TECHNIQUES[t].name).join(' · ')}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
