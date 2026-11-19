import { useEffect, useRef, useState } from 'react';
import { ArrowRight01Icon, Cancel01Icon, MinusSignIcon, PauseIcon, PlayIcon } from '@hugeicons/core-free-icons';
import { Icon } from './ui';
import { ACTIVITIES, TECHNIQUES } from '../lib/study';

const fmt = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

// What the tutor is asked to do for each step of a guided session.
export function stepPrompt(activity, topics, subject, minutes, mistakes) {
  const t = topics.join('", "');
  return {
    learn: `Guided session, step "Learn" (${minutes} min) on "${t}" for ${subject}. Teach it step by step from the specification: the key ideas, definitions and one worked example — only what fits ${minutes} minutes. Then ask me one question to check I understood.`,
    understand: `Guided session, step "Feynman" (${minutes} min) on "${t}". Ask me to explain the topic in simple words as if to a 12-year-old. When I reply, point out gaps, vague parts and misconceptions, then help me simplify my explanation.`,
    recall: `Guided session, step "Blurting" (${minutes} min) on "${t}". I'll write everything I remember without notes. When I send it, compare it with the ${subject} specification and list exactly what I missed or got wrong, then give me 3 quick recall questions on the gaps.`,
    flashcards: `Guided session, step "Retrieval" (${minutes} min) on "${t}". Quiz me with short questions one at a time, wait for my answer, mark it, and keep going on what I get wrong.`,
    exam: `Guided session, step "Exam questions" (${minutes} min) on "${t}". Give me one exam-style question in the board's style with the mark count. Wait for my answer, then mark it strictly against a mark scheme and tell me exactly which marks I missed.`,
    fix: `Guided session, step "Error analysis" (${minutes} min) on "${t}". ${mistakes?.length ? `My logged mistakes are: ${mistakes.join('; ')}.` : 'Ask me which mistakes I keep making.'} For each, explain the misconception briefly and give me one targeted question to prove it's fixed.`,
    consolidate: `Guided session, step "Consolidate" (${minutes} min) on "${t}". Help me build a text mind map of how the ideas connect (and link to other ${subject} topics), then ask me 3 linking questions.`
  }[activity];
}

