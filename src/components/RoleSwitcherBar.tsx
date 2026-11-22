import React from 'react';

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
  badge?: RoleSeatBadge | null;
  disabled?: boolean;
}

export interface RoleSwitcherBarProps<TId extends string = string> {
  seats: RoleSeatItem<TId>[];
  activeSeatId: TId;
  onSelectSeat: (seatId: TId) => void;
  ariaLabel?: string;
}

function deriveInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function RoleSwitcherBar<TId extends string = string>({
  seats,
  activeSeatId,
  onSelectSeat,
  ariaLabel = 'Workspace role switcher'
}: RoleSwitcherBarProps<TId>): React.ReactElement {
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
