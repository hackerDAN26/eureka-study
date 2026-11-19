// Deadlines → reminder times, notifications and .ics export.
export const EVENT_TYPES = ['Exam', 'Test', 'Homework', 'Coursework', 'Project', 'Assignment', 'Revision', 'Other'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const REMINDER_OPTIONS = [
  { days: 7, label: '1 week before' },
  { days: 3, label: '3 days before' },
  { days: 1, label: '1 day before' },
  { days: 0, label: 'On the day' }
];
export const defaultReminders = type => (type === 'Exam' || type === 'Test' ? [7, 3, 1, 0] : [3, 1, 0]);

export const dueOf = e => new Date(`${e.date}T${e.time || '09:00'}`);
export const ymd = d => d.toLocaleDateString('en-CA');

export function triggersFor(e) {
  const due = dueOf(e);
  return [...new Set(e.reminders ?? [])].map(days => {
    let at = new Date(`${e.date}T08:00`);
    at.setDate(at.getDate() - days);
    if (at >= due) at = new Date(due.getTime() - 60 * 60 * 1000);
    return { id: `${e.id}:${days}`, days, at };
  });
}

// Reminders that have gone off and still matter (event not done, not long past).
export function firedReminders(workspaces, now, dismissed = []) {
  const out = [];
  for (const ws of workspaces) {
    for (const e of ws.events ?? []) {
      if (e.done) continue;
      const due = dueOf(e);
      if (due.getTime() < now - 24 * 3600e3) continue;
      const fired = triggersFor(e).filter(t => t.at.getTime() <= now && !dismissed.includes(t.id));
      if (!fired.length) continue;
      const latest = fired.sort((a, b) => b.at - a.at)[0];
      out.push({ ...latest, event: e, workspace: ws });
    }
  }
  return out.sort((a, b) => dueOf(a.event) - dueOf(b.event));
}

export function relative(date, now = Date.now()) {
  const ms = date - now;
  const days = Math.round((new Date(ymd(date)) - new Date(ymd(new Date(now)))) / 86400e3);
  if (ms < 0 && days <= 0) return days === 0 ? 'Due earlier today' : `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) {
    const h = Math.max(1, Math.round(ms / 3600e3));
    return h <= 1 ? 'Due within the hour' : `Due today, in ${h} hours`;
  }
  if (days === 1) return 'Due tomorrow';
  if (days < 7) return `In ${days} days`;
  const w = Math.round(days / 7);
  return days < 28 ? `In ${w} week${w > 1 ? 's' : ''}` : `In ${days} days`;
}

export const fmtDue = e =>
  dueOf(e).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function deadlinesSummary(events, now = Date.now(), withinDays = 21) {
  return events
    .filter(e => !e.done && dueOf(e) > now - 3600e3 && dueOf(e) < now + withinDays * 86400e3)
    .sort((a, b) => dueOf(a) - dueOf(b))
    .slice(0, 12)
    .map(e => `- ${e.type}: "${e.title}"${e.subject && e.subject !== 'General' ? ` (${e.subject})` : ''} — ${fmtDue(e)}, ${relative(dueOf(e), now).toLowerCase()}, ${e.priority} priority`)
    .join('\n');
}

const icsText = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsStamp = d =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;

export function downloadIcs(events, name = 'eureka-deadlines') {
  const now = new Date();
  const utc = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EUREKA//Study Calendar//EN', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@eureka`,
      `DTSTAMP:${utc}`,
      `DTSTART:${icsStamp(dueOf(e))}`,
      'DURATION:PT1H',
      `SUMMARY:${icsText(`${e.type}: ${e.title}`)}`,
      `DESCRIPTION:${icsText([e.subject, e.description].filter(Boolean).join(' — '))}`
    );
    for (const d of e.reminders ?? []) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, `TRIGGER:${d === 0 ? '-PT1H' : `-P${d}D`}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.ics` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
