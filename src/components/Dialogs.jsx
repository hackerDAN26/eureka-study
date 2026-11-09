import { useState } from 'react';
import {
  Copy01Icon,
  CrownIcon,
  Delete02Icon,
  Download04Icon,
  Leaf01Icon,
  LockIcon,
  Mail01Icon,
  Tick02Icon,
  Upload04Icon
} from '@hugeicons/core-free-icons';
import { Avatar, Icon, Modal } from './ui';
import { CONTACT_EMAIL, PLANS, PLAN_ORDER, YEARLY_DISCOUNT, checkoutUrl, money, price } from '../lib/plans';
import { EARN, EXAM_YEAR, LOYALTY, TIERS, activeSeason, loyaltyStatus, nextSeason, nextTier, offersFor, tierFor, timeLeft, welcomeOffer } from '../lib/promos';
import { activatePlan, checkConnection, testModels } from '../lib/ai';
import { getClientId, setClientId } from '../lib/auth';
import { downloadWorkspace, readWorkspaceFile, shareLink } from '../lib/share';

const mailto = (to, subject, body) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
const openMail = href => {
  const a = Object.assign(document.createElement('a'), { href, target: '_top' });
  a.click();
};

/* ── Plans ─────────────────────────────────────────────── */
export function PlansDialog({ current, billing: currentBilling, user, offerCtx, onExamYear, onRewards, onClose, onDowngrade, onActivate }) {
  const [billing, setBilling] = useState(currentBilling || 'monthly');
  const [notice, setNotice] = useState('');
  const now = offerCtx.now;
  const season = activeSeason(now);
  const upcoming = season ? null : nextSeason(now);
  const welcome = welcomeOffer(offerCtx.firstSeen, now, offerCtx.hasPaid);
  const bestFor = id => offersFor({ ...offerCtx, planId: id, billing })[0] ?? null;

  const choose = id => {
    if (id === 'free') {
      onDowngrade();
      setNotice('You’re on the Free plan now. Your workspaces and chats are kept. To stop paying, cancel your membership at whop.com → Your orders.');
      return;
    }
    const offer = bestFor(id);
    const p = price(PLANS[id], billing, offer?.percent ?? 0);
    const link = checkoutUrl(id, billing, { email: user?.email, code: offer?.code });
    if (link) {
      const isWhop = /whop\.com/.test(link);
      if (offer?.code) navigator.clipboard?.writeText(offer.code).catch(() => {});
      window.open(link, '_blank', 'noopener');
      setNotice(
        isWhop && offer
          ? `Whop checkout opened in a new tab. Enter promo code ${offer.code} (copied) for −${offer.percent}%. After paying, come back and choose “Activate my plan” with the license key from your Whop receipt.`
          : `Checkout opened in a new tab${offer ? ` with code ${offer.code} (−${offer.percent}%)` : ''}. After paying, choose “Activate my plan” and enter the license key from your receipt.`
      );
      return;
    }
    openMail(
      mailto(
        CONTACT_EMAIL,
        `Upgrade to EUREKA ${PLANS[id].name} (${billing})`,
        `Hi EUREKA team,\n\nI'd like to upgrade to ${PLANS[id].name}, billed ${billing}: ${money(p.total)} ${billing === 'yearly' ? 'for the first year' : 'for the first month'}${offer ? ` with ${offer.name} (code ${offer.code}, −${offer.percent}%)` : ''}.\n\nAccount email: ${user?.email || '(not signed in)'}\n\nThanks!`
      )
    );
    setNotice('Online checkout isn’t switched on yet, so we’ve opened an email to the EUREKA team to upgrade you (your discount code is included).');
  };

  return (
    <Modal title="Choose your plan" subtitle="Upgrade, downgrade or switch billing any time." onClose={onClose} wide>
      {season ? (
        <div className="promo-banner" data-season={season.id}>
          <span className="promo-banner__tag">{season.name}</span>
          <div className="promo-banner__text">
            <strong>
              {season.percent}% off Pro & Max · code {season.code}
            </strong>
            <span>
              {season.tagline}. Bonus: {season.bonus.label}.
            </span>
          </div>
          <span className="promo-banner__clock">{timeLeft(season.end, now)}</span>
        </div>
      ) : upcoming ? (
        <p className="fine">
          Next sale: {upcoming.name} ({upcoming.percent}% off) starts {upcoming.start.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.
        </p>
      ) : null}
      {welcome ? (
        <div className="promo-banner promo-banner--welcome">
          <span className="promo-banner__tag">Welcome</span>
          <div className="promo-banner__text">
            <strong>
              {welcome.percent}% off your first month · code {welcome.code}
            </strong>
            <span>A limited-time thank-you for joining EUREKA. Monthly plans only.</span>
          </div>
          <span className="promo-banner__clock">{timeLeft(welcome.end, now)}</span>
        </div>
      ) : null}

      <div className="plans-bar">
        <div className="billing-toggle" role="radiogroup" aria-label="Billing period">
          <button type="button" role="radio" aria-checked={billing === 'monthly'} onClick={() => setBilling('monthly')}>
            Monthly
          </button>
          <button type="button" role="radio" aria-checked={billing === 'yearly'} onClick={() => setBilling('yearly')}>
            Yearly <span className="save">Save {Math.round(YEARLY_DISCOUNT * 100)}%</span>
          </button>
        </div>
        <label className="check exam-year">
          <input type="checkbox" checked={Boolean(offerCtx.examYear)} onChange={e => onExamYear(e.target.checked)} />
          <span>
            This is my exam year <em>(Year 11, Year 13, IB/AP final year) · {EXAM_YEAR.percent}% off yearly plans</em>
          </span>
        </label>
      </div>

      <div className="plans">
        {PLAN_ORDER.map(id => {
          const P = PLANS[id];
          const offer = bestFor(id);
          const p = price(P, billing, offer?.percent ?? 0);
          const isCurrent = id === current && (id === 'free' || billing === currentBilling);
          return (
            <article key={id} className="plan" data-plan={id} data-current={isCurrent ? '' : undefined}>
              {id === 'pro' ? <span className="plan__flag">Most popular</span> : null}
              <h4>
                {id !== 'free' ? <Icon icon={CrownIcon} size={15} /> : null} {P.name}
              </h4>
              <p className="plan__tag">{P.tagline}</p>
              <div className="plan__price">
                {offer ? <s>{money(p.listPerMonth)}</s> : null}
                <strong>{P.monthly ? money(p.perMonth) : '$0'}</strong>
                <span>{P.monthly ? '/ month' : 'forever'}</span>
              </div>
              <p className="plan__bill">
                {!P.monthly
                  ? 'No card needed'
                  : billing === 'yearly'
                    ? `${money(p.total)} billed yearly${offer ? ` (first year)` : ''} · was ${money(P.monthly * 12)}`
                    : `Billed monthly${offer ? ' · first month' : ''} · ${money(price(P, 'yearly').total)}/yr if yearly`}
              </p>
              {offer ? (
                <p className="plan__offer">
                  −{offer.percent}% {offer.name} · <code>{offer.code}</code>
                  {offer.ends ? <em> · {timeLeft(offer.ends, now)}</em> : null}
                </p>
              ) : null}
              <button type="button" className={`btn${id === 'free' ? ' btn--ghost-line' : ''}`} disabled={isCurrent} onClick={() => choose(id)}>
                {isCurrent ? 'Current plan' : id === 'free' ? 'Switch to Free' : PLAN_ORDER.indexOf(id) > PLAN_ORDER.indexOf(current) ? `Upgrade to ${P.name}` : `Switch to ${P.name}`}
              </button>
              <ul>
                {P.features.map(f => (
                  <li key={f}>
                    <Icon icon={Tick02Icon} size={13} stroke={2.4} /> {f}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
      {onActivate ? (
        <p className="activate-hint">
          Already paid?{' '}
          <button type="button" className="link-btn" onClick={onActivate}>
            Activate my plan with my license key
          </button>
        </p>
      ) : null}
      <p className="fine">
        Prices in USD. Yearly plans are {Math.round(YEARLY_DISCOUNT * 100)}% off the monthly price. One discount per purchase — we apply your best one
        automatically, for your first month or first year. Cancel any time; access continues to the end of the paid period.{' '}
        <button type="button" className="link-btn" onClick={onRewards}>
          Rewards & loyalty discounts
        </button>
      </p>
    </Modal>
  );
}

/* ── Rewards & loyalty ──────────────────────────────────── */
export function RewardsDialog({ rewards, plan, now, onPlans, onClose }) {
  const points = rewards?.points ?? 0;
  const tier = tierFor(points);
  const next = nextTier(points);
  const pct = next ? Math.min(100, ((points - tier.min) / (next.min - tier.min)) * 100) : 100;
  const loyal = loyaltyStatus(plan, now);
  const season = activeSeason(now);
  return (
    <Modal title="Rewards" subtitle="Earn Leaves as you study. Higher tiers unlock bigger perks." onClose={onClose} wide>
      <div className="rewards">
        <section className="rw-card rw-card--hero">
          <div className="rw-points">
            <Icon icon={Leaf01Icon} size={22} />
            <strong>{points.toLocaleString()}</strong>
            <span>Leaves</span>
          </div>
          <div className="rw-tier">
            <span className="tier-badge" data-tier={tier.id}>
              {tier.name}
            </span>
            {next ? (
              <span className="fine">
                {(next.min - points).toLocaleString()} Leaves to {next.name}
              </span>
            ) : (
              <span className="fine">Top tier reached</span>
            )}
          </div>
          <div className="meter__track rw-track">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="fine">
            Study streak: <strong>{rewards?.streak ?? 0} day{rewards?.streak === 1 ? '' : 's'}</strong>
            {season?.bonus.type === 'points' ? ` · ${season.name}: ${season.bonus.label}` : ''}
          </p>
        </section>

        <section className="rw-card">
          <h4>Tiers & perks</h4>
          <table className="rw-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Leaves</th>
                <th>Perks</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map(t => (
                <tr key={t.id} data-current={t.id === tier.id ? '' : undefined}>
                  <td>
                    <span className="tier-badge" data-tier={t.id}>
                      {t.name}
                    </span>
                  </td>
                  <td>{t.min.toLocaleString()}+</td>
                  <td>
                    {t.messages || t.prompts || t.percent
                      ? [t.messages && `+${t.messages} AI messages/day`, t.prompts && `+${t.prompts} saved prompts`, t.percent && `${t.percent}% off plans`].filter(Boolean).join(' · ')
                      : 'Where everyone starts'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rw-card">
          <h4>How to earn</h4>
          <ul className="rw-earn">
            {Object.entries(EARN).map(([k, e]) => (
              <li key={k}>
                <span>{e.label}</span>
                <em>{e.note}</em>
              </li>
            ))}
          </ul>
        </section>

        <section className="rw-card">
          <h4>Loyalty program</h4>
          <p className="fine">Stay on Pro or Max and your renewals get cheaper.</p>
          <div className="loyalty">
            {LOYALTY.map(l => (
              <div key={l.id} className="loyal-step" data-on={loyal.months >= l.months ? '' : undefined}>
                <strong>{l.name}</strong>
                <span>{l.months} months</span>
                <em>{l.percent}% off renewals</em>
              </div>
            ))}
          </div>
          <p className="fine">
            {plan.tier === 'free'
              ? 'Start a Pro or Max plan to begin earning loyalty discounts — plus 150 Leaves every month.'
              : loyal.level
                ? `You’re ${loyal.level.name}: ${loyal.level.percent}% off renewals (code ${loyal.level.code}).${loyal.next ? ` ${loyal.next.months - loyal.months} more month(s) to ${loyal.next.name}.` : ''}`
                : `${loyal.months} month(s) subscribed — ${loyal.next.months - loyal.months} more to ${loyal.next.name}.`}
          </p>
          <button type="button" className="btn btn--sm" onClick={onPlans}>
            See plans & offers
          </button>
        </section>

        {rewards?.history?.length ? (
          <section className="rw-card rw-card--wide">
            <h4>Recent Leaves</h4>
            <ul className="rw-history">
              {rewards.history.slice(0, 8).map((h, i) => (
                <li key={i}>
                  <span>{h.label}</span>
                  <em>+{h.points}</em>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <p className="fine">Leaves have no cash value. Perks and discounts may change; one discount applies per purchase.</p>
    </Modal>
  );
}

/* ── Share workspace ───────────────────────────────────── */
const ROLES = ['Admin', 'Editor', 'Viewer'];

export function ShareDialog({ workspace, user, limits, onMembers, onImport, onUpgrade, onClose }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Editor');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const members = workspace.members ?? [];
  const canShare = limits.members > 0;
  const full = members.length >= limits.members;

  const invite = async e => {
    e.preventDefault();
    setError('');
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return setError('Enter a valid email address.');
    if (members.some(m => m.email === addr) || addr === user?.email) return setError('That person is already in this workspace.');
    if (full) return setError(`Your plan allows ${limits.members} people per workspace.`);

    const link = await shareLink(workspace);
    const file = link ? null : downloadWorkspace(workspace);
    const from = user?.name || 'A classmate';
    const body = [
      'Hi,',
      '',
      `${from} has invited you to the EUREKA study workspace "${workspace.name}" as ${role.toLowerCase()}.`,
      '',
      link
        ? `Open it in EUREKA: ${link}`
        : `The workspace is attached as "${file}". Open EUREKA, choose Share workspace → Import a workspace file, and pick it.`,
      '',
      'EUREKA — organised, intelligent studying.'
    ].join('\n');
    onMembers([...members, { email: addr, role, status: 'Invited', invitedAt: Date.now() }]);
    openMail(mailto(addr, `${from} invited you to "${workspace.name}" on EUREKA`, body));
    setEmail('');
    setNotice(link ? `Invite email opened for ${addr}.` : `Invite email opened for ${addr}. We downloaded ${file} — attach it to the email before sending.`);
  };

  const importFile = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => {
      try {
        onImport(await readWorkspaceFile(input.files[0]));
        onClose();
      } catch (err) {
        setError(err.message);
      }
    };
    input.click();
  };

  return (
    <Modal title={`Share “${workspace.name}”`} subtitle="Invite classmates by email and choose what they can do." onClose={onClose}>
      {canShare ? (
        <form className="invite" onSubmit={invite}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="classmate@school.org" aria-label="Email address" />
          <select value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
            {ROLES.map(r => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button type="submit" className="btn" disabled={full}>
            <Icon icon={Mail01Icon} size={14} /> Invite
          </button>
        </form>
      ) : (
        <div className="locked">
          <Icon icon={LockIcon} size={16} />
          <span>Sharing workspaces is part of Pro and Max.</span>
          <button type="button" className="btn" onClick={onUpgrade}>
            See plans
          </button>
        </div>
      )}
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="members">
        <div className="member">
          <Avatar user={user} size={30} />
          <div className="member__who">
            <strong>{user ? user.name : 'You'}</strong>
            <span>{user?.email || 'Sign in to show your name on invites'}</span>
          </div>
          <span className="role-tag">Owner</span>
        </div>
        {members.map(m => (
          <div key={m.email} className="member">
            <Avatar user={{ name: m.email }} size={30} />
            <div className="member__who">
              <strong>{m.email}</strong>
              <span>{m.status} · {new Date(m.invitedAt).toLocaleDateString()}</span>
            </div>
            <select value={m.role} aria-label={`Role for ${m.email}`} onChange={e => onMembers(members.map(x => (x.email === m.email ? { ...x, role: e.target.value } : x)))}>
              {ROLES.map(r => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <button type="button" className="icon-btn" aria-label={`Remove ${m.email}`} onClick={() => onMembers(members.filter(x => x.email !== m.email))}>
              <Icon icon={Delete02Icon} size={14} />
            </button>
          </div>
        ))}
      </div>
      {canShare ? <p className="fine">{members.length} of {limits.members} invites used on your plan.</p> : null}

      <div className="share-tools">
        <button type="button" className="btn btn--ghost-line" onClick={() => setNotice(`Downloaded ${downloadWorkspace(workspace)}.`)}>
          <Icon icon={Download04Icon} size={14} /> Export workspace file
        </button>
        <button type="button" className="btn btn--ghost-line" onClick={importFile}>
          <Icon icon={Upload04Icon} size={14} /> Import a workspace file
        </button>
      </div>
      <p className="fine">
        Invites go out from your own email app. Each person gets a copy of the workspace’s chats and deadlines; live syncing between members
        arrives with EUREKA accounts on the server. Attached files aren’t included — share those separately.
      </p>
    </Modal>
  );
}

/* ── Contact ───────────────────────────────────────────── */
const TOPICS = ['General question', 'Billing & plans', 'Report a problem', 'Feature request', 'Privacy request', 'Partnerships'];

export function ContactDialog({ user, onClose }) {
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title="Contact EUREKA"
      subtitle="We usually reply within two working days."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!message.trim()}
            onClick={() => {
              openMail(mailto(CONTACT_EMAIL, `[EUREKA] ${topic}`, `${message.trim()}\n\n—\n${user ? `${user.name} <${user.email}>` : 'Sent from EUREKA'}`));
              onClose();
            }}
          >
            <Icon icon={Mail01Icon} size={14} /> Write email
          </button>
        </>
      }
    >
      <div className="contact-addr">
        <span>{CONTACT_EMAIL}</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            navigator.clipboard?.writeText(CONTACT_EMAIL);
            setCopied(true);
          }}
        >
          <Icon icon={copied ? Tick02Icon : Copy01Icon} size={13} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <label className="field">
        <span>Topic</span>
        <select value={topic} onChange={e => setTopic(e.target.value)}>
          {TOPICS.map(t => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Message</span>
        <textarea rows={5} value={message} onChange={e => setMessage(e.target.value)} placeholder="How can we help?" />
      </label>
    </Modal>
  );
}

/* ── Settings ──────────────────────────────────────────── */
export function SettingsDialog({ plan, settings, onSettings, onPreviewPlan, onUpgrade, onEditSubjects, onClose }) {
  const [conn, setConn] = useState({ state: 'idle' });
  const [modelTest, setModelTest] = useState(null);
  const [client, setClient] = useState(getClientId());
  const [tutor, setTutor] = useState(settings.tutorInstructions || '');
  const maxOnly = !PLANS[plan].limits.customTutor;
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setClientId(client.trim());
              onSettings({ tutorInstructions: maxOnly ? settings.tutorInstructions : tutor.trim() });
              onClose(true);
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <span>My subjects</span>
        <div className="conn">
          <button type="button" className="btn btn--ghost-line btn--sm" onClick={onEditSubjects}>
            Edit subjects & exam boards
          </button>
          <span className="conn__note">The tutor follows the specification for each subject you choose.</span>
        </div>
      </div>
      <label className="field">
        <span>
          Custom tutor instructions {maxOnly ? <em className="lock-tag"><Icon icon={LockIcon} size={11} /> Max</em> : null}
        </span>
        <textarea
          rows={3}
          value={tutor}
          disabled={maxOnly}
          onChange={e => setTutor(e.target.value)}
          placeholder="e.g. I'm doing AQA A-Level. Use UK spelling and mark questions like an examiner."
        />
        {maxOnly ? (
          <button type="button" className="link-btn" onClick={onUpgrade}>
            Unlock with Max
          </button>
        ) : null}
      </label>

      {import.meta.env.DEV ? (
      <div className="dev">
        <div className="dev__head">Developer settings (only shown when running npm run dev)</div>
        <div className="field">
          <span>AI connection (Groq)</span>
          <div className="conn">
            <button
              type="button"
              className="btn btn--ghost-line btn--sm"
              disabled={conn.state === 'testing'}
              onClick={async () => {
                setConn({ state: 'testing' });
                try {
                  const r = await checkConnection();
                  setConn({ state: 'ok', text: `Connected — ${r.test.model} replied “${r.test.reply}” in ${(r.test.ms / 1000).toFixed(1)}s.` });
                } catch (e) {
                  setConn({ state: 'error', text: `${e.title} ${e.message}`, warnings: e.warnings });
                }
              }}
            >
              {conn.state === 'testing' ? 'Testing…' : 'Test AI connection'}
            </button>
            <button
              type="button"
              className="btn btn--ghost-line btn--sm"
              disabled={modelTest === 'testing'}
              onClick={async () => {
                setModelTest('testing');
                try {
                  setModelTest(await testModels());
                } catch (e) {
                  setModelTest({ error: `${e.title} ${e.message}` });
                }
              }}
            >
              {modelTest === 'testing' ? 'Testing models…' : 'Test all models'}
            </button>
            <span className="conn__note">The API key is stored on the server (GROQ_API_KEY), never in the browser.</span>
          </div>
          {modelTest?.error ? <p className="form-error">{modelTest.error}</p> : null}
          {Array.isArray(modelTest) ? (
            <ul className="model-test" role="status">
              {modelTest.map(r => (
                <li key={r.model} data-ok={r.ok ? '' : undefined}>
                  <strong>{r.ok ? '✓' : '✗'} {r.name}</strong>
                  <span>{r.ok ? `works · ${(r.ms / 1000).toFixed(1)}s` : `${r.message}${r.detail ? ` — Groq said: ${r.detail}` : ''}`}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {conn.text ? (
            <p className={conn.state === 'ok' ? 'notice' : 'form-error'} role="status">
              {conn.text}
            </p>
          ) : null}
          {conn.warnings?.map(w => (
            <p key={w} className="form-error">
              {w}
            </p>
          ))}
        </div>
        <label className="field">
          <span>Google OAuth client ID (for Google sign-in)</span>
          <input value={client} onChange={e => setClient(e.target.value)} placeholder="1234…apps.googleusercontent.com" spellCheck={false} />
          <span className="conn__note">
            In Google Cloud Console, this client’s <em>Authorised JavaScript origins</em> must include <code>{location.origin}</code>, or Google shows
            “origin_mismatch”.
          </span>
        </label>
        <label className="field">
          <span>Preview a plan (testing only — no payment)</span>
          <select value={plan} onChange={e => onPreviewPlan(e.target.value)}>
            {PLAN_ORDER.map(id => (
              <option key={id} value={id}>
                {PLANS[id].name}
              </option>
            ))}
          </select>
        </label>
      </div>
      ) : null}
    </Modal>
  );
}

/* ── Activate a paid plan ─────────────────────────────── */
export function ActivateDialog({ initialKey = '', returning = false, onActivated, onPlans, onClose }) {
  const [key, setKey] = useState(initialKey);
  const [state, setState] = useState({ busy: false, error: '' });
  const submit = async e => {
    e?.preventDefault();
    if (!key.trim()) return;
    setState({ busy: true, error: '' });
    try {
      const pass = await activatePlan(key);
      onActivated({ ...pass, licenseKey: key.trim() });
    } catch (err) {
      setState({ busy: false, error: err.message });
    }
  };
  return (
    <Modal
      title={returning ? 'Thanks for your purchase!' : 'Activate your plan'}
      subtitle="Enter the license key from your Whop purchase to switch on Pro or Max."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={!key.trim() || state.busy} onClick={submit}>
            {state.busy ? 'Checking with Whop…' : 'Activate'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="field">
        <span>License key</span>
        <input value={key} onChange={e => setKey(e.target.value)} placeholder="e.g. A1B2C3-D4E5F6-…" autoFocus spellCheck={false} autoComplete="off" />
      </form>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <ul className="activate-help">
        <li>Your license key is in the receipt email from Whop, and at whop.com → Your orders → EUREKA.</li>
        <li>Use the same key on any device you study on. EUREKA re-checks it with Whop regularly, so a cancelled membership switches back to Free at the end of the billing period.</li>
        <li>
          Not bought a plan yet?{' '}
          <button type="button" className="link-btn" onClick={onPlans}>
            See plans
          </button>{' '}
          · Problems? Email eurekasofficial@gmail.com
        </li>
      </ul>
    </Modal>
  );
}

/* ── Confirm / import ──────────────────────────────────── */
export function ConfirmDialog({ title, body, confirm = 'Delete', danger = true, onConfirm, onClose }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn${danger ? ' btn--danger' : ''}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      <p className="dialog__text">{body}</p>
    </Modal>
  );
}
