import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Compass, Mail, RefreshCw, RotateCcw } from 'lucide-react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import {
  ObservabilitySpan,
  WorkforceJourneyDecodedJwt,
  WorkforceJourneyJitDecisionData,
  WorkforceJourneyJitRequestRecord,
  WorkforceJourneyJitSubmitData,
  WorkforceJourneyRole,
  WorkforceJourneyScimRecord
} from '../types';
import {
  callWorkforceJourneyApi,
  createVisitorSessionId,
  decideWorkforceJitRequest,
  fetchWorkforceJourneyConfig,
  resetBrowserFallbackSession,
  submitWorkforceJitRequest,
  WorkforceJourneyConfig,
  WorkforceJourneyLogoutData,
  WorkforceJourneyProtectedData,
  WorkforceJourneyProvisionData
} from '../engine/workforceJourneyClient';
import { RoleSeatItem, RoleSwitcherBar } from '../components/RoleSwitcherBar';
import { XRayTelemetryDrawer } from '../components/XRayTelemetryDrawer';

export interface WorkforceLabPageProps {
  onBackHome: () => void;
}

type SeatId = 'maya-lin' | 'marcus-chen' | 'priya-nair';

interface EndpointCallSnapshot {
  status: number;
  data: WorkforceJourneyProtectedData;
}

interface MonitorEventRow {
  id: string;
  time: string;
  user: string;
  activity: string;
  scope: string;
  location: string;
  status: 'ACTIVE' | 'DENIED 403' | 'PENDING' | 'GRANTED' | 'ANOMALY' | 'REVOKED';
  canRevoke?: boolean;
}

