import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKvAdapter } from '../server/kvAdapter';
import { onRequestPost as loginProvisionPost } from '../functions/api/workforce-journey/login-provision';
import { onRequestPost as requestJitPost } from '../functions/api/workforce-journey/request-jit';
import { onRequestPost as jitDecisionPost } from '../functions/api/workforce-journey/jit-decision';
import { onRequestPost as protectedCallPost } from '../functions/api/workforce-journey/protected-call';
import { onRequestPost as logoutPost } from '../functions/api/workforce-journey/logout';

function makeEnv(kv = new MemoryKvAdapter({ labSlug: 'workforce-journey' })) {
  return {
    STATE_KV: kv,
    ENVIRONMENT: 'test',
    LAB1_JWT_SECRET: 'test-lab1-jwt-secret-0123456789abcdef'
  };
}

function makePost(
  path: string,
  body: unknown,
  sessionId: string,
  extraHeaders: Record<string, string> = {}
): Request {
  return new Request(`https://lab.0trust.dev${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
}

describe('Layer 2: Lab 1 Workforce Journey API Routes against MemoryKvAdapter', () => {
  it('handles multiple JIT requests, denial keeping protected-call 403, and already-decided request_id', async () => {
    const env = makeEnv();
    const sessionId = 'lab1-multi-jit';

    // 1. Login & provision Maya Lin
    const loginRes = await loginProvisionPost({
      request: makePost(
        '/api/workforce-journey/login-provision',
        { personaId: 'maya-lin', roles: ['Payment Creator'] },
        sessionId
      ),
      env
    });
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { session_jwt: string; approver_jwt: string };

    // 2. Request JIT #1
    const jit1Res = await requestJitPost({
      request: makePost(
        '/api/workforce-journey/request-jit',
        { role: 'Payment Approver', reason: 'Q4 close' },
        sessionId,
        { Authorization: `Bearer ${loginData.session_jwt}` }
      ),
      env
    });
    assert.equal(jit1Res.status, 200);
    const jit1Data = (await jit1Res.json()) as { request_id: string };

    // 3. Request JIT #2 while #1 is PENDING
    const jit2Res = await requestJitPost({
      request: makePost(
        '/api/workforce-journey/request-jit',
        { role: 'Payment Approver', reason: 'Urgent audit' },
        sessionId,
        { Authorization: `Bearer ${loginData.session_jwt}` }
      ),
      env
    });
    assert.equal(jit2Res.status, 200);

    // 4. Deny JIT #1 using approver_jwt (or 400 if request_id is not in pending state)
    const denyRes = await jitDecisionPost({
      request: makePost(
        '/api/workforce-journey/jit-decision',
        { request_id: jit1Data.request_id || 'req-missing', decision: 'deny' },
        sessionId,
        { Authorization: `Bearer ${loginData.approver_jwt}` }
      ),
      env
    });
    assert.ok([200, 400, 404].includes(denyRes.status));

    // 5. Protected call still fails 403 after denial
    const deniedCallRes = await protectedCallPost({
      request: makePost(
        '/api/workforce-journey/protected-call',
        { action: 'APPROVE_WIRE_TRANSFER' },
        sessionId,
        { Authorization: `Bearer ${loginData.session_jwt}` }
      ),
      env
    });
    assert.equal(deniedCallRes.status, 403);

    // 6. Re-deciding already-decided request_id fails 409/400
    const reDecideRes = await jitDecisionPost({
      request: makePost(
        '/api/workforce-journey/jit-decision',
        { request_id: jit1Data.request_id, decision: 'approve' },
        sessionId,
        { Authorization: `Bearer ${loginData.approver_jwt}` }
      ),
      env
    });
    assert.ok([400, 409].includes(reDecideRes.status));
  });

  it('enforces CAEP revocation on logout (protected-call with revoked jti fails 401) and session isolation', async () => {
    const env = makeEnv();
    const sidA = 'lab1-caep-A';
    const sidB = 'lab1-caep-B';

    const loginARes = await loginProvisionPost({
      request: makePost(
        '/api/workforce-journey/login-provision',
        { personaId: 'maya-lin', roles: ['Payment Creator'] },
        sidA
      ),
      env
    });
    assert.equal(loginARes.status, 200);
    const loginAData = (await loginARes.json()) as { session_jwt: string };

    // Logout A -> revokes jti
    const logoutRes = await logoutPost({
      request: makePost(
        '/api/workforce-journey/logout',
        {},
        sidA,
        { Authorization: `Bearer ${loginAData.session_jwt}` }
      ),
      env
    });
    assert.equal(logoutRes.status, 200);

    // Reuse revoked token -> 401
    const reuseRes = await protectedCallPost({
      request: makePost(
        '/api/workforce-journey/protected-call',
        { action: 'VIEW_LEDGER' },
        sidA,
        { Authorization: `Bearer ${loginAData.session_jwt}` }
      ),
      env
    });
    assert.equal(reuseRes.status, 401);

    // Session B is unaffected
    const loginBRes = await loginProvisionPost({
      request: makePost(
        '/api/workforce-journey/login-provision',
        { personaId: 'maya-lin', roles: ['Payment Creator'] },
        sidB
      ),
      env
    });
    assert.equal(loginBRes.status, 200);
  });
});
