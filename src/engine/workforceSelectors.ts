/**
 * Formats a remaining seconds countdown as MM:SS, clamping negative values to 00:00.
 */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export interface WorkforceBadge {
  text: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}

export function getFinCoreBadge(isElevatedActive: boolean, jitRemainingSec: number): WorkforceBadge {
  if (isElevatedActive && jitRemainingSec > 0) {
    return { text: `${formatCountdown(jitRemainingSec)} Remaining`, tone: 'emerald' };
  }
  return { text: '0m Standing', tone: 'slate' };
}

export function getAccessGuardBadge(pendingCount: number): WorkforceBadge | null {
  if (pendingCount <= 0) return null;
  return { text: `${pendingCount} Pending`, tone: 'amber' };
}

export function getIdentityThreatBadge(revokedCount: number): WorkforceBadge | null {
  if (revokedCount <= 0) return null;
  return { text: `${revokedCount} Revoked`, tone: 'rose' };
}

export function getWorkforceActionGates(params: {
  isLoggedIn: boolean;
  isElevatedActive: boolean;
  hasPendingJit: boolean;
}) {
  return {
    canRequestJit: params.isLoggedIn && !params.hasPendingJit && !params.isElevatedActive,
    canApproveJit: params.hasPendingJit,
    canCallProtected: params.isLoggedIn,
    canLogout: params.isLoggedIn
  };
}
