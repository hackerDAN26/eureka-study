import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight01Icon,
  CrownIcon,
  File02Icon,
  Leaf01Icon,
  Logout01Icon,
  Mail01Icon,
  Key01Icon,
  Settings02Icon,
  Shield01Icon,
  UserGroupIcon
} from '@hugeicons/core-free-icons';
import { Avatar, Icon, Meter } from './ui';
import { renderGoogleButton, signInBlocker } from '../lib/auth';
import { PLANS } from '../lib/plans';
import { tierFor } from '../lib/promos';

export function GoogleButton({ mode = 'signin', onUser, width = 260 }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const blocker = signInBlocker();
  useEffect(() => {
    if (blocker || !ref.current) return;
    setError('');
    renderGoogleButton(ref.current, {
      text: mode === 'signup' ? 'signup_with' : 'signin_with',
      width,
      onUser,
      onError: setError
    }).catch(e => setError(e.message));
  }, [blocker, mode, width, onUser, attempt]);
  if (blocker) return <p className="auth-note">{blocker}</p>;
  return (
    <>
      <div ref={ref} className="gbtn" />
      {error ? (
        <p className="auth-note auth-note--error" role="alert">
          {error}{' '}
          <button type="button" className="link-btn" onClick={() => setAttempt(n => n + 1)}>
            Try again
          </button>
        </p>
      ) : null}
    </>
  );
}

function AuthPanel({ onUser }) {
  const [mode, setMode] = useState('signin');
  return (
    <div className="auth">
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>
          Create account
        </button>
      </div>
      <p className="auth__lede">
        {mode === 'signin' ? 'Welcome back. Continue with your Google account.' : 'Create your free EUREKA account with Google — no password needed.'}
      </p>
      <GoogleButton mode={mode} onUser={onUser} />
      <p className="auth__fine">
        By continuing you agree to the <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy Policy</a>.
      </p>
    </div>
  );
}

export default function AccountMenu({ open, setOpen, user, plan, billing, usage, limits, points = 0, season, now, onRewards, onUser, onSignOut, onPlans, onActivate, onShare, onSettings, onContact }) {
  const root = useRef(null);
  const P = PLANS[plan];

  useEffect(() => {
    if (!open) return undefined;
    const down = e => !root.current?.contains(e.target) && !e.target.closest?.('.dialog') && setOpen(false);
    const key = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open, setOpen]);

  const go = fn => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="account" ref={root}>
      {open ? (
        <div className="account__pop" role="dialog" aria-label="Account">
          {user ? (
            <div className="account__who">
              <Avatar user={user} size={36} />
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
            </div>
          ) : (
            <AuthPanel onUser={onUser} />
          )}

          <div className="account__plan">
            <div className="account__plan-head">
              <span className="plan-badge" data-plan={plan}>
                {plan !== 'free' ? <Icon icon={CrownIcon} size={12} /> : null} {P.name}
              </span>
              <span className="account__billing">{plan === 'free' ? 'Free forever' : billing === 'yearly' ? 'Billed yearly' : 'Billed monthly'}</span>
              <button type="button" className="link-btn" onClick={go(onPlans)}>
                {plan === 'max' ? 'Manage' : 'Upgrade'} <Icon icon={ArrowRight01Icon} size={12} />
              </button>
            </div>
            <Meter label="AI messages today" used={usage.messages} limit={(limits ?? P.limits).messagesPerDay} />
            <Meter label="Web searches today" used={usage.web} limit={(limits ?? P.limits).webPerDay} />
            {season?.bonus.type === 'messages' ? <p className="fine bonus-note">{season.bonus.label} until {season.end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p> : null}
          </div>

          <button type="button" className="account__rewards" onClick={go(onRewards)}>
            <Icon icon={Leaf01Icon} size={16} />
            <span>
              <strong>{points.toLocaleString()} Leaves</strong>
              <em>{tierFor(points).name} tier · Rewards & loyalty</em>
            </span>
            <Icon icon={ArrowRight01Icon} size={13} />
          </button>

          <div className="account__menu">
            <button type="button" onClick={go(onPlans)}>
              <Icon icon={CrownIcon} size={15} /> Change plan{season ? <span className="menu-sale">−{season.percent}%</span> : null}
            </button>
            {onActivate ? (
              <button type="button" onClick={go(onActivate)}>
                <Icon icon={Key01Icon} size={15} /> Activate a purchase
              </button>
            ) : null}
            <button type="button" onClick={go(onShare)}>
              <Icon icon={UserGroupIcon} size={15} /> Share workspace
            </button>
            <button type="button" onClick={go(onSettings)}>
              <Icon icon={Settings02Icon} size={15} /> Settings
            </button>
            <button type="button" onClick={go(onContact)}>
              <Icon icon={Mail01Icon} size={15} /> Contact us
            </button>
            <a href="#/terms" onClick={() => setOpen(false)}>
              <Icon icon={File02Icon} size={15} /> Terms & Conditions
            </a>
            <a href="#/privacy" onClick={() => setOpen(false)}>
              <Icon icon={Shield01Icon} size={15} /> Privacy Policy
            </a>
            {user ? (
              <button type="button" onClick={go(onSignOut)}>
                <Icon icon={Logout01Icon} size={15} /> Sign out
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <button type="button" className="account__trigger" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <Avatar user={user} />
        <span className="account__name">
          <strong>{user ? user.name : 'Sign in / Sign up'}</strong>
          <span>{user ? `${P.name} plan` : `${P.name} plan · Google account`}</span>
        </span>
        <span className="plan-badge plan-badge--mini" data-plan={plan}>
          {P.name}
        </span>
      </button>
    </div>
  );
}
