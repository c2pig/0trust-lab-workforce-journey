import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  signWorkforceJourneyJwt,
  verifyWorkforceJourneyJwt,
  type WorkforceJourneyJwtPayload
} from '../functions/api/lib/workforceJourneyCrypto';
import { createCloudRunApp, verifyRouterSecret } from '../server/app';
import {
  buildKvDocId,
  FirestoreKvAdapter,
  MemoryKvAdapter,
  type FirestoreCollectionLike,
  type FirestoreKvDoc
} from '../server/kvAdapter';
import { resolvePublicOrigin } from '../server/origin';

const TEST_ROUTER_SECRET = 'test-router-secret-value-0123456789';

function createMockFirestoreCollection(): {
  collection: FirestoreCollectionLike;
  store: Map<string, FirestoreKvDoc>;
} {
  const store = new Map<string, FirestoreKvDoc>();
  const collection: FirestoreCollectionLike = {
    doc(id: string) {
      return {
        async get() {
          const data = store.get(id);
          return {
            exists: Boolean(data),
            data: () => data
          };
        },
        async set(data: FirestoreKvDoc) {
          store.set(id, data);
        },
        async delete() {
          store.delete(id);
        }
      };
    }
  };
  return { collection, store };
}

describe('Lab 1 Cloud Run Adapter — Red-Team & Security Invariants', () => {
  it('blocks direct *.run.app /api/* requests without or with invalid X-Lab-Router-Secret (fail-closed 403)', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'workforce-journey',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'workforce-journey' })
    });

    // Missing header
    const resMissing = await app.request(
      'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/config'
    );
    assert.equal(resMissing.status, 403);
    assert.deepEqual(await resMissing.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    // Wrong secret (same length & different length)
    const resWrongSameLen = await app.request(
      'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/config',
      {
        headers: { 'x-lab-router-secret': 'wrong-router-secret-value-987654321' }
      }
    );
    assert.equal(resWrongSameLen.status, 403);
    assert.deepEqual(await resWrongSameLen.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    const resWrongDiffLen = await app.request(
      'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/config',
      {
        headers: { 'x-lab-router-secret': 'short' }
      }
    );
    assert.equal(resWrongDiffLen.status, 403);

    // Fail-closed when LAB_ROUTER_SECRET is unset in production
    const appUnconfigured = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'workforce-journey'
      },
      kv: new MemoryKvAdapter({ labSlug: 'workforce-journey' })
    });
    const resUnconfigured = await appUnconfigured.request(
      'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/config',
      {
        headers: { 'x-lab-router-secret': TEST_ROUTER_SECRET }
      }
    );
    assert.equal(resUnconfigured.status, 403);
    assert.deepEqual(await resUnconfigured.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    // Valid secret succeeds
    const resValid = await app.request(
      'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/config',
      {
        headers: { 'x-lab-router-secret': TEST_ROUTER_SECRET }
      }
    );
    assert.equal(resValid.status, 200);
    const json = (await resValid.json()) as Record<string, unknown>;
    assert.equal(json.sandbox_available, true);
    assert.equal(verifyRouterSecret(TEST_ROUTER_SECRET, TEST_ROUTER_SECRET), true);
  });

  it('serves GET /healthz without X-Lab-Router-Secret (Cloud Run probe)', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'workforce-journey',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'workforce-journey' })
    });

    const res = await app.request('https://0trust-lab-workforce-journey-abc.run.app/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, lab: 'workforce-journey' });
  });

  it('synchronously returns null on expired TTL docs in FirestoreKvAdapter & MemoryKvAdapter', async () => {
    let nowMs = 1_700_000_000_000;
    const { collection, store } = createMockFirestoreCollection();
    const firestoreKv = new FirestoreKvAdapter({
      labSlug: 'workforce-journey',
      collectionRef: collection,
      nowFn: () => nowMs
    });

    await firestoreKv.put('lab1:pkce:state/with/slash', '{"v":1}', { expirationTtl: 600 });
    const expectedDocId = buildKvDocId('workforce-journey', 'lab1:pkce:state/with/slash');
    assert.equal(expectedDocId, 'workforce-journey:lab1%3Apkce%3Astate%2Fwith%2Fslash');

    const storedDoc = store.get(expectedDocId);
    assert.ok(storedDoc);
    assert.equal(storedDoc.labSlug, 'workforce-journey');
    assert.equal(storedDoc.value, '{"v":1}');
    assert.equal(storedDoc.expireAt?.toMillis(), nowMs + 600_000);

    // Before expiry
    assert.equal(await firestoreKv.get('lab1:pkce:state/with/slash'), '{"v":1}');

    // Advance clock past TTL without deleting the doc from Firestore (simulating delayed background reaper)
    nowMs += 600_000;
    assert.equal(store.has(expectedDocId), true);
    assert.equal(await firestoreKv.get('lab1:pkce:state/with/slash'), null);

    // MemoryKvAdapter parity
    let memNow = 1_700_000_000_000;
    const memKv = new MemoryKvAdapter({ labSlug: 'workforce-journey', nowFn: () => memNow });
    await memKv.put('lab1:pkce:abc', 'ok', { expirationTtl: 10 });
    assert.equal(await memKv.get('lab1:pkce:abc'), 'ok');
    memNow += 10_000;
    assert.equal(await memKv.get('lab1:pkce:abc'), null);
  });

  it('reconstructs https://lab.0trust.dev in entra/login & entra/callback from X-Forwarded-Host', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'workforce-journey' });
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'workforce-journey',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET,
        ENTRA_EXT_TENANT_ID: '00000000-0000-0000-0000-000000000001',
        ENTRA_EXT_CLIENT_ID: 'client-123',
        ENTRA_EXT_CLIENT_SECRET: 'entra-secret-456',
        ENTRA_EXT_AUTHORITY: 'https://demo.ciamlogin.com/00000000-0000-0000-0000-000000000001/v2.0'
      },
      kv
    });

    // 1. entra/login behind lab-router
    const loginRes = await app.request(
      'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/entra/login',
      {
        headers: {
          'x-lab-router-secret': TEST_ROUTER_SECRET,
          'x-forwarded-host': 'lab.0trust.dev',
          'x-forwarded-proto': 'https'
        }
      }
    );
    assert.equal(loginRes.status, 302);
    const authorizeLocation = loginRes.headers.get('location');
    assert.ok(authorizeLocation);
    const authUrl = new URL(authorizeLocation);
    assert.equal(
      authUrl.searchParams.get('redirect_uri'),
      'https://lab.0trust.dev/api/workforce-journey/entra/callback'
    );
    const state = authUrl.searchParams.get('state');
    const nonce = authUrl.searchParams.get('nonce');
    assert.ok(state);
    assert.ok(nonce);

    // 2. entra/callback behind lab-router (mock Entra token endpoint)
    const originalFetch = globalThis.fetch;
    const mockIdPayload = Buffer.from(
      JSON.stringify({
        iss: 'https://demo.ciamlogin.com/00000000-0000-0000-0000-000000000001/v2.0',
        aud: 'client-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce,
        oid: 'oid-999',
        email: 'visitor@example.com',
        name: 'Visitor'
      })
    ).toString('base64url');
    const mockIdToken = `eyJhbGciOiJSUzI1NiJ9.${mockIdPayload}.mock-sig`;

    let capturedTokenBody = '';
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedTokenBody = String(init?.body || '');
      return new Response(JSON.stringify({ id_token: mockIdToken }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;

    try {
      const cbRes = await app.request(
        `https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/entra/callback?code=authcode123&state=${encodeURIComponent(state)}`,
        {
          headers: {
            'x-lab-router-secret': TEST_ROUTER_SECRET,
            'x-forwarded-host': 'lab.0trust.dev',
            'x-forwarded-proto': 'https'
          }
        }
      );
      assert.equal(cbRes.status, 302);
      const finalLocation = cbRes.headers.get('location');
      assert.ok(finalLocation);
      assert.equal(finalLocation, 'https://lab.0trust.dev/workforce-journey?entra_auth=1');
      assert.ok(!finalLocation.includes('entra_ticket'));
      assert.ok(!finalLocation.includes('oid='));
      assert.ok(!finalLocation.includes('email='));

      const setCookie = cbRes.headers.get('set-cookie') || '';
      assert.ok(setCookie.includes('lab1_entra_ticket='));
      assert.ok(setCookie.includes('HttpOnly'));
      assert.ok(setCookie.includes('SameSite=Lax'));
      assert.ok(setCookie.includes('Secure'));
      const ticketMatch = setCookie.match(/lab1_entra_ticket=([^;]+)/);
      assert.ok(ticketMatch);

      // 3. GET /api/workforce-journey/entra/session resolves identity from HttpOnly cookie
      const sessionRes = await app.request(
        'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/entra/session',
        {
          headers: {
            'x-lab-router-secret': TEST_ROUTER_SECRET,
            cookie: `lab1_entra_ticket=${ticketMatch[1]}`
          }
        }
      );
      assert.equal(sessionRes.status, 200);
      const sessionJson = (await sessionRes.json()) as {
        authenticated: boolean;
        oid: string;
        email: string;
        name: string;
      };
      assert.equal(sessionJson.authenticated, true);
      assert.equal(sessionJson.oid, 'oid-999');
      assert.equal(sessionJson.email, 'visitor@example.com');
      assert.equal(sessionJson.name, 'Visitor');

      assert.ok(
        capturedTokenBody.includes(
          encodeURIComponent('https://lab.0trust.dev/api/workforce-journey/entra/callback')
        )
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects forged X-Forwarded-Host headers and falls back to request URL origin', async () => {
    const forgedReq = new Request(
      'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/entra/login',
      {
        headers: {
          'x-forwarded-host': 'evil.com',
          'x-forwarded-proto': 'https'
        }
      }
    );
    assert.equal(
      resolvePublicOrigin(forgedReq),
      'https://0trust-lab-workforce-journey-abc.run.app'
    );

    const forgedSubdomainReq = new Request(
      'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/entra/login',
      {
        headers: {
          'x-forwarded-host': 'lab.0trust.dev.evil.com',
          'x-forwarded-proto': 'https'
        }
      }
    );
    assert.equal(
      resolvePublicOrigin(forgedSubdomainReq),
      'https://0trust-lab-workforce-journey-abc.run.app'
    );

    const localReq = new Request('http://127.0.0.1:8080/api/workforce-journey/entra/login', {
      headers: {
        'x-forwarded-host': 'localhost:5174',
        'x-forwarded-proto': 'http'
      }
    });
    assert.equal(resolvePublicOrigin(localReq), 'http://localhost:5174');
  });

  it('redacts JWT signatures in _telemetry and never leaks X-Lab-Router-Secret or OTLP_AUTH_HEADER', async () => {
    const otlpAuthSecret = 'Bearer otlp-super-secret-header-token';
    const capturedOtlpBodies: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedOtlpBodies.push(String(init?.body || ''));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const app = createCloudRunApp({
        env: {
          ENVIRONMENT: 'production',
          LAB_SLUG: 'workforce-journey',
          LAB_ROUTER_SECRET: TEST_ROUTER_SECRET,
          OTLP_ENDPOINT: 'https://otlp.example.com',
          OTLP_AUTH_HEADER: otlpAuthSecret
        },
        kv: new MemoryKvAdapter({ labSlug: 'workforce-journey' })
      });

      const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SuperSecretSignatureXYZ123';
      const res = await app.request(
        'https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/config',
        {
          headers: {
            'x-lab-router-secret': TEST_ROUTER_SECRET,
            authorization: `Bearer ${fakeJwt}`,
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
          }
        }
      );

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('traceparent')?.startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-'));
      assert.ok(res.headers.get('X-Edge-Latency-Ms'));

      const bodyText = await res.text();
      assert.ok(!bodyText.includes('SuperSecretSignatureXYZ123'), 'JWT signature must be redacted');
      assert.ok(!bodyText.includes(TEST_ROUTER_SECRET), 'Router secret must never appear in response');
      assert.ok(!bodyText.includes(otlpAuthSecret), 'OTLP auth header must never appear in response');

      const parsed = JSON.parse(bodyText) as {
        _telemetry: { redacted_auth_header: string; redaction_applied: boolean };
      };
      assert.equal(parsed._telemetry.redaction_applied, true);
      assert.equal(
        parsed._telemetry.redacted_auth_header,
        'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.***REDACTED***'
      );

      // Give detached waitUntil promise a microtask tick
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(capturedOtlpBodies.length, 2);
      for (const body of capturedOtlpBodies) {
        assert.ok(body.includes('zerotrust-lab-workforce-journey'));
        assert.ok(!body.includes(TEST_ROUTER_SECRET));
        assert.ok(!body.includes('SuperSecretSignatureXYZ123'));
        assert.ok(!body.includes(otlpAuthSecret));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('executes full Lab 1 SCIM → JIT → Protected Call → CAEP Logout lifecycle on Cloud Run adapter', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'workforce-journey' });
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'development',
        LAB_SLUG: 'workforce-journey'
      },
      kv
    });

    const sessionId = 'test-session-lifecycle';

    // 1. Provision user
    const provRes = await app.request('http://127.0.0.1:8080/api/workforce-journey/login-provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ personaId: 'maya-lin', roles: ['Payment Creator'] })
    });
    assert.equal(provRes.status, 200);
    const provData = (await provRes.json()) as {
      session_jwt: string;
      approver_jwt: string;
      status: string;
    };
    assert.equal(provData.status, 'PROVISIONED');
    assert.ok(provData.session_jwt);
    assert.ok(provData.approver_jwt);

    // 2. Submit JIT request
    const submitRes = await app.request('http://127.0.0.1:8080/api/workforce-journey/jit-submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
        Authorization: `Bearer ${provData.session_jwt}`
      },
      body: JSON.stringify({ ttl_seconds: 900, justification: 'Treasury batch close' })
    });
    assert.equal(submitRes.status, 201);
    const submitData = (await submitRes.json()) as { request_id: string };
    assert.ok(submitData.request_id);

    // 3. Approve JIT request with Marcus's signed approver_jwt
    const decideRes = await app.request('http://127.0.0.1:8080/api/workforce-journey/jit-decision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
        Authorization: `Bearer ${provData.approver_jwt}`
      },
      body: JSON.stringify({
        request_id: submitData.request_id,
        decision: 'approve',
        approver: { email: 'marcus.chen@acme-corp.io', name: 'Marcus Chen' }
      })
    });
    assert.equal(decideRes.status, 200);
    const decideData = (await decideRes.json()) as { jit_jwt: string; status: string };
    assert.equal(decideData.status, 'JIT_GRANTED');
    assert.ok(decideData.jit_jwt);

    // 4. Protected call succeeds with JIT JWT
    const callRes = await app.request('http://127.0.0.1:8080/api/workforce-journey/protected-call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
        Authorization: `Bearer ${decideData.jit_jwt}`
      },
      body: JSON.stringify({ target_endpoint: 'payment_create' })
    });
    assert.equal(callRes.status, 200);
    const callData = (await callRes.json()) as { status: string };
    assert.equal(callData.status, 'AUTHORIZED');

    // 5. CAEP Universal Logout revokes both session and JIT tokens
    const logoutRes = await app.request('http://127.0.0.1:8080/api/workforce-journey/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
        Authorization: `Bearer ${decideData.jit_jwt}`
      },
      body: JSON.stringify({ session_jwt: provData.session_jwt, jit_jwt: decideData.jit_jwt })
    });
    assert.equal(logoutRes.status, 200);

    // 6. Subsequent protected call is rejected with 401 TOKEN_REVOKED
    const revokedCallRes = await app.request(
      'http://127.0.0.1:8080/api/workforce-journey/protected-call',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
          Authorization: `Bearer ${decideData.jit_jwt}`
        },
        body: JSON.stringify({ target_endpoint: 'payment_create' })
      }
    );
    assert.equal(revokedCallRes.status, 401);
    const revokedData = (await revokedCallRes.json()) as { error: string };
    assert.equal(revokedData.error, 'TOKEN_REVOKED');
  });

  it('fails closed in production when LAB1_JWT_SECRET is missing/short and rejects alg:none or expired JWTs', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload: WorkforceJourneyJwtPayload = {
      iss: 'https://iam.0trust.dev',
      sub: 'maya-lin',
      email: 'maya.lin@acme-corp.io',
      name: 'Maya Lin',
      department: 'Finance Operations',
      roles: ['Payment Creator'],
      scope: 'session:base',
      token_type: 'session',
      jti: 'sess_test_1',
      sid: 'sid-1',
      iat: nowSec - 10,
      exp: nowSec + 3600
    };

    await assert.rejects(
      () => signWorkforceJourneyJwt(payload, undefined, 'production'),
      /LAB1_JWT_SECRET/
    );
    await assert.rejects(
      () => signWorkforceJourneyJwt(payload, 'short-secret', 'production'),
      /LAB1_JWT_SECRET/
    );
    await assert.rejects(
      () => verifyWorkforceJourneyJwt('a.b.c', 'short-secret', 'production'),
      /LAB1_JWT_SECRET/
    );

    const algNoneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const validPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const algNoneRes = await verifyWorkforceJourneyJwt(`${algNoneHeader}.${validPayload}.`, undefined, 'development');
    assert.equal(algNoneRes.valid, false);

    const expiredSigned = await signWorkforceJourneyJwt(
      { ...payload, exp: nowSec - 5 },
      'test-secret-0123456789',
      'production'
    );
    const expiredRes = await verifyWorkforceJourneyJwt(
      expiredSigned.token,
      'test-secret-0123456789',
      'production'
    );
    assert.equal(expiredRes.valid, false);
    assert.equal(expiredRes.expired, true);
  });

  it('enforces Approver JWT AuthN/AuthZ and self-approval guard on jit-decision and AuthN on logout', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'workforce-journey' });
    const jwtSecret = 'test-lab1-jwt-secret-0123456789';
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'workforce-journey',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET,
        LAB1_JWT_SECRET: jwtSecret
      },
      kv
    });

    const sessionId = 'neg-sec-session';
    const headersBase = {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      'x-lab-router-secret': TEST_ROUTER_SECRET
    };

    const provRes = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/login-provision', {
      method: 'POST',
      headers: headersBase,
      body: JSON.stringify({ personaId: 'maya-lin', roles: ['Payment Creator'] })
    });
    assert.equal(provRes.status, 200);
    const provData = (await provRes.json()) as { session_jwt: string; approver_jwt: string };

    const submitRes = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/jit-submit', {
      method: 'POST',
      headers: { ...headersBase, Authorization: `Bearer ${provData.session_jwt}` },
      body: JSON.stringify({ ttl_seconds: 900, justification: 'Security test' })
    });
    assert.equal(submitRes.status, 201);
    const submitData = (await submitRes.json()) as { request_id: string };

    // 1. jit-decision without Authorization -> 401 MISSING_APPROVER_TOKEN
    const noAuthDecide = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/jit-decision', {
      method: 'POST',
      headers: headersBase,
      body: JSON.stringify({ request_id: submitData.request_id, decision: 'approve' })
    });
    assert.equal(noAuthDecide.status, 401);
    assert.equal(((await noAuthDecide.json()) as { error: string }).error, 'MISSING_APPROVER_TOKEN');

    // 2. jit-decision with forged JWT -> 401 INVALID_APPROVER_TOKEN
    const forgedDecide = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/jit-decision', {
      method: 'POST',
      headers: { ...headersBase, Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged' },
      body: JSON.stringify({ request_id: submitData.request_id, decision: 'approve' })
    });
    assert.equal(forgedDecide.status, 401);
    assert.equal(((await forgedDecide.json()) as { error: string }).error, 'INVALID_APPROVER_TOKEN');

    // 3. jit-decision with Maya's Payment Creator JWT -> 403 APPROVER_ROLE_REQUIRED
    const wrongRoleDecide = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/jit-decision', {
      method: 'POST',
      headers: { ...headersBase, Authorization: `Bearer ${provData.session_jwt}` },
      body: JSON.stringify({ request_id: submitData.request_id, decision: 'approve' })
    });
    assert.equal(wrongRoleDecide.status, 403);
    assert.equal(((await wrongRoleDecide.json()) as { error: string }).error, 'APPROVER_ROLE_REQUIRED');

    // 4. jit-decision with self-approval JWT (claims.email === maya.lin@acme-corp.io, even with Audit Approver role) -> 403 SELF_APPROVAL_FORBIDDEN
    const nowSec = Math.floor(Date.now() / 1000);
    const selfApproverJwt = await signWorkforceJourneyJwt(
      {
        iss: 'https://iam.0trust.dev',
        sub: 'maya-lin',
        email: 'maya.lin@acme-corp.io',
        name: 'Maya Lin',
        department: 'Finance Operations',
        roles: ['Audit Approver'],
        scope: 'pam:approve',
        token_type: 'session',
        jti: 'apprv_self_1',
        sid: sessionId,
        iat: nowSec,
        exp: nowSec + 3600
      },
      jwtSecret,
      'production'
    );
    const selfApproveDecide = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/jit-decision', {
      method: 'POST',
      headers: { ...headersBase, Authorization: `Bearer ${selfApproverJwt.token}` },
      body: JSON.stringify({
        request_id: submitData.request_id,
        decision: 'approve',
        approver: { email: 'marcus.chen@acme-corp.io', name: 'Spoofed' }
      })
    });
    assert.equal(selfApproveDecide.status, 403);
    assert.equal(((await selfApproveDecide.json()) as { error: string }).error, 'SELF_APPROVAL_FORBIDDEN');

    // 5. logout without Authorization -> 401 MISSING_SESSION_TOKEN
    const noAuthLogout = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/logout', {
      method: 'POST',
      headers: headersBase,
      body: JSON.stringify({})
    });
    assert.equal(noAuthLogout.status, 401);
    assert.equal(((await noAuthLogout.json()) as { error: string }).error, 'MISSING_SESSION_TOKEN');

    // 6. logout with forged JWT -> 401 INVALID_SESSION_TOKEN & session remains ACTIVE
    const forgedLogout = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/logout', {
      method: 'POST',
      headers: { ...headersBase, Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged' },
      body: JSON.stringify({})
    });
    assert.equal(forgedLogout.status, 401);
    assert.equal(((await forgedLogout.json()) as { error: string }).error, 'INVALID_SESSION_TOKEN');

    // Verify session was NOT revoked (jit-decision with valid approver_jwt still succeeds)
    const validDecide = await app.request('https://0trust-lab-workforce-journey-abc.run.app/api/workforce-journey/jit-decision', {
      method: 'POST',
      headers: { ...headersBase, Authorization: `Bearer ${provData.approver_jwt}` },
      body: JSON.stringify({ request_id: submitData.request_id, decision: 'approve' })
    });
    assert.equal(validDecide.status, 200);
  });

  it('rejects oversized (>64 KB) JSON bodies with 413 PAYLOAD_TOO_LARGE across all 6 POST routes', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'workforce-journey' });
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'development',
        LAB_SLUG: 'workforce-journey'
      },
      kv
    });

    const oversizedBody = JSON.stringify({ padding: 'x'.repeat(65 * 1024) });
    const routes = [
      '/api/workforce-journey/login-provision',
      '/api/workforce-journey/jit-submit',
      '/api/workforce-journey/jit-decision',
      '/api/workforce-journey/request-jit',
      '/api/workforce-journey/protected-call',
      '/api/workforce-journey/logout'
    ];

    for (const route of routes) {
      const res = await app.request(`http://127.0.0.1:8080${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer dummy.jwt.token'
        },
        body: oversizedBody
      });
      assert.equal(res.status, 413, `Expected 413 for ${route}, got ${res.status}`);
      const json = (await res.json()) as { error: string };
      assert.equal(json.error, 'PAYLOAD_TOO_LARGE');
    }
  });

  it('returns 401 ENTRA_OIDC_REQUIRED on GET /entra/session when cookie is missing', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'workforce-journey' });
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'development',
        LAB_SLUG: 'workforce-journey'
      },
      kv
    });

    const res = await app.request('http://127.0.0.1:8080/api/workforce-journey/entra/session');
    assert.equal(res.status, 401);
    const json = (await res.json()) as { error: string };
    assert.equal(json.error, 'ENTRA_OIDC_REQUIRED');
  });
});
