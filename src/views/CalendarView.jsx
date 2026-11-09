import { useMemo, useState } from 'react';
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Delete02Icon,
  Download04Icon,
  Tick02Icon
} from '@hugeicons/core-free-icons';
import { Icon, Modal } from '../components/ui';
import {
  EVENT_TYPES,
  PRIORITIES,
  REMINDER_OPTIONS,
  defaultReminders,
  downloadIcs,
  dueOf,
  fmtDue,
  relative,
  ymd
} from '../lib/reminders';
import { uid } from '../lib/storage';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function EventEditor({ initial, subjects, onSave, onDelete, onClose }) {
  const [e, setE] = useState(initial);
  const [custom, setCustom] = useState('');
  const set = patch => setE(x => ({ ...x, ...patch }));
  const toggleReminder = d => set({ reminders: e.reminders.includes(d) ? e.reminders.filter(x => x !== d) : [...e.reminders, d].sort((a, b) => b - a) });
  const customDays = e.reminders.filter(d => !REMINDER_OPTIONS.some(o => o.days === d));
  const valid = e.title.trim() && e.date;

  return (
    <Modal
      title={initial.title ? 'Edit deadline' : 'Add a deadline'}
      onClose={onClose}
      footer={
        <>
          {initial.title ? (
            <button type="button" className="btn btn--ghost danger-text" onClick={() => onDelete(e.id)}>
              <Icon icon={Delete02Icon} size={14} /> Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={!valid} onClick={() => onSave({ ...e, title: e.title.trim() })}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Title</span>
        <input autoFocus value={e.title} onChange={x => set({ title: x.target.value })} placeholder="e.g. Unit 3 test — market failure" />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Type</span>
          <select
            value={e.type}
            onChange={x => {
              const type = x.target.value;
              set({ type, reminders: initial.title ? e.reminders : defaultReminders(type) });
            }}
          >
            {EVENT_TYPES.map(t => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Subject</span>
          <select value={e.subject} onChange={x => set({ subject: x.target.value })}>
            {subjects.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Due date</span>
          <input type="date" value={e.date} onChange={x => set({ date: x.target.value })} />
        </label>
        <label className="field">
          <span>Due time</span>
          <input type="time" value={e.time} onChange={x => set({ time: x.target.value })} />
        </label>
        <label className="field">
          <span>Priority</span>
          <select value={e.priority} onChange={x => set({ priority: x.target.value })}>
            {PRIORITIES.map(p => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={e.description} onChange={x => set({ description: x.target.value })} placeholder="Topics, page numbers, what to bring…" />
      </label>
      <div className="field">
        <span>Reminders</span>
        <div className="checks">
          {REMINDER_OPTIONS.map(o => (
            <label key={o.days} className="check">
              <input type="checkbox" checked={e.reminders.includes(o.days)} onChange={() => toggleReminder(o.days)} />
              {o.label}
            </label>
          ))}
          {customDays.map(d => (
            <label key={d} className="check">
              <input type="checkbox" checked onChange={() => toggleReminder(d)} />
              {d} days before
            </label>
          ))}
          <span className="custom-rem">
            <input type="number" min="1" max="120" value={custom} onChange={x => setCustom(x.target.value)} placeholder="Custom" aria-label="Custom reminder, days before" />
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                const d = parseInt(custom, 10);
                if (d > 0 && !e.reminders.includes(d)) set({ reminders: [...e.reminders, d].sort((a, b) => b - a) });
                setCustom('');
              }}
            >
              days before · add
            </button>
          </span>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={e.done} onChange={x => set({ done: x.target.checked })} /> Completed
      </label>
    </Modal>
  );
}

export default function CalendarView({ events, subjects, workspaceName, onChange, onComplete, now }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [editing, setEditing] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const todayKey = ymd(new Date(now));

  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    for (const list of m.values()) list.sort((a, b) => dueOf(a) - dueOf(b));
    return m;
  }, [events]);

  const cells = useMemo(() => {
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const upcoming = events.filter(e => !e.done).sort((a, b) => dueOf(a) - dueOf(b));
  const done = events.filter(e => e.done).sort((a, b) => dueOf(b) - dueOf(a));

  const blank = date => ({
    id: uid(),
    title: '',
    type: 'Homework',
    subject: subjects[0],
    date,
    time: '09:00',
    priority: 'medium',
    description: '',
    done: false,
    reminders: defaultReminders('Homework')
  });

  const save = e => {
    if (e.done && !events.find(x => x.id === e.id)?.done) onComplete?.();
    onChange(list => (list.some(x => x.id === e.id) ? list.map(x => (x.id === e.id ? e : x)) : [...list, e]));
    setEditing(null);
  };

  const shift = n => setCursor(c => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <div className="cal">
      <div className="cal__main">
        <div className="cal__bar">
          <h2>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <div className="cal__nav">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>
              <Icon icon={ArrowLeft01Icon} />
            </button>
            <button
              type="button"
              className="btn btn--ghost-line btn--sm"
              onClick={() => {
                const d = new Date();
                setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
              }}
            >
              Today
            </button>
            <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>
              <Icon icon={ArrowRight01Icon} />
            </button>
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn--ghost-line btn--sm" disabled={!upcoming.length} onClick={() => downloadIcs(upcoming, `${workspaceName}-deadlines`)}>
            <Icon icon={Download04Icon} size={14} /> Add to my calendar app
          </button>
          <button type="button" className="btn btn--sm" onClick={() => setEditing(blank(todayKey))}>
            <Icon icon={Add01Icon} size={14} stroke={2.2} /> Add deadline
          </button>
        </div>

        <div className="month">
          {WEEKDAYS.map(d => (
            <div key={d} className="month__dow">
              {d}
            </div>
          ))}
          {cells.map(d => {
            const key = ymd(d);
            const list = byDay.get(key) ?? [];
            const out = d.getMonth() !== cursor.getMonth();
            return (
              <div
                key={key}
                className="day"
                data-out={out ? '' : undefined}
                data-today={key === todayKey ? '' : undefined}
                role="button"
                tabIndex={0}
                aria-label={`Add a deadline on ${d.toDateString()}`}
                onClick={() => setEditing(blank(key))}
                onKeyDown={x => x.key === 'Enter' && setEditing(blank(key))}
              >
                <span className="day__num">{d.getDate()}</span>
                <div className="day__events">
                  {list.slice(0, 3).map(e => (
                    <button
                      key={e.id}
                      type="button"
                      className="ev"
                      data-type={e.type}
                      data-priority={e.priority}
                      data-done={e.done ? '' : undefined}
                      title={`${e.type}: ${e.title} · ${fmtDue(e)}`}
                      onClick={x => {
                        x.stopPropagation();
                        setEditing(e);
                      }}
                    >
                      <span className="ev__time">{e.time}</span> {e.title}
                    </button>
                  ))}
                  {list.length > 3 ? <span className="day__more">+{list.length - 3} more</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="agenda" aria-label="Upcoming deadlines">
        <h3>
          <Icon icon={Calendar03Icon} size={16} /> Upcoming
        </h3>
        {upcoming.length === 0 ? (
          <div className="agenda__empty">
            <p>No deadlines yet.</p>
            <p>Add tests, homework and exams — EUREKA will remind you and the tutor will plan revision around them.</p>
          </div>
        ) : null}
        {upcoming.map(e => {
          const due = dueOf(e);
          const overdue = due < now;
          return (
            <div key={e.id} className="agenda__item" data-priority={e.priority} data-overdue={overdue ? '' : undefined}>
              <button
                type="button"
                className="tickbox"
                aria-label={`Mark ${e.title} complete`}
                onClick={() => {
                  onChange(list => list.map(x => (x.id === e.id ? { ...x, done: true } : x)));
                  onComplete?.();
                }}
              >
                <Icon icon={Tick02Icon} size={12} stroke={2.6} />
              </button>
              <button type="button" className="agenda__body" onClick={() => setEditing(e)}>
                <span className="agenda__title">{e.title}</span>
                <span className="agenda__meta">
                  <span className="type-dot" data-type={e.type} /> {e.type}
                  {e.subject !== 'General' ? ` · ${e.subject}` : ''} · {fmtDue(e)}
                </span>
                <span className="agenda__when">{relative(due, now)}</span>
              </button>
            </div>
          );
        })}
        {done.length ? (
          <>
            <button type="button" className="link-btn agenda__toggle" onClick={() => setShowDone(v => !v)}>
              {showDone ? 'Hide' : 'Show'} completed ({done.length})
            </button>
            {showDone
              ? done.map(e => (
                  <div key={e.id} className="agenda__item" data-done="">
                    <button
                      type="button"
                      className="tickbox"
                      data-on=""
                      aria-label={`Mark ${e.title} not done`}
                      onClick={() => onChange(list => list.map(x => (x.id === e.id ? { ...x, done: false } : x)))}
                    >
                      <Icon icon={Tick02Icon} size={12} stroke={2.6} />
                    </button>
                    <button type="button" className="agenda__body" onClick={() => setEditing(e)}>
                      <span className="agenda__title">{e.title}</span>
                      <span className="agenda__meta">{fmtDue(e)}</span>
                    </button>
                  </div>
                ))
              : null}
          </>
        ) : null}
      </aside>

      {editing ? (
        <EventEditor
          initial={editing}
          subjects={subjects}
          onSave={save}
          onDelete={id => {
            onChange(list => list.filter(x => x.id !== id));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
