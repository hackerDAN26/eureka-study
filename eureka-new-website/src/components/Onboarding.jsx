import { useEffect, useMemo, useState } from 'react';
import { Add01Icon, ArrowLeft01Icon, Cancel01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Icon, LeafMark } from './ui';
import { fetchCatalog } from '../lib/ai';
import { uid } from '../lib/storage';
import { gradeScale } from '../lib/study';

export const courseKey = c => (c.id ? `${c.id}${c.level ? `:${c.level}` : ''}` : c.key);

export default function Onboarding({ initial = [], firstRun = false, roadmap: roadmapInitial = false, onSave, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(initial.length ? 2 : 1);
  const [quals, setQuals] = useState(() => new Set(initial.map(c => c.qualId).filter(Boolean)));
  const [activeQual, setActiveQual] = useState(initial[0]?.qualId ?? '');
  const [boardFor, setBoardFor] = useState({});
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(() => new Map(initial.map(c => [c.key, c])));
  const [custom, setCustom] = useState({ subject: '', board: '', qualification: '' });
  const [roadmap, setRoadmap] = useState(roadmapInitial);
  const setGrade = (c, field, value) => setPicked(prev => new Map(prev).set(c.key, { ...c, [field]: value }));

  useEffect(() => {
    fetchCatalog()
      .then(setCatalog)
      .catch(() => setLoadError('Couldn’t load the list of exam boards. You can still add your subjects by typing them in below.'));
  }, []);

  const qualList = catalog?.qualifications ?? [];
  const chosen = qualList.filter(q => quals.has(q.id));
  const tab = chosen.find(q => q.id === activeQual) ?? chosen[0];
  const board = tab ? (tab.boards.find(b => b.id === boardFor[tab.id]) ?? tab.boards[0]) : null;
  const subjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.subjects ?? []).filter(s => !q || s.name.toLowerCase().includes(q));
  }, [board, query]);

  const isPicked = sid => [...picked.values()].some(c => c.id === sid);
  const toggleSubject = s => {
    setPicked(prev => {
      const next = new Map(prev);
      const existing = [...next.values()].filter(c => c.id === s.id);
      if (existing.length) existing.forEach(c => next.delete(c.key));
      else {
        const c = {
          id: s.id,
          boardId: board.id,
          board: board.name,
          qualId: tab.id,
          qualification: tab.name,
          subject: s.name,
          level: tab.levels ? tab.levels[0] : ''
        };
        c.key = courseKey(c);
        next.set(c.key, c);
      }
      return next;
    });
  };
  const setLevel = (c, level) =>
    setPicked(prev => {
      const next = new Map(prev);
      next.delete(c.key);
      const u = { ...c, level };
      u.key = courseKey(u);
      next.set(u.key, u);
      return next;
    });
  const addCustom = e => {
    e.preventDefault();
    const subject = custom.subject.trim();
    if (!subject) return;
    const c = {
      key: `custom:${uid()}`,
      id: null,
      custom: true,
      subject,
      board: custom.board.trim(),
      qualification: custom.qualification.trim() || tab?.name || ''
    };
    setPicked(prev => new Map(prev).set(c.key, c));
    setCustom({ subject: '', board: '', qualification: custom.qualification });
  };

  const list = [...picked.values()];

  return (
    <div className="dialog onboard" role="dialog" aria-modal="true" aria-label="Choose your subjects">
      <div className="dialog__card dialog__card--wide onboard__card">
        <div className="onboard__head">
          <span className="brand-mark">
            <LeafMark />
          </span>
          <div>
            <h3>{firstRun ? 'Welcome to EUREKA' : 'Your subjects'}</h3>
            <p className="dialog__sub">
              {step === 1
                ? 'What are you studying? Pick every qualification that applies.'
                : step === 2
                  ? 'Choose your exam board and subjects. The tutor will follow your exact specifications.'
                  : 'Where are you now, and where do you want to be? EUREKA pitches questions and plans at your target.'}
            </p>
          </div>
          <span className="onboard__steps" aria-label={`Step ${step} of 3`}>
            <i data-on="" />
            <i data-on={step >= 2 ? '' : undefined} />
            <i data-on={step === 3 ? '' : undefined} />
          </span>
          {!firstRun ? (
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon icon={Cancel01Icon} />
            </button>
          ) : null}
        </div>

        {loadError ? <p className="form-error">{loadError}</p> : null}

        {step === 1 ? (
          <div className="qual-grid">
            {!catalog && !loadError ? <p className="fine">Loading qualifications…</p> : null}
            {qualList.map(q => (
              <button
                key={q.id}
                type="button"
                className="qual"
                aria-pressed={quals.has(q.id)}
                onClick={() =>
                  setQuals(prev => {
                    const next = new Set(prev);
                    if (next.has(q.id)) next.delete(q.id);
                    else next.add(q.id);
                    return next;
                  })
                }
              >
                <span className="qual__tick">
                  <Icon icon={Tick02Icon} size={12} stroke={2.6} />
                </span>
                <strong>{q.name}</strong>
                <span>{q.note}</span>
              </button>
            ))}
          </div>
        ) : step === 3 ? (
          <div className="grades">
            <div className="grades__head" aria-hidden="true">
              <span>Subject</span>
              <span>Current / predicted</span>
              <span>Target</span>
            </div>
            {list.map(c => {
              const scale = c.qualId ? gradeScale(c.qualId) : null;
              const field = f =>
                scale ? (
                  <select value={c[f] ?? ''} onChange={e => setGrade(c, f, e.target.value)} aria-label={`${c.subject} ${f === 'currentGrade' ? 'current' : 'target'} grade`}>
                    <option value="">—</option>
                    {scale.map(g => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={c[f] ?? ''} maxLength={6} placeholder="e.g. B" onChange={e => setGrade(c, f, e.target.value)} aria-label={`${c.subject} ${f === 'currentGrade' ? 'current' : 'target'} grade`} />
                );
              return (
                <div key={c.key} className="grades__row">
                  <div className="mine__text">
                    <strong>{c.subject}</strong>
                    <span>{[c.board, c.qualification, c.level].filter(Boolean).join(' · ')}</span>
                  </div>
                  {field('currentGrade')}
                  {field('targetGrade')}
                </div>
              );
            })}
            <label className="grades__roadmap">
              <input type="checkbox" checked={roadmap} onChange={e => setRoadmap(e.target.checked)} />
              <span>
                <strong>Create a study roadmap</strong>
                <span>Optional — a phase-by-phase plan from today to each exam (foundation → consolidation → exam mastery → final review). You can turn it on later in Study.</span>
              </span>
            </label>
          </div>
        ) : (
          <div className="pick">
            <div className="pick__main">
              {chosen.length ? (
                <>
                  <div className="pick__tabs" role="tablist">
                    {chosen.map(q => (
                      <button key={q.id} type="button" role="tab" aria-selected={tab?.id === q.id} onClick={() => setActiveQual(q.id)}>
                        {q.name}
                      </button>
                    ))}
                  </div>
                  {tab && tab.boards.length > 1 ? (
                    <div className="pick__boards" aria-label="Exam board">
                      <span>Exam board</span>
                      {tab.boards.map(b => (
                        <button key={b.id} type="button" aria-pressed={board?.id === b.id} onClick={() => setBoardFor(m => ({ ...m, [tab.id]: b.id }))}>
                          {b.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <label className="search pick__search">
                    <Icon icon={Search01Icon} size={14} />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${board?.name ?? ''} ${tab?.name ?? ''} subjects`} />
                  </label>
                  <div className="subject-chips">
                    {subjects.map(s => (
                      <button key={s.id} type="button" className="subject-chip" aria-pressed={isPicked(s.id)} onClick={() => toggleSubject(s)}>
                        {isPicked(s.id) ? <Icon icon={Tick02Icon} size={12} stroke={2.6} /> : null}
                        {s.name}
                      </button>
                    ))}
                    {subjects.length === 0 ? <p className="fine">No subjects match “{query}”. Add it yourself below.</p> : null}
                  </div>
                </>
              ) : (
                <p className="fine">Go back to pick a qualification, or add your subjects yourself below.</p>
              )}

              <form className="custom-course" onSubmit={addCustom}>
                <span className="custom-course__label">Can’t find a subject?</span>
                <input value={custom.subject} onChange={e => setCustom(c => ({ ...c, subject: e.target.value }))} placeholder="Subject" aria-label="Subject" />
                <input value={custom.board} onChange={e => setCustom(c => ({ ...c, board: e.target.value }))} placeholder="Exam board" aria-label="Exam board" />
                <input
                  value={custom.qualification}
                  onChange={e => setCustom(c => ({ ...c, qualification: e.target.value }))}
                  placeholder={tab?.name ?? 'Qualification'}
                  aria-label="Qualification"
                />
                <button type="submit" className="btn btn--ghost-line btn--sm" disabled={!custom.subject.trim()}>
                  <Icon icon={Add01Icon} size={13} stroke={2.2} /> Add
                </button>
              </form>
            </div>

            <aside className="pick__mine" aria-label="Your subjects">
              <h4>Your subjects ({list.length})</h4>
              {list.length === 0 ? <p className="fine">Tap subjects to add them here.</p> : null}
              {list.map(c => (
                <div key={c.key} className="mine">
                  <div className="mine__text">
                    <strong>{c.subject}</strong>
                    <span>{[/^IB/.test(c.qualification ?? '') ? '' : c.board, c.qualification].filter(Boolean).join(' · ')}</span>
                  </div>
                  {c.id && chosen.find(q => q.id === c.qualId)?.levels ? (
                    <span className="mine__levels">
                      {chosen
                        .find(q => q.id === c.qualId)
                        .levels.map(l => (
                          <button key={l} type="button" aria-pressed={c.level === l} onClick={() => setLevel(c, l)}>
                            {l}
                          </button>
                        ))}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${c.subject}`}
                    onClick={() =>
                      setPicked(prev => {
                        const next = new Map(prev);
                        next.delete(c.key);
                        return next;
                      })
                    }
                  >
                    <Icon icon={Cancel01Icon} size={13} />
                  </button>
                </div>
              ))}
            </aside>
          </div>
        )}

        <div className="dialog__row">
          {step >= 2 ? (
            <button type="button" className="btn btn--ghost" onClick={() => setStep(step - 1)}>
              <Icon icon={ArrowLeft01Icon} size={14} /> Back
            </button>
          ) : firstRun ? (
            <button type="button" className="btn btn--ghost" onClick={() => onSave([])}>
              Skip for now
            </button>
          ) : null}
          <span className="spacer" />
          {step === 1 ? (
            <button
              type="button"
              className="btn"
              disabled={quals.size === 0 && !loadError}
              onClick={() => {
                setActiveQual(chosen[0]?.id ?? '');
                setStep(2);
              }}
            >
              Next
            </button>
          ) : step === 2 ? (
            <button type="button" className="btn" disabled={list.length === 0} onClick={() => setStep(3)}>
              Next
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => onSave(list, { roadmap })}>
              {firstRun ? 'Start studying' : 'Save subjects'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
