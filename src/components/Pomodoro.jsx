import { useEffect, useRef, useState } from 'react';
import { Cancel01Icon, PauseIcon, PlayIcon, RefreshIcon, Settings02Icon, StopIcon } from '@hugeicons/core-free-icons';
import { Icon } from './ui';

const LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break', done: 'Set complete' };
// Focus blocks that ended more than this long ago (tab closed, laptop asleep) aren't counted.
const STALE_MS = 60 * 60 * 1000;
const fmt = s => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.22, 0.44].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = [523, 659, 784][i];
      g.gain.setValueAtTime(0.12, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.4);
    });
  } catch {}
}

// timer: { phase: focus|short|long|done, cycle (1…cycles), endsAt (running) | left (paused, seconds),
//          setMinutes, setBlocks, expired, label, courseKey, topicId, todayFocus }
// One set = `cycles` focus blocks with short breaks between, then one long break, then it stops.
export default function Pomodoro({ settings, timer, onSettings, onTimer, onLog, onClose, notify, collapsed, onExpand }) {
  const [, tick] = useState(0);
  const [editing, setEditing] = useState(false);
  const done = timer.phase === 'done';
  const running = Boolean(timer.endsAt) && !done;
  const total = done ? 1 : settings[timer.phase] * 60;
  const left = done ? 0 : running ? (timer.endsAt - Date.now()) / 1000 : timer.left ?? total;

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(id);
  }, [running]);

  // Phase finished: log focus time, chime, and line up the next phase (paused until Start).
  // The set ends after the last focus block's long break — it never loops forever.
  const handled = useRef(null);
  useEffect(() => {
    if (!running || left > 0) return;
    // Each phase ends once, even if React renders again before the new state is saved.
    if (handled.current === timer.endsAt) return;
    handled.current = timer.endsAt;
    const stale = -left * 1000 > STALE_MS;
    const phase = timer.phase;
    const wasFocus = phase === 'focus';
    if (wasFocus && !stale) onLog(settings.focus, timer);
    const nextPhase = wasFocus ? (timer.cycle >= settings.cycles ? 'long' : 'short') : phase === 'short' ? 'focus' : 'done';
    if (!stale) {
      if (settings.sound) chime();
      notify?.(
        wasFocus
          ? nextPhase === 'long'
            ? `Focus block ${timer.cycle} of ${settings.cycles} done — set finished, take a ${settings.long}-minute long break.`
            : `Focus block ${timer.cycle} of ${settings.cycles} done — take a ${settings.short}-minute break.`
          : nextPhase === 'done'
            ? 'Long break over — that’s a full set. Nice work.'
            : `Break over — ready for focus block ${timer.cycle + 1} of ${settings.cycles}?`
      );
    }
    onTimer(t => ({
      ...t,
      phase: nextPhase,
      cycle: phase === 'short' ? Math.min(settings.cycles, t.cycle + 1) : t.cycle,
      endsAt: null,
      left: nextPhase === 'done' ? null : settings[nextPhase] * 60,
      setMinutes: (t.setMinutes ?? 0) + (wasFocus && !stale ? settings.focus : 0),
      setBlocks: (t.setBlocks ?? 0) + (wasFocus && !stale ? 1 : 0),
      expired: stale
    }));
  });

  const fresh = { phase: 'focus', cycle: 1, endsAt: null, left: null, setMinutes: 0, setBlocks: 0, expired: false };
  const start = () => onTimer(t => ({ ...t, expired: false, endsAt: Date.now() + (t.left ?? settings[t.phase] * 60) * 1000, left: null }));
  const pause = () => onTimer(t => ({ ...t, left: Math.max(0, (t.endsAt - Date.now()) / 1000), endsAt: null }));
  const spentFocus = () => (timer.phase === 'focus' ? Math.round((total - Math.max(0, left)) / 60) : 0);
  // Stop: log the focus minutes so far and end the set.
  const stop = () => {
    const spent = spentFocus();
    if (spent >= 1) onLog(spent, timer);
    onTimer(t => ({ ...t, ...fresh }));
  };
  // Skip: move to the next phase in the set (a part-done focus block still counts its minutes).
  const skip = () => {
    const spent = spentFocus();
    if (spent >= 1) onLog(spent, timer);
    onTimer(t => {
      const next = t.phase === 'focus' ? (t.cycle >= settings.cycles ? 'long' : 'short') : t.phase === 'short' ? 'focus' : 'done';
      return { ...t, phase: next, cycle: t.phase === 'short' ? Math.min(settings.cycles, t.cycle + 1) : t.cycle, endsAt: null, left: null, setMinutes: (t.setMinutes ?? 0) + spent, setBlocks: (t.setBlocks ?? 0) + (spent >= 1 ? 1 : 0) };
    });
  };
  const ring = 2 * Math.PI * 34;
  if (collapsed)
    return (
      <button type="button" className="runner-pill pomo-pill" data-phase={timer.phase} onClick={onExpand}>
        <span className="runner-pill__dot" data-on={running ? '' : undefined} />
        {LABEL[timer.phase]} · {fmt(left)}
      </button>
    );
  const frac = Math.max(0, Math.min(1, left / total));

  return (
    <div className="pomo" data-phase={timer.phase} role="timer" aria-label={`${LABEL[timer.phase]} ${fmt(left)}`}>
      <div className="pomo__top">
        <span className="pomo__phase">
          {done ? LABEL.done : timer.phase === 'long' ? `${LABEL.long} · end of set` : `${LABEL[timer.phase]} · ${timer.cycle}/${settings.cycles}`}
        </span>
        <button type="button" className="icon-btn" aria-label="Timer settings" onClick={() => setEditing(e => !e)}>
          <Icon icon={Settings02Icon} size={13} />
        </button>
        <button type="button" className="icon-btn" aria-label="Close timer" onClick={onClose}>
          <Icon icon={Cancel01Icon} size={13} />
        </button>
      </div>
      {editing ? (
        <div className="pomo__settings">
          {[
            ['focus', 'Focus', 5, 120],
            ['short', 'Short break', 1, 30],
            ['long', 'Long break', 5, 60],
            ['cycles', 'Focus blocks before a long break', 2, 8]
          ].map(([k, label, min, max]) => (
            <label key={k}>
              <span>{label}</span>
              <input type="number" min={min} max={max} value={settings[k]} onChange={e => onSettings({ ...settings, [k]: Math.max(min, Math.min(max, +e.target.value || min)) })} />
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={settings.sound} onChange={e => onSettings({ ...settings, sound: e.target.checked })} />
            <span>Sound</span>
          </label>
          <button type="button" className="btn btn--sm" onClick={() => { onTimer(t => ({ ...t, ...(t.endsAt ? {} : { left: null }), cycle: Math.min(t.cycle, settings.cycles) })); setEditing(false); }}>
            Done
          </button>
        </div>
      ) : done ? (
        <div className="pomo__done">
          <strong>{timer.setBlocks ?? 0} focus block{timer.setBlocks === 1 ? '' : 's'}</strong>
          <span>{Math.round(timer.setMinutes ?? 0)} minutes of focused study in this set.</span>
          <p className="fine">Rest properly before the next one — a walk, water, no phone scrolling. Spaced sessions beat one marathon.</p>
          <button type="button" className="btn btn--sm" onClick={() => onTimer(t => ({ ...t, ...fresh }))}>
            Start another set
          </button>
          <button type="button" className="link-btn" onClick={() => { onTimer(t => ({ ...t, ...fresh })); onClose(); }}>
            Close timer
          </button>
          <p className="pomo__today">{Math.round(timer.todayFocus ?? 0)} min focused today</p>
        </div>
      ) : (
        <>
          {timer.expired ? <p className="pomo__label">That block ran out while you were away, so it wasn’t counted.</p> : null}
          <div className="pomo__dial">
            <svg viewBox="0 0 80 80" aria-hidden="true">
              <circle cx="40" cy="40" r="34" className="pomo__track" />
              <circle cx="40" cy="40" r="34" className="pomo__ring" strokeDasharray={ring} strokeDashoffset={ring * (1 - frac)} />
            </svg>
            <strong>{fmt(left)}</strong>
          </div>
          {timer.label ? <p className="pomo__label">{timer.label}</p> : null}
          <div className="pomo__dots" aria-label={`Focus block ${timer.cycle} of ${settings.cycles}`}>
            {Array.from({ length: settings.cycles }, (_, i) => (
              <i key={i} data-on={i < (timer.setBlocks ?? 0) ? '' : undefined} data-now={i === timer.cycle - 1 && timer.phase === 'focus' ? '' : undefined} />
            ))}
          </div>
          <div className="pomo__ctrl">
            <button type="button" className="icon-btn" aria-label="Stop and end the set" title="Stop and end the set" onClick={stop}>
              <Icon icon={StopIcon} size={14} />
            </button>
            <button type="button" className="pomo__main" aria-label={running ? 'Pause' : 'Start'} onClick={running ? pause : start}>
              <Icon icon={running ? PauseIcon : PlayIcon} size={18} />
            </button>
            <button type="button" className="icon-btn" aria-label="Skip to the next phase" title="Skip to the next phase" onClick={skip}>
              <Icon icon={RefreshIcon} size={14} />
            </button>
          </div>
          <p className="pomo__today">{Math.round(timer.todayFocus ?? 0)} min focused today</p>
        </>
      )}
    </div>
  );
}
