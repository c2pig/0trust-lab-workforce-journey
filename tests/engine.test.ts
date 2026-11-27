import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/engine/workforceJourneyClient';

describe('Layer 3: Workforce Journey Client Module', () => {
  it('exports expected API client functions without DOM dependencies', () => {
    assert.equal(typeof client.fetchWorkforceJourneyConfig, 'function');
    assert.equal(typeof client.createVisitorSessionId, 'function');
    assert.equal(typeof client.resetBrowserFallbackSession, 'function');
    assert.equal(typeof client.callWorkforceJourneyApi, 'function');
    assert.equal(typeof client.submitWorkforceJitRequest, 'function');
    assert.equal(typeof client.decideWorkforceJitRequest, 'function');

    const sid = client.createVisitorSessionId();
    assert.ok(sid.length > 0);
  });
});
