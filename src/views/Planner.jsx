import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Add01Icon, ArrowLeft01Icon, Cancel01Icon, Delete02Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import { Icon } from '../components/ui';
import { DEFAULT_AVAILABILITY, RAG, addDays, buildPlan, daysBetween, newTopic, setRag, ymd } from '../lib/study';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STEPS = ['Exams', 'Topics & confidence', 'Study time', 'Your plan'];

export default function Planner({ study, courses, exams, subjectLabel, runTask, onAddExam, onRemoveExam, onClose, onGenerate }) {
  const today = ymd(Date.now());
  const [step, setStep] = useState(exams.length ? 1 : 0);
  const [topics, setTopics] = useState(() => study.topics ?? {});
  const [avail, setAvail] = useState(() => ({ ...DEFAULT_AVAILABILITY, ...study.availability }));
  const [roadmapOn, setRoadmapOn] = useState(Boolean(study.roadmap));
  const [form, setForm] = useState({ courseKey: courses[0]?.key ?? '', title: '', date: addDays(today, 28), paper: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [newName, setNewName] = useState({});
  const [dayOff, setDayOff] = useState('');

  const inScope = exams.length ? courses.filter(c => exams.some(e => e.courseKey === c.key)) : courses;
  const preview = useMemo(
    () => (step === 3 ? buildPlan({ courses, topicsByCourse: topics, exams, availability: avail, today }) : null),
    [step, courses, topics, exams, avail, today]
  );

  const addExam = e => {
    e.preventDefault();
    if (!form.courseKey || !form.date) return;
    onAddExam({ courseKey: form.courseKey, title: form.title.trim() || `${subjectLabel(form.courseKey)} exam`, date: form.date, paper: form.paper.trim() });
    setForm(f => ({ ...f, title: '', paper: '' }));
  };
  const importTopics = async c => {
    setBusy(c.key);
    setError('');
    try {
      const data = await runTask('topics', c.key, { paper: exams.find(e => e.courseKey === c.key)?.paper ?? '' });
      setTopics(all => {
        const have = new Set((all[c.key] ?? []).map(t => t.name.toLowerCase()));
        const fresh = data.topics
          .filter(t => t?.name && !have.has(String(t.name).toLowerCase()))
          .map(t => newTopic(t.name, { subtopics: (t.subtopics ?? []).slice(0, 8).map(String), weight: Math.round(Math.min(5, Math.max(1, t.weight ?? 3))), difficulty: Math.round(Math.min(5, Math.max(1, t.difficulty ?? 3))) }));
        return { ...all, [c.key]: [...(all[c.key] ?? []), ...fresh] };
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };
  const patchTopic = (key, id, fn) => setTopics(all => ({ ...all, [key]: all[key].map(t => (t.id === id ? fn(t) : t)) }));
  const unrated = inScope.reduce((n, c) => n + (topics[c.key] ?? []).filter(t => !t.rag).length, 0);
  const totalWeek = avail.minutes.reduce((a, b) => a + b, 0);

  return createPortal(
    <div className="dialog" role="dialog" aria-modal="true" aria-label="Exam planner">
      <div className="dialog__card dialog__card--wide planner">
        <div className="onboard__head">
          <div>
            <h3>Exam planner</h3>
            <p className="dialog__sub">{['Which exams or tests are you preparing for?', 'How confident are you on each topic? Be honest — it decides where your time goes.', 'How much time can you realistically study?', 'Here’s what EUREKA worked out.'][step]}</p>
          </div>
          <ol className="planner__steps">
            {STEPS.map((s, i) => (
              <li key={s} data-on={i <= step ? '' : undefined}>
                <button type="button" onClick={() => setStep(i)} disabled={i > 0 && !exams.length && !Object.keys(topics).length}>
                  {i + 1}. {s}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon icon={Cancel01Icon} />
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}

        <div className="planner__body">
          {step === 0 ? (
            <>
              {exams.length ? (
                <ul className="exam-list">
                  {exams.map(e => (
                    <li key={e.id}>
                      <strong>{e.title}</strong>
                      <span>
                        {subjectLabel(e.courseKey)} · {new Date(`${e.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · in {daysBetween(today, e.date)} days
                        {e.paper ? ` · ${e.paper}` : ''}
                      </span>
                      <button type="button" className="icon-btn" aria-label={`Remove ${e.title}`} onClick={() => onRemoveExam(e)}>
                        <Icon icon={Delete02Icon} size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="fine">No exams yet. Add each paper or test — they also appear in your calendar with reminders.</p>
              )}
              <form className="exam-form" onSubmit={addExam}>
                <label className="field">
                  <span>Subject</span>
                  <select value={form.courseKey} onChange={e => setForm(f => ({ ...f, courseKey: e.target.value }))}>
                    {courses.map(c => (
                      <option key={c.key} value={c.key}>
                        {subjectLabel(c.key)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Exam / test name</span>
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={`${subjectLabel(form.courseKey)} Paper 1`} />
                </label>
                <label className="field">
                  <span>Date</span>
                  <input type="date" min={today} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Topics covered (optional)</span>
                  <input value={form.paper} onChange={e => setForm(f => ({ ...f, paper: e.target.value }))} placeholder="e.g. Paper 1: topics 1–4" />
                </label>
                <button type="submit" className="btn btn--ghost-line btn--sm">
                  <Icon icon={Add01Icon} size={13} /> Add exam
                </button>
              </form>
            </>
          ) : step === 1 ? (
            <div className="planner__topics">
              {inScope.map(c => {
                const list = topics[c.key] ?? [];
                return (
                  <section key={c.key} className="planner__course">
                    <header>
                      <h4>{subjectLabel(c.key)}</h4>
                      <button type="button" className="btn btn--sm" disabled={Boolean(busy)} onClick={() => importTopics(c)}>
                        <Icon icon={SparklesIcon} size={13} /> {busy === c.key ? 'Reading the specification…' : list.length ? 'Find missing topics' : 'Get topics from the specification'}
                      </button>
                    </header>
                    {list.map(t => (
                      <div key={t.id} className="planner__topic">
                        <span>{t.name}</span>
                        <label className="mini" title="How hard is this for you? (1–5)">
                          Difficulty
                          <select value={t.difficulty} onChange={e => patchTopic(c.key, t.id, x => ({ ...x, difficulty: +e.target.value }))}>
                            {[1, 2, 3, 4, 5].map(n => (
                              <option key={n}>{n}</option>
                            ))}
                          </select>
                        </label>
                        <div className="rag" role="radiogroup" aria-label={`Confidence in ${t.name}`}>
                          {RAG.map(r => (
                            <button key={r} type="button" role="radio" aria-checked={t.rag === r} data-rag={r} onClick={() => patchTopic(c.key, t.id, x => setRag(x, r))}>
                              {r[0].toUpperCase()}
                            </button>
                          ))}
                        </div>
                        <button type="button" className="icon-btn" aria-label={`Remove ${t.name}`} onClick={() => setTopics(all => ({ ...all, [c.key]: all[c.key].filter(x => x.id !== t.id) }))}>
                          <Icon icon={Cancel01Icon} size={12} />
                        </button>
                      </div>
                    ))}
                    <form
                      className="custom-course"
                      onSubmit={e => {
                        e.preventDefault();
                        const n = (newName[c.key] ?? '').trim();
                        if (!n) return;
                        setTopics(all => ({ ...all, [c.key]: [...(all[c.key] ?? []), newTopic(n)] }));
                        setNewName(m => ({ ...m, [c.key]: '' }));
                      }}
                    >
                      <input value={newName[c.key] ?? ''} onChange={e => setNewName(m => ({ ...m, [c.key]: e.target.value }))} placeholder="Add a topic yourself" aria-label={`Add a topic to ${subjectLabel(c.key)}`} />
                      <button type="submit" className="btn btn--ghost-line btn--sm">
                        Add
                      </button>
                    </form>
                  </section>
                );
              })}
            </div>
          ) : step === 2 ? (
            <div className="avail">
              <div className="avail__days">
                {DAYS.map((d, i) => (
                  <label key={d} className="avail__day">
                    <span>{d}</span>
                    <input
                      type="range"
                      min="0"
                      max="300"
                      step="15"
                      value={avail.minutes[i]}
                      onChange={e => setAvail(a => ({ ...a, minutes: a.minutes.map((m, j) => (j === i ? +e.target.value : m)) }))}
                      aria-label={`${d} study minutes`}
                    />
                    <b>{avail.minutes[i] ? `${Math.floor(avail.minutes[i] / 60) ? `${Math.floor(avail.minutes[i] / 60)}h ` : ''}${avail.minutes[i] % 60 ? `${avail.minutes[i] % 60}m` : ''}` : 'Off'}</b>
                  </label>
                ))}
              </div>
              <p className="fine">About {Math.round(totalWeek / 60)} hours a week.</p>
              <div className="field-row">
                <label className="field">
                  <span>Session length</span>
                  <select value={avail.sessionLength} onChange={e => setAvail(a => ({ ...a, sessionLength: +e.target.value }))}>
                    {[25, 30, 40, 50, 60, 75, 90].map(n => (
                      <option key={n} value={n}>
                        {n} minutes
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Usually start at</span>
                  <input type="time" value={avail.start} onChange={e => setAvail(a => ({ ...a, start: e.target.value || '17:00' }))} />
                </label>
                <label className="field">
                  <span>Days off (holidays, events)</span>
                  <span className="dayoff">
                    <input type="date" min={today} value={dayOff} onChange={e => setDayOff(e.target.value)} />
                    <button
                      type="button"
                      className="btn btn--ghost-line btn--sm"
                      disabled={!dayOff}
                      onClick={() => {
                        setAvail(a => ({ ...a, daysOff: [...new Set([...(a.daysOff ?? []), dayOff])].sort() }));
                        setDayOff('');
                      }}
                    >
                      Add
                    </button>
                  </span>
                </label>
              </div>
              {avail.daysOff?.length ? (
                <div className="chips-row">
                  {avail.daysOff.map(d => (
                    <button key={d} type="button" className="qtag" onClick={() => setAvail(a => ({ ...a, daysOff: a.daysOff.filter(x => x !== d) }))}>
                      {d} ✕
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="review-plan">
              {preview.notes.map((n, i) => (
                <p key={i} className="tt__note" data-level={n.level}>
                  {n.text}
                </p>
              ))}
              {unrated ? <p className="tt__note" data-level="warn">{unrated} topic{unrated > 1 ? 's are' : ' is'} not rated yet — EUREKA treats them as amber-red until you answer questions on them.</p> : null}
              <div className="tiles">
                <div className="tile">
                  <span>Sessions</span>
                  <strong>{preview.sessions.length}</strong>
                </div>
                <div className="tile">
                  <span>Study time</span>
                  <strong>{Math.round(preview.sessions.reduce((a, s) => a + s.minutes, 0) / 60)}h</strong>
                </div>
                <div className="tile">
                  <span>Spaced reviews</span>
                  <strong>{preview.sessions.filter(s => s.kind === 'review').length}</strong>
                </div>
                <div className="tile">
                  <span>Exam practice</span>
                  <strong>{preview.sessions.filter(s => s.kind === 'mock' || s.kind === 'practice').length}</strong>
                </div>
              </div>
              <p className="fine">
                How it’s built: red, heavily-weighted and harder topics get more time; each topic comes back at growing intervals (spacing); subjects alternate (interleaving);
                sessions shift from learning to recall to exam questions as each exam gets closer; the day before an exam is a light review. Every question you answer and card you
                review updates the plan.
              </p>
              <label className="check">
                <input type="checkbox" checked={roadmapOn} onChange={e => setRoadmapOn(e.target.checked)} />
                <span>Also create a long-term study roadmap (phases from now to each exam)</span>
              </label>
            </div>
          )}
        </div>

        <div className="dialog__row">
          {step > 0 ? (
            <button type="button" className="btn btn--ghost" onClick={() => setStep(step - 1)}>
              <Icon icon={ArrowLeft01Icon} size={14} /> Back
            </button>
          ) : null}
          <span className="spacer" />
          {step < 3 ? (
            <button type="button" className="btn" disabled={step === 1 && !inScope.some(c => (topics[c.key] ?? []).length)} onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => onGenerate({ topics, availability: avail, roadmap: roadmapOn })}>
              Generate my timetable
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
