import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type RoleBadgeTone = 'neutral' | 'blue' | 'amber' | 'emerald' | 'crimson';

export interface RoleSeatBadge {
  text: string;
  tone: RoleBadgeTone;
  pulse?: boolean;
}

export interface RoleSeatItem<TId extends string = string> {
  id: TId;
  name: string;
  roleLabel: string;
  appLabel: string;
  avatarInitials?: string;
  avatarColor?: string;
  badge?: RoleSeatBadge | null;
  disabled?: boolean;
}

export interface RoleSwitcherBarProps<TId extends string = string> {
  seats: RoleSeatItem<TId>[];
  activeSeatId: TId;
  onSelectSeat: (seatId: TId) => void;
  ariaLabel?: string;
  variant?: 'bar' | 'dropdown';
}

export const DEFAULT_SEAT_PALETTE = [
  '#2563eb',
  '#059669',
  '#7c3aed',
  '#d97706',
  '#0284c7'
] as const;

function deriveInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function resolveSeatAvatarColor<TId extends string>(
  seat: RoleSeatItem<TId>,
  index: number
): string {
  return seat.avatarColor ?? DEFAULT_SEAT_PALETTE[index % DEFAULT_SEAT_PALETTE.length];
}

export function RoleSwitcherBar<TId extends string = string>({
  seats,
  activeSeatId,
  onSelectSeat,
  ariaLabel = 'Workspace role switcher',
  variant = 'bar'
}: RoleSwitcherBarProps<TId>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant !== 'dropdown') return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [variant]);

  if (variant === 'dropdown') {
    const activeIndex = Math.max(
      0,
      seats.findIndex((s) => s.id === activeSeatId)
    );
    const activeSeat = seats[activeIndex] ?? seats[0];
    if (!activeSeat) return <div id="tour-role-switcher" />;

    const hasOtherNotification = seats.some(
      (s) => s.id !== activeSeatId && Boolean(s.badge?.pulse)
    );
    const activeInitials = activeSeat.avatarInitials || deriveInitials(activeSeat.name);
    const activeBg = resolveSeatAvatarColor(activeSeat, activeIndex);

    return (
      <div
        id="tour-role-switcher"
        ref={containerRef}
        style={{ position: 'relative', display: 'inline-block' }}
      >
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '7px 12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-strong)',
            backgroundColor: 'var(--bg-canvas)',
            color: 'var(--text-primary)',
            fontSize: '13.5px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '5px',
              backgroundColor: activeBg,
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11.5px',
              fontWeight: 700,
              flexShrink: 0
            }}
          >
            {activeInitials}
          </span>
          <span>
            {activeSeat.name} · {activeSeat.roleLabel}
          </span>
          {hasOtherNotification && (
            <span
              aria-label="Notification on another role"
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '999px',
                backgroundColor: '#f59e0b',
                flexShrink: 0
              }}
            />
          )}
          <ChevronDown size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        </button>

        {open && (
          <div
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 6px)',
              width: '280px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              padding: '6px',
              zIndex: 60
            }}
          >
            {seats.map((seat, index) => {
              const isActive = seat.id === activeSeatId;
              const initials = seat.avatarInitials || deriveInitials(seat.name);
              const bg = resolveSeatAvatarColor(seat, index);

              return (
                <button
                  key={seat.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={Boolean(seat.disabled)}
                  onClick={() => {
                    onSelectSeat(seat.id);
                    setOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    padding: '9px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: isActive ? 'var(--accent-primary-dim)' : 'transparent',
                    cursor: seat.disabled ? 'not-allowed' : 'pointer',
                    opacity: seat.disabled ? 0.55 : 1,
                    textAlign: 'left'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '6px',
                        backgroundColor: bg,
                        color: '#ffffff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                        flexShrink: 0
                      }}
                    >
                      {initials}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: '13.5px',
                          fontWeight: 700,
                          color: 'var(--text-primary)'
                        }}
                      >
                        {seat.name}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: '12.5px',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        {seat.roleLabel}
                      </span>
                    </span>
                  </span>

                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {seat.badge && seat.badge.pulse && (
                      <span
                        className={`badge badge-${seat.badge.tone}`}
                        style={{ fontSize: '11.5px', padding: '2px 7px' }}
                      >
                        {seat.badge.text}
                      </span>
                    )}
                    {isActive && <Check size={15} style={{ color: 'var(--accent-primary)' }} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const layoutClass =
    seats.length === 2 ? 'role-switcher-bar role-switcher-bar--two' : 'role-switcher-bar';

  return (
    <div role="group" aria-label={ariaLabel} className={layoutClass}>
      {seats.map((seat) => {
        const isActive = seat.id === activeSeatId;
        const initials = seat.avatarInitials || deriveInitials(seat.name);
        const badgeToneClass = seat.badge
          ? `role-seat-badge role-seat-badge--${seat.badge.tone}${
              seat.badge.pulse ? ' role-seat-badge--pulse' : ''
            }`
          : '';

        return (
          <button
            key={seat.id}
            type="button"
            className={`role-seat-btn${isActive ? ' active' : ''}`}
            aria-pressed={isActive}
            disabled={Boolean(seat.disabled)}
            onClick={() => onSelectSeat(seat.id)}
          >
            <div className="role-seat-top">
              <div className="role-seat-identity">
                <span className="role-seat-avatar" aria-hidden="true">
                  {initials}
                </span>
                <div className="role-seat-text">
                  <span className="role-seat-name">{seat.name}</span>
                  <span className="role-seat-role">{seat.roleLabel}</span>
                </div>
              </div>
              {seat.badge && (
                <span className={badgeToneClass}>{seat.badge.text}</span>
              )}
            </div>
            <div className="role-seat-app">{seat.appLabel}</div>
          </button>
        );
      })}
    </div>
  );
}
