import { useEffect } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { BULB_PATH } from './bulb-path';

export const C = {
  forest: '#123D2B',
  dark: '#0B251B',
  emerald: '#39A875',
  bg: '#08140F',
  surface: '#102A20',
  text: '#F1F4EF',
  sage: '#A0B3A6',
  line: '#1E4A37'
};

export const Icon = ({ icon, size = 16, stroke = 1.8 }) => <HugeiconsIcon icon={icon} size={size} strokeWidth={stroke} />;

// The EUREKA mark: the pixel lightbulb. (Named LeafMark for older call sites.)
export function LeafMark({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={(size * 9) / 12} height={size} viewBox="0 0 9 12" fill={color} aria-hidden="true" shapeRendering="crispEdges">
      <path d={BULB_PATH} />
    </svg>
  );
}
export const BulbMark = LeafMark;

export function Logo({ size = 28, word = true }) {
  return (
    <span className="logo" style={{ '--logo-size': `${size}px` }}>
      <LeafMark size={size} />
      {word ? <span className="logo__word">EUREKA</span> : null}
    </span>
  );
}

export function Modal({ title, subtitle, onClose, children, wide = false, footer }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`dialog__card${wide ? ' dialog__card--wide' : ''}`}>
        <div className="dialog__head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className="dialog__sub">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon icon={Cancel01Icon} />
          </button>
        </div>
        <div className="dialog__body">{children}</div>
        {footer ? <div className="dialog__row">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Meter({ label, used, limit }) {
  const pct = Math.min(100, (used / Math.max(1, limit)) * 100);
  return (
    <div className="meter">
      <div className="meter__row">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="meter__track">
        <span style={{ width: `${pct}%` }} data-hot={pct >= 85 ? '' : undefined} />
      </div>
    </div>
  );
}

export const initials = name =>
  (name || '?')
    .split(/\s+/)
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function Avatar({ user, size = 28 }) {
  if (user?.picture) return <img className="avatar" src={user.picture} alt="" width={size} height={size} referrerPolicy="no-referrer" />;
  return (
    <span className="avatar avatar--empty" style={{ width: size, height: size }}>
      {user ? initials(user.name) : <LeafMark size={size * 0.5} />}
    </span>
  );
}