export default function SessionRunner({ run, topicById, subjectLabel, onPatch, onTutor, onPractice, onCards, onFinish, onAbandon }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!run.runningSince) return undefined;
    const id = setInterval(() => tick(n => n + 1), 500);
    return () => clearInterval(id);
  }, [run.runningSince]);
  const s = run.session;
  const topics = s.topicIds.map(id => topicById.get(id)).filter(Boolean);
  const names = topics.map(t => t.name);
  const subject = subjectLabel(s.courseKey);
  const finishing = run.step >= s.blocks.length;
  const block = s.blocks[Math.min(run.step, s.blocks.length - 1)];
  const spentNow = (run.spent[run.step] ?? 0) + (run.runningSince ? (Date.now() - run.runningSince) / 1000 : 0);
  const left = block.minutes * 60 - spentNow;
  const tech = TECHNIQUES[block.technique];
  const [ratings, setRatings] = useState(() => Object.fromEntries(topics.map(t => [t.id, 3])));

  const beeped = useRef(null);
  useEffect(() => {
    if (run.runningSince && left <= 0 && beeped.current !== `${run.step}:${run.runningSince}`) {
      beeped.current = `${run.step}:${run.runningSince}`;
      try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        o.frequency.value = 660;
        o.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.25);
      } catch {}
      pause();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  function pause() {
    onPatch(r => (r.runningSince ? { ...r, runningSince: null, spent: Object.assign([...r.spent], { [r.step]: (r.spent[r.step] ?? 0) + (Date.now() - r.runningSince) / 1000 }) } : r));
  }
  const start = () => onPatch(r => ({ ...r, runningSince: Date.now() }));
  const next = () =>
    onPatch(r => {
      const spent = [...r.spent];
      spent[r.step] = (spent[r.step] ?? 0) + (r.runningSince ? (Date.now() - r.runningSince) / 1000 : 0);
      return { ...r, spent, step: r.step + 1, runningSince: r.step + 1 < s.blocks.length ? Date.now() : null };
    });

  if (run.min)
    return (
      <button type="button" className="runner-pill" onClick={() => onPatch(r => ({ ...r, min: false }))}>
        <span className="runner-pill__dot" data-on={run.runningSince ? '' : undefined} />
        {finishing ? 'Finish your session' : `${ACTIVITIES[block.activity].name} · ${fmt(left)}`}
      </button>
    );

  return (
    <aside className="runner" aria-label="Guided study session">
      <header className="runner__head">
        <div>
          <span className="fine">{subject} · guided session</span>
          <h3>{names.join(' + ') || 'Revision'}</h3>
        </div>
        <button type="button" className="icon-btn" aria-label="Minimise" onClick={() => onPatch(r => ({ ...r, min: true }))}>
          <Icon icon={MinusSignIcon} size={14} />
        </button>
        <button type="button" className="icon-btn" aria-label="End session" onClick={onAbandon}>
          <Icon icon={Cancel01Icon} size={14} />
        </button>
      </header>
      <ol className="runner__steps">
        {s.blocks.map((b, i) => (
          <li key={i} data-state={i < run.step ? 'done' : i === run.step ? 'now' : 'next'}>
            <span>{ACTIVITIES[b.activity].name}</span>
            <small>{b.minutes}m</small>
          </li>
        ))}
        <li data-state={finishing ? 'now' : 'next'}>
          <span>Reflect</span>
        </li>
      </ol>

      {!finishing ? (
        <div className="runner__step">
          <div className="runner__clock" data-over={left < 0 ? '' : undefined}>
            <strong>{fmt(left)}</strong>
            <button type="button" className="icon-btn" aria-label={run.runningSince ? 'Pause' : 'Start'} onClick={run.runningSince ? pause : start}>
              <Icon icon={run.runningSince ? PauseIcon : PlayIcon} size={16} />
            </button>
          </div>
          <p className="runner__obj">
            <b>Objective:</b> {block.reason || ACTIVITIES[block.activity].why}
          </p>
          <div className="runner__tech">
            <strong>{tech?.name}</strong>
            <ol>
              {tech?.how.map(h => (
                <li key={h}>{h}</li>
              ))}
            </ol>
            <p className="fine">Why: {tech?.why}</p>
          </div>
          <div className="runner__do">
            {block.activity === 'exam' ? (
              <button type="button" className="btn btn--sm" onClick={() => onPractice(s.courseKey, topics[0]?.id)}>
                Open exam practice
              </button>
            ) : null}
            {block.activity === 'flashcards' ? (
              <button type="button" className="btn btn--sm" onClick={onCards}>
                Review flashcards
              </button>
            ) : null}
            <button
              type="button"
              className={block.activity === 'exam' || block.activity === 'flashcards' ? 'btn btn--ghost-line btn--sm' : 'btn btn--sm'}
              onClick={() =>
                onTutor(
                  s.courseKey,
                  stepPrompt(
                    block.activity,
                    names,
                    subject,
                    block.minutes,
                    topics.flatMap(t => Object.keys(t.mistakes ?? {})).slice(0, 5)
                  ),
                  `${names[0] ?? 'Session'} · ${ACTIVITIES[block.activity].name}`
                )
              }
            >
              Do this step with the tutor
            </button>
          </div>
          <div className="dialog__row">
            <span className="spacer" />
            <button type="button" className="btn btn--ghost-line btn--sm" onClick={next}>
              {run.step + 1 < s.blocks.length ? 'Next step' : 'Finish & reflect'} <Icon icon={ArrowRight01Icon} size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="runner__step">
          <p>
            <b>How well could you recall this now, without notes?</b> Your answer updates mastery, the red/amber/green rating, and when this comes back for review.
          </p>
          {topics.map(t => (
            <div key={t.id} className="rate">
              <span>{t.name}</span>
              <div className="rate__scale" role="radiogroup" aria-label={`Recall of ${t.name}`}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" role="radio" aria-checked={ratings[t.id] === n} onClick={() => setRatings(r => ({ ...r, [t.id]: n }))}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="fine">1 = couldn’t recall it · 3 = parts of it · 5 = all of it, confidently</p>
          <div className="dialog__row">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => onFinish(ratings, run.spent)}>
              Finish session
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
