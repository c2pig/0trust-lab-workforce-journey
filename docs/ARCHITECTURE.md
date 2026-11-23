# Workforce Identity Lifecycle (`0trust-lab-workforce-journey`) — Local Architecture

> **Role in the 0trust.dev Ecosystem**: Standalone **Model 1** micro-lab powering **Lab 1 (`/workforce-journey`)** at [`https://lab.0trust.dev/workforce-journey`](https://lab.0trust.dev/workforce-journey) via `0trust-lab-router` (local dev: `http://localhost:5174`).
> **Global Architecture Reference**: [`c2pig/0trust.dev/docs/ARCHITECTURE.md`](https://github.com/c2pig/0trust.dev/blob/main/docs/ARCHITECTURE.md)

## Architecture Diagrams

- **Top-Down Value-Stream Blueprint**: [workforce_journey_blueprint_topdown.svg](./diagrams/workforce_journey_blueprint_topdown.svg)
- **Platform Capability Zoom-In**: [workforce_journey_platform_capability_zoomin.svg](./diagrams/workforce_journey_platform_capability_zoomin.svg)

## Components & Boundaries

### 1. Standalone Frontend (`src/`)
- **Entry & Shell**: [`src/main.tsx`](../src/main.tsx) → [`src/App.tsx`](../src/App.tsx) mounts [`WorkforceLabPage`](../src/pages/WorkforceLabPage.tsx) with an `onBackHome` link returning to `0trust.dev` (`http://localhost:5173/` in local dev, `https://0trust.dev/` in production) and an interactive [`driver.js`](https://driverjs.com/) orientation tour overlay (`Lab Tour`).
- **Dropdown Role Switcher** ([`RoleSwitcherBar`](../src/components/RoleSwitcherBar.tsx)): Compact AppShell dropdown with notification indicators switching between isolated role workspaces:
  1. **Maya Lin** (`Finance Controller`) — FinCore Treasury ERP (settlement batch table, HTTP 403 Standing Privilege modal, 15m JIT request modal)
  2. **Marcus Chen** (`Finance Manager`) — AccessGuard PAM (business-friendly Approval Desk & active approvals)
  3. **Priya Nair** (`Security Ops`) — JIT & Session Activity Monitor (live JIT/session activity table & CAEP Universal Logout trigger)
- **X-Ray Telemetry Drawer** ([`XRayTelemetryDrawer`](../src/components/XRayTelemetryDrawer.tsx)): Sticky-bottom drawer displaying live W3C `traceparent` spans, decoded JWT headers/claims, and SCIM 2.0 record state.
- **Client Engine** ([`workforceJourneyClient.ts`](../src/engine/workforceJourneyClient.ts)): Calls `/api/workforce-journey/*` on Cloudflare Pages Functions with deterministic browser WebCrypto fallback when running under pure Vite local dev without Wrangler.

### 2. Edge Service Layer (`functions/api/`)
- **Observability Middleware** ([`_middleware.ts`](../functions/api/_middleware.ts)): Propagates W3C `traceparent`, redacts `Authorization` headers, and exports optional OTLP spans.
- **IdP Adapter** ([`idpAdapter.ts`](../functions/api/lib/idpAdapter.ts)): Dual-mode adapter supporting `edge-webcrypto` (KV-backed SCIM 2.0 + HS256 JWTs) and live `entra-external-id` (Microsoft Entra External ID OIDC + Microsoft Graph + optional `iam-demo` PAM API).
- **Crypto Helpers** ([`workforceJourneyCrypto.ts`](../functions/api/lib/workforceJourneyCrypto.ts)): HS256 JWT signing/verification via WebCrypto.
- **API Endpoints** (`functions/api/workforce-journey/`):
  - `GET /api/workforce-journey/config`
  - `POST /api/workforce-journey/login-provision`
  - `POST /api/workforce-journey/jit-submit`
  - `POST /api/workforce-journey/jit-decision`
  - `POST /api/workforce-journey/request-jit`
  - `POST /api/workforce-journey/protected-call`
  - `POST /api/workforce-journey/logout`
  - `GET /api/workforce-journey/entra/login`
  - `GET /api/workforce-journey/entra/callback`

### 3. KV State Prefixes (`STATE_KV`)
- `lab1:dir:<sessionId>` — SCIM 2.0 directory record & active `jti` list
- `lab1:jit-req:<sessionId>:<requestId>` — Pending/decided JIT elevation requests
- `lab1:revoked:<jti>` — CAEP Universal Logout revocation tombstones

### 4. Infrastructure (`infra/terraform/`)
- Provisions the Cloudflare Pages project (`0trust-lab-workforce-journey`) and `STATE_KV` binding via `managed-infrastructure//modules/cloudflare-pages-lab` with `enable_custom_domain = false` (served behind `0trust-lab-router` at `https://lab.0trust.dev/workforce-journey`).
- Provisions the Microsoft Entra External ID (CIAM) app registration and 15-minute JIT privileged security group via `managed-infrastructure//modules/entra-external-ciam`.

### 4. Automated Hub Sync & Shell Parity
- **Hub Dispatch (`.github/workflows/sync-to-hub.yml`)**: Fires a `repository_dispatch` (`event_type: lab_contract_updated`) to `c2pig/0trust.dev` whenever `lab.manifest.json` or `docs/diagrams/*.svg` changes on `main`.
- **Shared Shell (`@0trust/lab-shell`)**: `RoleSwitcherBar.tsx`, `XRayTelemetryDrawer.tsx`, `src/shell/index.ts`, and `src/index.css` are kept in parity with `c2pig/0trust.dev` via `scripts/sync-lab-shell.mjs`.
