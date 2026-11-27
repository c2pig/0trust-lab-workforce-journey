import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCountdown,
  getAccessGuardBadge,
  getFinCoreBadge,
  getIdentityThreatBadge,
  getWorkforceActionGates
} from '../src/engine/workforceSelectors';

describe('Layer 3: Lab 1 Workforce Pure Selectors', () => {
  it('formatCountdown formats 0, 65, and clamps negative values to 00:00', () => {
    assert.equal(formatCountdown(0), '00:00');
    assert.equal(formatCountdown(65), '01:05');
    assert.equal(formatCountdown(-12), '00:00');
  });

  it('derives FinCore, AccessGuard, and Identity Threat Monitor badges', () => {
    assert.deepEqual(getFinCoreBadge(false, 0), { text: '0m Standing', tone: 'slate' });
    assert.deepEqual(getFinCoreBadge(true, 125), { text: '02:05 Remaining', tone: 'emerald' });
    assert.equal(getAccessGuardBadge(0), null);
    assert.deepEqual(getAccessGuardBadge(2), { text: '2 Pending', tone: 'amber' });
    assert.equal(getIdentityThreatBadge(0), null);
    assert.deepEqual(getIdentityThreatBadge(1), { text: '1 Revoked', tone: 'rose' });
  });

  it('derives workforce action gates from session and JIT state', () => {
    assert.deepEqual(
      getWorkforceActionGates({ isLoggedIn: true, isElevatedActive: false, hasPendingJit: true }),
      { canRequestJit: false, canApproveJit: true, canCallProtected: true, canLogout: true }
    );
  });
});