const DEFAULT_JUSTIFICATION = 'Q4 Ledger Close — Export & reconcile treasury batch (INC-4821)';

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function nowTimeStr(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

export const WorkforceLabPage: React.FC<WorkforceLabPageProps> = ({ onBackHome }) => {
  const [sessionId, setSessionId] = useState<string>(() => createVisitorSessionId());
  const sessionIdRef = useRef<string>(sessionId);
  sessionIdRef.current = sessionId;

  const [labMode, setLabMode] = useState<'sandbox' | 'entra-external-id'>('sandbox');
  const [labConfig, setLabConfig] = useState<WorkforceJourneyConfig | null>(null);
  const [entraTicket, setEntraTicket] = useState<string>('');
  const [entraIdentity, setEntraIdentity] = useState<{ oid: string; email: string } | null>(null);
  const [entraError, setEntraError] = useState<string | null>(null);

  // Role Switcher
  const [activeSeat, setActiveSeat] = useState<SeatId>('maya-lin');

  // Identity, Tokens & Directory State
  const [provisioning, setProvisioning] = useState<boolean>(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [sessionJwt, setSessionJwt] = useState<string>('');
  const [sessionClaims, setSessionClaims] = useState<WorkforceJourneyDecodedJwt | null>(null);
  const [jitJwt, setJitJwt] = useState<string>('');
  const [jitClaims, setJitClaims] = useState<WorkforceJourneyDecodedJwt | null>(null);
  const [jitRemainingSec, setJitRemainingSec] = useState<number>(0);
  const [scimRecord, setScimRecord] = useState<WorkforceJourneyScimRecord | null>(null);

  // Seat 1 — Maya Lin (FinCore Treasury ERP)
  const [erpLoading, setErpLoading] = useState<boolean>(false);
  const [erpExportResult, setErpExportResult] = useState<EndpointCallSnapshot | null>(null);
  const [show403Modal, setShow403Modal] = useState<boolean>(false);
  const [showJitModal, setShowJitModal] = useState<boolean>(false);
  const [justification, setJustification] = useState<string>(DEFAULT_JUSTIFICATION);
  const [jitSubmitLoading, setJitSubmitLoading] = useState<boolean>(false);

  // Seat 2 — Marcus Chen (AccessGuard PAM)
  const [pendingRequest, setPendingRequest] = useState<WorkforceJourneyJitRequestRecord | null>(null);
  const [approvedRequest, setApprovedRequest] = useState<WorkforceJourneyJitRequestRecord | null>(null);
  const [marcusLoading, setMarcusLoading] = useState<boolean>(false);

  // Seat 3 — Priya Nair (JIT & Session Activity Monitor)
  const [threatAlertActive, setThreatAlertActive] = useState<boolean>(false);
  const [priyaLoading, setPriyaLoading] = useState<boolean>(false);
  const [logoutResult, setLogoutResult] = useState<WorkforceJourneyLogoutData | null>(null);
  const [monitorRows, setMonitorRows] = useState<MonitorEventRow[]>([]);

  // X-Ray Telemetry Spans
  const [spans, setSpans] = useState<ObservabilitySpan[]>([]);

  const provisionedKeyRef = useRef<string>('');
  const tourLaunchedRef = useRef<boolean>(false);

  const recordSpan = useCallback((span: ObservabilitySpan) => {
    setSpans((prev) => [span, ...prev].slice(0, 40));
  }, []);

  const appendMonitorRow = useCallback((row: Omit<MonitorEventRow, 'id' | 'time'>) => {
    setMonitorRows((prev) => [
      {
        ...row,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: nowTimeStr()
      },
      ...prev
    ]);
  }, []);

  const isRevoked = scimRecord?.status === 'REVOKED' || Boolean(logoutResult);
  const isJitExpired = Boolean(jitJwt) && jitRemainingSec <= 0;
  const isElevatedActive = Boolean(jitJwt) && !isJitExpired && !isRevoked;

  const startLabTour = useCallback(() => {
    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayOpacity: 0.5,
      steps: [
        {
          popover: {
            title: 'Lab Orientation: Workforce Identity Lifecycle',
            description:
              'Welcome to this interactive lab. You will test Zero Standing Privilege, 15-minute Just-In-Time (JIT) elevation, and CAEP Universal Logout across three separate role workspaces.'
          }
        },
        {
          element: '#tour-role-switcher',
          popover: {
            title: 'Role Switcher',
            description:
              'Use this dropdown to switch between Maya Lin (FinCore ERP), Marcus Chen (AccessGuard PAM), and Priya Nair (JIT Activity Monitor). Notification dots indicate pending approvals or alerts.'
          }
        },
        {
          element: '#tour-workspace',
          popover: {
            title: 'Role Workspace',
            description:
              'This main area renders the live application for your active role. Start in FinCore ERP and click Export Q4 Treasury Ledger.'
          }
        },
        {
          element: '.xray-drawer',
          popover: {
            title: 'X-Ray Telemetry Drawer',
            description:
              'Expand this bottom drawer anytime to inspect live HTTP audit spans and decoded JWT claims.'
          }
        },
        {
          element: '#tour-lab-controls',
          popover: {
            title: 'Lab Controls',
            description:
              'Use Lab Tour to replay this orientation anytime, or Reset to restore the lab to its initial Base SSO state.'
          }
        }
      ]
    });
    driverObj.drive();
  }, []);

  // Launch Pearson-exam-lab style orientation tour once on initial load
  useEffect(() => {
    if (tourLaunchedRef.current) return;
    tourLaunchedRef.current = true;
    const timer = window.setTimeout(() => {
      startLabTour();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [startLabTour]);

  // Load config and parse Entra External ID callback parameters
  useEffect(() => {
    fetchWorkforceJourneyConfig().then(setLabConfig);

    const hashQuery = window.location.hash.includes('?')
      ? window.location.hash.split('?')[1]
      : window.location.search.replace(/^\?/, '');
    if (hashQuery) {
      const params = new URLSearchParams(hashQuery);
      const ticket = params.get('entra_ticket');
      const oid = params.get('oid');
      const email = params.get('email');
      const err = params.get('entra_error');
      if (ticket && oid && email) {
        setLabMode('entra-external-id');
        setEntraTicket(ticket);
        setEntraIdentity({ oid, email });
        setEntraError(null);
      } else if (err) {
        setLabMode('entra-external-id');
        setEntraError(err);
      }
    }
  }, []);

  const provisionMayaBaseSession = useCallback(
    async (targetSid: string, mode: 'sandbox' | 'entra-external-id', ticket: string) => {
      setProvisioning(true);
      setProvisionError(null);

      const res = await callWorkforceJourneyApi<WorkforceJourneyProvisionData>(
        '/api/workforce-journey/login-provision',
        {
          sessionId: targetSid,
          body: {
            personaId: 'maya-lin',
            roles: ['Viewer', 'Payment Creator'] satisfies WorkforceJourneyRole[],
            mode,
            entra_ticket: ticket || undefined
          }
        }
      );

      if (sessionIdRef.current !== targetSid) return;

      recordSpan(res.span);
      setProvisioning(false);

      if (!res.ok || !res.data.session_jwt) {
        setProvisionError(
          `HTTP ${res.status} · ${res.data.message || 'Unable to provision Base SSO session.'}`
        );
        return;
      }

      setSessionJwt(res.data.session_jwt);
      setSessionClaims(res.data.decoded_claims || null);
      if (res.data.scim_record) setScimRecord(res.data.scim_record);

      setMonitorRows([
        {
          id: 'init-sso',
          time: nowTimeStr(),
          user: res.data.scim_record?.userName || 'maya.lin@acme-corp.io',
          activity: 'Base SSO Login (SCIM Active)',
          scope: 'read:treasury',
          location: 'Singapore (SG)',
          status: 'ACTIVE'
        }
      ]);
    },
    [recordSpan]
  );

  // Auto-provision Base SSO on mount, reset, or resolved Entra ticket
  useEffect(() => {
    const canAutoProvision =
      labMode === 'sandbox' || (labMode === 'entra-external-id' && Boolean(entraIdentity && entraTicket));
    if (!canAutoProvision) return;

    const provisionKey = `${sessionId}:${labMode}:${entraTicket}`;
    if (provisionedKeyRef.current === provisionKey) return;
    provisionedKeyRef.current = provisionKey;

    void provisionMayaBaseSession(sessionId, labMode, entraTicket);
  }, [sessionId, labMode, entraIdentity, entraTicket, provisionMayaBaseSession]);

  // Live 15:00 countdown
  useEffect(() => {
    if (!jitJwt || jitRemainingSec <= 0 || isRevoked) return;
    const timer = window.setInterval(() => {
      setJitRemainingSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [jitJwt, jitRemainingSec, isRevoked]);

  const handleResetLab = () => {
    resetBrowserFallbackSession(sessionId);
    const freshSid = createVisitorSessionId();
    sessionIdRef.current = freshSid;
    provisionedKeyRef.current = '';
    setSessionId(freshSid);

    setActiveSeat('maya-lin');
    setProvisioning(false);
    setProvisionError(null);
    setSessionJwt('');
    setSessionClaims(null);
    setJitJwt('');
    setJitClaims(null);
    setJitRemainingSec(0);
    setScimRecord(null);

    setErpLoading(false);
    setErpExportResult(null);
    setShow403Modal(false);
    setShowJitModal(false);
    setJustification(DEFAULT_JUSTIFICATION);
    setJitSubmitLoading(false);

    setPendingRequest(null);
    setApprovedRequest(null);
    setMarcusLoading(false);

    setThreatAlertActive(false);
    setPriyaLoading(false);
    setLogoutResult(null);
    setMonitorRows([]);
    setSpans([]);
  };

  const handleSwitchMode = (nextMode: 'sandbox' | 'entra-external-id') => {
    if (nextMode === labMode) return;
    setLabMode(nextMode);
    setEntraError(null);
    handleResetLab();
  };

  // ==================== Seat 1: Maya Lin Actions ====================

  const handleExportQ4Ledger = async () => {
    const tokenToPresent = jitJwt || sessionJwt;
    if (!tokenToPresent) return;

    setErpLoading(true);
    const currentSid = sessionId;
    const res = await callWorkforceJourneyApi<WorkforceJourneyProtectedData>(
      '/api/workforce-journey/protected-call',
      {
        sessionId: currentSid,
        bearerToken: tokenToPresent,
        body: {
          target_endpoint: 'payment_create',
          action: 'EXPORT_Q4_TREASURY_LEDGER',
          simulate_expired: false
        }
      }
    );

    if (sessionIdRef.current !== currentSid) return;
    recordSpan(res.span);
    setErpLoading(false);
    setErpExportResult({ status: res.status, data: res.data });

    const userEmail = scimRecord?.userName || 'maya.lin@acme-corp.io';

    if (res.status === 403) {
      appendMonitorRow({
        user: userEmail,
        activity: 'Export Blocked (No Standing Priv)',
        scope: 'read:treasury',
        location: 'Singapore (SG)',
        status: 'DENIED 403'
      });
      setShow403Modal(true);
    } else if (res.status === 200) {
      setThreatAlertActive(true);
      appendMonitorRow({
        user: userEmail,
        activity: 'Ledger Export (admin:temp)',
        scope: '15m JIT',
        location: 'Frankfurt (DE)',
        status: 'ANOMALY',
        canRevoke: true
      });
    }
  };

  const handleSubmitJitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionJwt || isRevoked) return;

    setJitSubmitLoading(true);
    const currentSid = sessionId;

    const res = await submitWorkforceJitRequest({
      sessionId: currentSid,
      sessionJwt,
      justification,
      ttlSeconds: 900,
      requestedRoles: ['Viewer', 'Payment Creator'],
      permanent: false,
      mode: labMode
    });

    if (sessionIdRef.current !== currentSid) return;
    recordSpan(res.span);
    setJitSubmitLoading(false);
    setShowJitModal(false);

    const data: WorkforceJourneyJitSubmitData = res.data;
    if (!res.ok || !data.request) return;

    setPendingRequest(data.request);
    appendMonitorRow({
      user: data.request.requester.email,
      activity: 'JIT Request Submitted',
      scope: 'admin:temp · 15m',
      location: 'Singapore (SG)',
      status: 'PENDING'
    });
  };

  // ==================== Seat 2: Marcus Chen Actions ====================

  const handleMarcusDecision = async (decision: 'approve' | 'deny') => {
    if (!pendingRequest) return;

    setMarcusLoading(true);
    const currentSid = sessionId;
    const reason =
      decision === 'approve'
        ? 'Approved 15m JIT elevation for Q4 Ledger Close reconciliation'
        : 'Denied by Finance Manager during AccessGuard review';

    const res = await decideWorkforceJitRequest({
      sessionId: currentSid,
      requestId: pendingRequest.request_id,
      decision,
      approver: {
        id: 'marcus-chen',
        name: 'Marcus Chen',
        email: 'marcus.chen@acme-corp.io'
      },
      reason,
      mode: labMode
    });

    if (sessionIdRef.current !== currentSid) return;
    recordSpan(res.span);
    setMarcusLoading(false);

    const data: WorkforceJourneyJitDecisionData = res.data;
    if (!res.ok) return;

    if (decision === 'deny') {
      setPendingRequest(null);
      return;
    }

    if (data.jit_jwt) {
      setJitJwt(data.jit_jwt);
      setJitClaims(data.decoded_claims || null);
      setJitRemainingSec(data.expires_in || 900);
    }
    if (data.scim_record) {
      setScimRecord(data.scim_record);
    }
    setApprovedRequest(data.request || { ...pendingRequest, status: 'APPROVED' });
    setPendingRequest(null);
    setErpExportResult(null);

    appendMonitorRow({
      user: pendingRequest.requester.email,
      activity: 'JIT Token Minted (Marcus Chen)',
      scope: 'admin:temp · 15m',
      location: 'Singapore (SG)',
      status: 'GRANTED',
      canRevoke: true
    });
  };

  // ==================== Seat 3: Priya Nair Actions ====================

  const handleCaepUniversalLogout = async () => {
    if ((!sessionJwt && !jitJwt) || isRevoked) return;

    setPriyaLoading(true);
    const currentSid = sessionId;
    const res = await callWorkforceJourneyApi<WorkforceJourneyLogoutData>(
      '/api/workforce-journey/logout',
      {
        sessionId: currentSid,
        bearerToken: jitJwt || sessionJwt,
        body: {
          session_jwt: sessionJwt,
          jit_jwt: jitJwt,
          mode: labMode,
          reason: 'ALERT-9914 Impossible Travel — SecOps Universal Logout (OpenID CAEP)'
        }
      }
    );

    if (sessionIdRef.current !== currentSid) return;
    recordSpan(res.span);
    setPriyaLoading(false);

    if (!res.ok) return;

    setLogoutResult(res.data);
    if (res.data.scim_record) {
      setScimRecord(res.data.scim_record);
    } else if (scimRecord) {
      setScimRecord({
        ...scimRecord,
        active: false,
        status: 'REVOKED',
        revoked_at: new Date().toISOString()
      });
    }

    setErpExportResult(null);
    setJitRemainingSec(0);
    appendMonitorRow({
      user: scimRecord?.userName || 'maya.lin@acme-corp.io',
      activity: 'CAEP Universal Logout',
      scope: 'All JTIs',
      location: 'Edge KV',
      status: 'REVOKED'
    });
  };

  // ==================== Derived Badges & Status ====================

  const globalStatusLabel = isRevoked
    ? 'CAEP Revoked'
    : threatAlertActive
      ? 'Threat Detected'
      : isElevatedActive
        ? 'JIT Granted (15m)'
        : pendingRequest?.status === 'PENDING'
          ? 'JIT Requested'
          : 'Base SSO';

  const seats: RoleSeatItem<SeatId>[] = [
    {
      id: 'maya-lin',
      name: 'Maya Lin',
      roleLabel: 'Finance Controller',
      appLabel: 'FinCore Treasury ERP',
      avatarInitials: 'ML',
      badge: isRevoked
        ? { text: 'Revoked', tone: 'crimson' }
        : isElevatedActive
          ? { text: '15m JIT', tone: 'emerald' }
          : { text: 'Base SSO', tone: 'neutral' }
    },
    {
      id: 'marcus-chen',
      name: 'Marcus Chen',
      roleLabel: 'Finance Manager',
      appLabel: 'AccessGuard PAM',
      avatarInitials: 'MC',
      badge:
        pendingRequest?.status === 'PENDING'
          ? { text: '1 Pending', tone: 'amber', pulse: true }
          : null
    },
    {
      id: 'priya-nair',
      name: 'Priya Nair',
      roleLabel: 'Security Ops',
      appLabel: 'JIT Activity Monitor',
      avatarInitials: 'PN',
      badge:
        threatAlertActive && !isRevoked
          ? { text: 'Alert', tone: 'crimson', pulse: true }
          : null
    }
  ];

  const userEmail = scimRecord?.userName || 'maya.lin@acme-corp.io';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)'
      }}
    >
      {/* 1. Compact AppShell Top Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--border-subtle)'
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            padding: '0 16px',
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          {/* Left: Back + Brand + Status Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <button
              type="button"
              onClick={onBackHome}
              className="btn btn-sm"
              style={{ padding: '5px 9px' }}
              title="All Labs"
            >
              <ArrowLeft size={13} />
              <span>All Labs</span>
            </button>
            <span
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap'
              }}
            >
              Workforce Identity Lifecycle
            </span>
            <span className="badge" style={{ whiteSpace: 'nowrap' }}>
              {globalStatusLabel}
            </span>
          </div>

          {/* Right: Timer + Mode + Dropdown Role Switcher + Lab Tour + Reset */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {isElevatedActive && (
              <span className="badge badge-amber mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                JIT {formatCountdown(jitRemainingSec)}
              </span>
            )}

            <div
              style={{
                display: 'inline-flex',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden'
              }}
            >
              <button
                type="button"
                onClick={() => handleSwitchMode('sandbox')}
                style={{
                  padding: '5px 8px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: labMode === 'sandbox' ? 'var(--text-primary)' : 'var(--bg-surface)',
                  color: labMode === 'sandbox' ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                Sandbox
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('entra-external-id')}
                style={{
                  padding: '5px 8px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  border: 'none',
                  borderLeft: '1px solid var(--border-strong)',
                  cursor: 'pointer',
                  backgroundColor:
                    labMode === 'entra-external-id' ? 'var(--text-primary)' : 'var(--bg-surface)',
                  color: labMode === 'entra-external-id' ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                Entra ID
              </button>
            </div>

            <RoleSwitcherBar
              seats={seats}
              activeSeatId={activeSeat}
              onSelectSeat={setActiveSeat}
              ariaLabel="Switch workspace persona"
            />

            <div id="tour-lab-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={startLabTour}
                className="btn btn-sm"
                style={{
                  backgroundColor: 'var(--accent-primary-dim)',
                  borderColor: 'var(--accent-primary-border)',
                  color: 'var(--accent-primary-ink)'
                }}
              >
                <Compass size={13} />
                <span>Lab Tour</span>
              </button>
              <button type="button" onClick={handleResetLab} className="btn btn-sm">
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Center Role Workspace */}
      <main id="tour-workspace" style={{ flex: 1, padding: '16px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Entra External ID Banner when selected */}
          {labMode === 'entra-external-id' && (
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap',
                fontSize: '12px'
              }}
            >
              {entraError && (
                <span style={{ color: 'var(--accent-crimson-ink)' }}>
                  Entra OIDC Notice: <code>{entraError}</code>
                </span>
              )}
              {entraIdentity ? (
                <>
                  <span className="mono" style={{ color: 'var(--accent-emerald-ink)', fontWeight: 600 }}>
                    Verified · {entraIdentity.email} ({entraIdentity.oid.slice(0, 12)}…)
                  </span>
                  <span className="badge badge-emerald">Entra External ID Active</span>
                </>
              ) : labConfig?.entra_external_id_configured ? (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Authenticate with Microsoft Entra External ID Email OTP to bind a real CIAM identity.
                  </span>
                  <a href="/api/workforce-journey/entra/login" className="btn btn-dark btn-sm">
                    <Mail size={13} />
                    <span>Sign in with Email OTP</span>
                  </a>
                </>
              ) : (
                <span style={{ color: 'var(--accent-primary-ink)' }}>
                  Entra External ID not configured yet — switch to <strong>Sandbox</strong> to test immediately.
                </span>
              )}
            </div>
          )}

          {/* Provision Error */}
          {provisionError && (
            <div
              role="alert"
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--accent-crimson-dim)',
                border: '1px solid var(--accent-crimson-border)',
                color: 'var(--accent-crimson-ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12.5px'
              }}
            >
              <span>{provisionError}</span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={provisioning}
                onClick={() => void provisionMayaBaseSession(sessionId, labMode, entraTicket)}
              >
                <RefreshCw size={12} />
                <span>{provisioning ? 'Provisioning…' : 'Retry'}</span>
              </button>
            </div>
          )}

          {/* ==================== SEAT 1: FINCORE TREASURY ERP ==================== */}
          {activeSeat === 'maya-lin' && (
            <section
              aria-label="FinCore Treasury ERP"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              {/* ERP Top Bar */}
              <div
                style={{
                  padding: '10px 18px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '5px',
                      backgroundColor: '#2563eb',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  >
                    FC
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700 }}>FinCore Treasury ERP</span>
                  <span
                    style={{
                      fontSize: '13px',
                      color: '#cbd5e1',
                      borderLeft: '1px solid #334155',
                      paddingLeft: '10px'
                    }}
                  >
                    Finance / Ledger Close / Q4 Settlements
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#e2e8f0' }}>Maya Lin · Finance Controller</span>
                  <span
                    className="mono"
                    style={{
                      padding: '4px 9px',
                      borderRadius: '5px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      backgroundColor: isRevoked ? '#450a0a' : isElevatedActive ? '#064e3b' : '#1e293b',
                      color: isRevoked ? '#fca5a5' : isElevatedActive ? '#6ee7b7' : '#fcd34d',
                      border: `1px solid ${isRevoked ? '#991b1b' : isElevatedActive ? '#047857' : '#334155'}`
                    }}
                  >
                    {isRevoked ? 'REVOKED (HTTP 401)' : isElevatedActive ? '15m JIT Elevated' : 'Base SSO'}
                  </span>
                </div>
              </div>

              {/* Compact KPI Strip */}
              <div
                style={{
                  padding: '14px 18px',
                  backgroundColor: 'var(--bg-canvas)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '12px'
                }}
              >
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Batch Total
                  </div>
                  <div className="mono" style={{ fontSize: '18px', fontWeight: 700, marginTop: '3px' }}>
                    $14,250,800.00
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Status
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 700,
                      marginTop: '4px',
                      color:
                        erpExportResult?.status === 200
                          ? 'var(--accent-emerald)'
                          : 'var(--accent-amber)'
                    }}
                  >
                    {erpExportResult?.status === 200 ? 'Exported' : 'Awaiting Export'}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Required Role
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 700, marginTop: '4px' }}>
                    Payment Creator
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Privilege Window
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: '15px',
                      fontWeight: 700,
                      marginTop: '4px',
                      color: isElevatedActive ? 'var(--accent-emerald)' : 'var(--text-primary)'
                    }}
                  >
                    {isElevatedActive ? `${formatCountdown(jitRemainingSec)} Remaining` : '0m Standing'}
                  </div>
                </div>
              </div>

              {/* Batch Action Header */}
              <div
                style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}
              >
                <div>
                  <h2 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Treasury Settlement Batch #TB-9042
                  </h2>
                  <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    38 cleared vendor invoices ready for SWIFT dispatch.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: '13.5px', padding: '9px 16px' }}
                  disabled={erpLoading || provisioning || !sessionJwt}
                  onClick={() => void handleExportQ4Ledger()}
                >
                  {erpLoading ? 'Exporting…' : 'Export Q4 Treasury Ledger'}
                </button>
              </div>

              {/* Settlement Table */}
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Line ID</th>
                      <th>Counterparty</th>
                      <th>GL Code</th>
                      <th style={{ textAlign: 'right' }}>Amount (USD)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="mono" style={{ fontWeight: 600 }}>TL-2026-9042-01</td>
                      <td style={{ fontWeight: 500 }}>Apex Global Cloud Infrastructure</td>
                      <td className="mono">GL-6100-IT</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>$4,850,000.00</td>
                      <td><span className="badge badge-emerald">Verified</span></td>
                    </tr>
                    <tr>
                      <td className="mono" style={{ fontWeight: 600 }}>TL-2026-9042-02</td>
                      <td style={{ fontWeight: 500 }}>Pacific Clearing Corp</td>
                      <td className="mono">GL-1200-FX</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>$7,200,800.00</td>
                      <td><span className="badge badge-emerald">Verified</span></td>
                    </tr>
                    <tr>
                      <td className="mono" style={{ fontWeight: 600 }}>TL-2026-9042-03</td>
                      <td style={{ fontWeight: 500 }}>Starlight Logistics Services</td>
                      <td className="mono">GL-5400-OPEX</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>$2,200,000.00</td>
                      <td><span className="badge badge-emerald">Verified</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* In-App Confirmation Banners */}
              {pendingRequest?.status === 'PENDING' && !isElevatedActive && !isRevoked && (
                <div
                  style={{
                    padding: '10px 18px',
                    backgroundColor: 'var(--accent-primary-dim)',
                    borderTop: '1px solid var(--accent-primary-border)',
                    color: 'var(--accent-primary-ink)',
                    fontSize: '12.5px'
                  }}
                >
                  <strong>JIT Request Submitted (#{pendingRequest.request_id}):</strong> Waiting for manager approval in AccessGuard PAM.
                </div>
              )}

              {erpExportResult?.status === 200 && !isRevoked && (
                <div
                  style={{
                    padding: '10px 18px',
                    backgroundColor: 'var(--accent-emerald-dim)',
                    borderTop: '1px solid var(--accent-emerald-border)',
                    color: 'var(--accent-emerald-ink)',
                    fontSize: '12.5px'
                  }}
                >
                  <strong>Export Complete (HTTP 200):</strong> Signed file{' '}
                  <code className="mono">batch_q4_signed.csv.enc</code> generated under 15m JIT grant.
                </div>
              )}

              {(isRevoked || erpExportResult?.status === 401) && (
                <div
                  style={{
                    padding: '10px 18px',
                    backgroundColor: 'var(--accent-crimson-dim)',
                    borderTop: '1px solid var(--accent-crimson-border)',
                    color: 'var(--accent-crimson-ink)',
                    fontSize: '12.5px'
                  }}
                >
                  <strong>Session Terminated (HTTP 401):</strong> Active JIT privilege revoked mid-flight via CAEP Universal Logout.
                </div>
              )}
            </section>
          )}

          {/* ==================== SEAT 2: ACCESSGUARD PAM ==================== */}
          {activeSeat === 'marcus-chen' && (
            <section
              aria-label="AccessGuard PAM"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              {/* PAM Header */}
              <div
                style={{
                  padding: '10px 18px',
                  backgroundColor: 'var(--bg-canvas)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '5px',
                      backgroundColor: '#7c3aed',
                      color: '#ffffff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  >
                    AG
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700 }}>AccessGuard PAM</span>
                  <span className="badge" style={{ fontSize: '12px' }}>Approval Desk</span>
                </div>
                <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Marcus Chen · Finance Manager
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '220px 1fr'
                }}
              >
                {/* PAM Sidebar */}
                <aside
                  style={{
                    backgroundColor: 'var(--bg-canvas)',
                    borderRight: '1px solid var(--border-subtle)',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '13.5px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#f3e8ff',
                      color: '#581c87',
                      border: '1px solid #d8b4fe',
                      fontWeight: 600
                    }}
                  >
                    <span>Approval Inbox</span>
                    {pendingRequest?.status === 'PENDING' && (
                      <span className="badge badge-amber" style={{ padding: '2px 7px', fontSize: '12px' }}>
                        1
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    <span>Active Approvals</span>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {isElevatedActive ? '1' : '0'}
                    </span>
                  </div>
                </aside>

                {/* PAM Main Desk */}
                <div style={{ padding: '18px' }}>
                  {pendingRequest?.status === 'PENDING' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          Pending Access Approvals
                        </h3>
                        <span className="badge badge-amber" style={{ fontSize: '12px' }}>
                          1 Awaiting Review
                        </span>
                      </div>

                      <div className="data-table-wrapper">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Who</th>
                              <th>Requested Action</th>
                              <th>Business Justification</th>
                              <th>When / Duration</th>
                              <th style={{ textAlign: 'right' }}>Decision</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>
                                <div style={{ fontWeight: 700 }}>{pendingRequest.requester.name}</div>
                                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                                  Finance Controller
                                </div>
                              </td>
                              <td style={{ fontWeight: 600 }}>
                                Export Q4 Treasury Settlement Batch
                              </td>
                              <td style={{ color: 'var(--text-secondary)', maxWidth: '300px' }}>
                                {pendingRequest.justification}
                              </td>
                              <td>
                                <div style={{ fontWeight: 600 }}>15 Minutes</div>
                                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                                  Just now · Temporary
                                </div>
                              </td>
                              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'inline-flex', gap: '8px' }}>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    style={{ fontSize: '13px', padding: '7px 12px' }}
                                    disabled={marcusLoading}
                                    onClick={() => void handleMarcusDecision('deny')}
                                  >
                                    Deny
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={marcusLoading}
                                    onClick={() => void handleMarcusDecision('approve')}
                                    style={{
                                      fontSize: '13px',
                                      padding: '7px 14px',
                                      backgroundColor: '#7c3aed',
                                      borderColor: '#7c3aed',
                                      color: '#ffffff'
                                    }}
                                  >
                                    {marcusLoading ? 'Approving…' : 'Approve 15m Access'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : approvedRequest && isElevatedActive ? (
                    <div
                      style={{
                        border: '1px solid var(--accent-emerald-border)',
                        backgroundColor: 'var(--accent-emerald-dim)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}
                    >
                      <div>
                        <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>15-Minute Access Approved</h3>
                        <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                          {approvedRequest.requester.name} (Finance Controller) is authorized to export the Q4 Treasury Ledger.
                        </p>
                      </div>
                      <span className="badge badge-emerald mono" style={{ fontSize: '13px', padding: '5px 12px' }}>
                        EXPIRES: {formatCountdown(jitRemainingSec)}
                      </span>
                    </div>
                  ) : (
                    <div
                      style={{
                        border: '1px dashed var(--border-strong)',
                        borderRadius: 'var(--radius-md)',
                        padding: '32px 18px',
                        textAlign: 'center',
                        backgroundColor: 'var(--bg-canvas)'
                      }}
                    >
                      <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>Approval Inbox Clear</h3>
                      <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        No pending access requests awaiting your review.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ==================== SEAT 3: JIT & SESSION ACTIVITY MONITOR ==================== */}
          {activeSeat === 'priya-nair' && (
            <section
              aria-label="JIT and Session Activity Monitor"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              {/* Simple Header */}
              <div
                style={{
                  padding: '10px 18px',
                  backgroundColor: 'var(--bg-canvas)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '5px',
                      backgroundColor: '#059669',
                      color: '#ffffff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  >
                    JM
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700 }}>
                    JIT &amp; Session Activity Monitor
                  </span>
                </div>
                <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Priya Nair · Security Ops
                </span>
              </div>

              {/* Anomaly Alert Bar */}
              {threatAlertActive && !isRevoked && (
                <div
                  style={{
                    padding: '10px 18px',
                    backgroundColor: 'var(--accent-crimson-dim)',
                    borderBottom: '1px solid var(--accent-crimson-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap'
                  }}
                >
                  <span style={{ fontSize: '12.5px', color: 'var(--accent-crimson-ink)' }}>
                    <strong>ALERT-9914:</strong> Impossible travel detected for{' '}
                    <strong>{userEmail}</strong> (Singapore → Frankfurt in 4m).
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={priyaLoading}
                    onClick={() => void handleCaepUniversalLogout()}
                    style={{
                      backgroundColor: 'var(--accent-crimson)',
                      borderColor: 'var(--accent-crimson)',
                      color: '#ffffff'
                    }}
                  >
                    {priyaLoading ? 'Revoking…' : 'Trigger CAEP Universal Logout'}
                  </button>
                </div>
              )}

              {isRevoked && (
                <div
                  style={{
                    padding: '10px 18px',
                    backgroundColor: 'var(--accent-emerald-dim)',
                    borderBottom: '1px solid var(--accent-emerald-border)',
                    color: 'var(--accent-emerald-ink)',
                    fontSize: '12.5px',
                    fontWeight: 600
                  }}
                >
                  CAEP Universal Logout complete — all active sessions for {userEmail} revoked.
                </div>
              )}

              {/* Simple Monitoring Table */}
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>User</th>
                      <th>Activity / Event</th>
                      <th>Scope / TTL</th>
                      <th>Location</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monitorRows.map((row) => {
                      const badgeClass =
                        row.status === 'GRANTED'
                          ? 'badge-emerald'
                          : row.status === 'ANOMALY' ||
                              row.status === 'REVOKED' ||
                              row.status === 'DENIED 403'
                            ? 'badge-crimson'
                            : row.status === 'PENDING'
                              ? 'badge-amber'
                              : '';

                      return (
                        <tr key={row.id}>
                          <td className="mono" style={{ color: 'var(--text-muted)' }}>
                            {row.time}
                          </td>
                          <td style={{ fontWeight: 500 }}>{row.user}</td>
                          <td>{row.activity}</td>
                          <td className="mono">{row.scope}</td>
                          <td>{row.location}</td>
                          <td>
                            <span className={`badge ${badgeClass}`}>{row.status}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {row.canRevoke && !isRevoked ? (
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={priyaLoading}
                                onClick={() => void handleCaepUniversalLogout()}
                                style={{
                                  backgroundColor: 'var(--accent-crimson)',
                                  borderColor: 'var(--accent-crimson)',
                                  color: '#ffffff',
                                  padding: '3px 8px'
                                }}
                              >
                                Revoke
                              </button>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* HTTP 403 Standing Privilege Modal */}
      {show403Modal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Standing Privilege Denied">
          <div className="modal-window" style={{ maxWidth: '460px' }}>
            <div
              className="modal-header"
              style={{ backgroundColor: 'var(--accent-amber-dim)', borderColor: 'var(--accent-amber-border)' }}
            >
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-amber-ink)' }}>
                  HTTP 403 · Standing Privilege Denied
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--accent-amber-ink)' }}>
                  Zero Standing Privilege enforced
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShow403Modal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  color: 'var(--accent-amber-ink)'
                }}
              >
                &times;
              </button>
            </div>
            <div className="modal-body" style={{ fontSize: '12.5px', gap: '12px' }}>
              <p style={{ color: 'var(--text-secondary)' }}>
                Base SSO grants read-only Viewer context. Exporting payment batches requires a 15-minute JIT
                token approved by Marcus Chen.
              </p>
              <div
                className="mono"
                style={{
                  padding: '10px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-canvas)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px'
                }}
              >
                <div>
                  Required: <strong style={{ color: 'var(--accent-primary)' }}>admin:temp + Payment Creator</strong>
                </div>
                <div>
                  Current: <span style={{ color: 'var(--accent-amber)' }}>scope="read:treasury"</span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShow403Modal(false)}>
                  Dismiss
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setShow403Modal(false);
                    setShowJitModal(true);
                  }}
                >
                  Request 15m JIT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clean 15m JIT Request Modal (No Traps) */}
      {showJitModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Request 15m JIT Elevation">
          <div className="modal-window" style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '14px', fontWeight: 700 }}>Request 15m JIT Elevation</h3>
              <button
                type="button"
                onClick={() => setShowJitModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>
            <form onSubmit={(e) => void handleSubmitJitRequest(e)} className="modal-body" style={{ gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Target Scope
                </label>
                <input
                  type="text"
                  readOnly
                  value="FinCore ERP — Payment Creator (admin:temp)"
                  className="input-control mono"
                  style={{ backgroundColor: 'var(--bg-canvas)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Grant Duration
                </label>
                <input
                  type="text"
                  readOnly
                  value="15 Minutes (Ephemeral JIT)"
                  className="input-control"
                  style={{ backgroundColor: 'var(--bg-canvas)', fontWeight: 600 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Business Justification
                </label>
                <input
                  type="text"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  className="input-control"
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowJitModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={jitSubmitLoading}>
                  {jitSubmitLoading ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Original Sticky-Bottom X-Ray Telemetry Drawer */}
      <XRayTelemetryDrawer
        spans={spans}
        sessionJwt={sessionJwt}
        sessionClaims={sessionClaims}
        jitJwt={jitJwt}
        jitClaims={jitClaims}
        scimRecord={scimRecord}
        caepEvent={logoutResult?.caep_event || null}
        onClear={() => setSpans([])}
      />
    </div>
  );
};
