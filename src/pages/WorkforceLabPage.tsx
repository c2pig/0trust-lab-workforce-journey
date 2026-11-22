import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cloud,
  FileSpreadsheet,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  XCircle,
  Zap
} from 'lucide-react';
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
type MayaSubView = 'erp' | 'access-hub';
type DurationOption = '15m' | 'permanent';

interface EndpointCallSnapshot {
  status: number;
  data: WorkforceJourneyProtectedData;
}

interface TestedTrapsState {
  sodConflict: boolean;
  zspTtlExceeded: boolean;
  grantPermanentAdmin: boolean;
  outOfScopeWire: boolean;
  expirySimulation: boolean;
  waitForExpiry: boolean;
}

const INITIAL_TRAPS: TestedTrapsState = {
  sodConflict: false,
  zspTtlExceeded: false,
  grantPermanentAdmin: false,
  outOfScopeWire: false,
  expirySimulation: false,
  waitForExpiry: false
};

const DEFAULT_JUSTIFICATION = 'Q4 Ledger Close — Export & reconcile treasury batch (INC-4821)';

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

  // 3-Seat Navigation
  const [activeSeat, setActiveSeat] = useState<SeatId>('maya-lin');
  const [mayaView, setMayaView] = useState<MayaSubView>('erp');
  const [pendingAutoLandToErp, setPendingAutoLandToErp] = useState<boolean>(false);

  // Identity, Tokens & Directory State
  const [provisioning, setProvisioning] = useState<boolean>(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [sessionJwt, setSessionJwt] = useState<string>('');
  const [sessionClaims, setSessionClaims] = useState<WorkforceJourneyDecodedJwt | null>(null);
  const [jitJwt, setJitJwt] = useState<string>('');
  const [jitClaims, setJitClaims] = useState<WorkforceJourneyDecodedJwt | null>(null);
  const [jitRemainingSec, setJitRemainingSec] = useState<number>(0);
  const [isFastForwarded, setIsFastForwarded] = useState<boolean>(false);
  const [scimRecord, setScimRecord] = useState<WorkforceJourneyScimRecord | null>(null);

  // Seat 1 — Maya Lin (FinCore Treasury ERP + Access Hub)
  const [erpLoading, setErpLoading] = useState<boolean>(false);
  const [erpExportResult, setErpExportResult] = useState<EndpointCallSnapshot | null>(null);
  const [erpApproveResult, setErpApproveResult] = useState<EndpointCallSnapshot | null>(null);
  const [includeAuditApproverTrap, setIncludeAuditApproverTrap] = useState<boolean>(false);
  const [durationOption, setDurationOption] = useState<DurationOption>('15m');
  const [justification, setJustification] = useState<string>(DEFAULT_JUSTIFICATION);
  const [jitSubmitLoading, setJitSubmitLoading] = useState<boolean>(false);
  const [jitSubmitFeedback, setJitSubmitFeedback] = useState<{
    status: number;
    ok: boolean;
    title: string;
    detail: string;
  } | null>(null);

  // Seat 2 — Marcus Chen (AccessGuard Approval Inbox)
  const [pendingRequest, setPendingRequest] = useState<WorkforceJourneyJitRequestRecord | null>(null);
  const [approvedRequest, setApprovedRequest] = useState<WorkforceJourneyJitRequestRecord | null>(null);
  const [deniedRequest, setDeniedRequest] = useState<WorkforceJourneyJitRequestRecord | null>(null);
  const [marcusLoading, setMarcusLoading] = useState<boolean>(false);
  const [marcusFeedback, setMarcusFeedback] = useState<{
    status: number;
    ok: boolean;
    title: string;
    detail: string;
  } | null>(null);

  // Seat 3 — Priya Nair (Identity Threat Console)
  const [threatAlertActive, setThreatAlertActive] = useState<boolean>(false);
  const [priyaWaitedTrap, setPriyaWaitedTrap] = useState<boolean>(false);
  const [priyaLoading, setPriyaLoading] = useState<boolean>(false);
  const [logoutResult, setLogoutResult] = useState<WorkforceJourneyLogoutData | null>(null);

  // Phase 4 — CAEP Return Proof & Reflection Debrief
  const [caepMidFlightVerified, setCaepMidFlightVerified] = useState<boolean>(false);
  const [testedTraps, setTestedTraps] = useState<TestedTrapsState>(INITIAL_TRAPS);

  // X-Ray Telemetry Spans
  const [spans, setSpans] = useState<ObservabilitySpan[]>([]);

  const provisionedKeyRef = useRef<string>('');

  const recordSpan = useCallback((span: ObservabilitySpan) => {
    setSpans((prev) => [span, ...prev].slice(0, 40));
  }, []);

  const isRevoked = scimRecord?.status === 'REVOKED' || Boolean(logoutResult);
  const isJitExpired = Boolean(jitJwt) && (isFastForwarded || jitRemainingSec <= 0);
  const isElevatedActive = Boolean(jitJwt) && !isJitExpired && !isRevoked;

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
    },
    [recordSpan]
  );

  // Auto-provision Maya Lin's Base SSO on mount, reset, or resolved Entra ticket
  useEffect(() => {
    const canAutoProvision =
      labMode === 'sandbox' || (labMode === 'entra-external-id' && Boolean(entraIdentity && entraTicket));
    if (!canAutoProvision) return;

    const provisionKey = `${sessionId}:${labMode}:${entraTicket}`;
    if (provisionedKeyRef.current === provisionKey) return;
    provisionedKeyRef.current = provisionKey;

    void provisionMayaBaseSession(sessionId, labMode, entraTicket);
  }, [sessionId, labMode, entraIdentity, entraTicket, provisionMayaBaseSession]);

  // Live 15:00 countdown shared across Seat 1 (Maya) and Seat 3 (Priya)
  useEffect(() => {
    if (!jitJwt || jitRemainingSec <= 0 || isFastForwarded || isRevoked) return;
    const timer = window.setInterval(() => {
      setJitRemainingSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [jitJwt, jitRemainingSec, isFastForwarded, isRevoked]);

  const handleResetLab = () => {
    resetBrowserFallbackSession(sessionId);
    const freshSid = createVisitorSessionId();
    sessionIdRef.current = freshSid;
    provisionedKeyRef.current = '';
    setSessionId(freshSid);

    setActiveSeat('maya-lin');
    setMayaView('erp');
    setPendingAutoLandToErp(false);

    setProvisioning(false);
    setProvisionError(null);
    setSessionJwt('');
    setSessionClaims(null);
    setJitJwt('');
    setJitClaims(null);
    setJitRemainingSec(0);
    setIsFastForwarded(false);
    setScimRecord(null);

    setErpLoading(false);
    setErpExportResult(null);
    setErpApproveResult(null);
    setIncludeAuditApproverTrap(false);
    setDurationOption('15m');
    setJustification(DEFAULT_JUSTIFICATION);
    setJitSubmitLoading(false);
    setJitSubmitFeedback(null);

    setPendingRequest(null);
    setApprovedRequest(null);
    setDeniedRequest(null);
    setMarcusLoading(false);
    setMarcusFeedback(null);

    setThreatAlertActive(false);
    setPriyaWaitedTrap(false);
    setPriyaLoading(false);
    setLogoutResult(null);

    setCaepMidFlightVerified(false);
    setTestedTraps(INITIAL_TRAPS);
    setSpans([]);
  };

  const handleSwitchMode = (nextMode: 'sandbox' | 'entra-external-id') => {
    if (nextMode === labMode) return;
    setLabMode(nextMode);
    setEntraError(null);
    handleResetLab();
  };

  const handleSelectSeat = (seatId: SeatId) => {
    if (seatId === 'maya-lin' && pendingAutoLandToErp) {
      setMayaView('erp');
      setPendingAutoLandToErp(false);
    }
    setActiveSeat(seatId);
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
          simulate_expired: isFastForwarded && !isRevoked
        }
      }
    );

    if (sessionIdRef.current !== currentSid) return;
    recordSpan(res.span);
    setErpLoading(false);

    setErpExportResult({ status: res.status, data: res.data });

    if (res.status === 200) {
      setThreatAlertActive(true);
    } else if (res.status === 401 && res.data.code === 'CAEP_SESSION_REVOKED') {
      setCaepMidFlightVerified(true);
    }
  };

  const handleApproveWireRelease = async () => {
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
          target_endpoint: 'payment_approve',
          action: 'APPROVE_WIRE_RELEASE',
          simulate_expired: isFastForwarded && !isRevoked
        }
      }
    );

    if (sessionIdRef.current !== currentSid) return;
    recordSpan(res.span);
    setErpLoading(false);

    setErpApproveResult({ status: res.status, data: res.data });

    if (res.status === 403 && res.data.error === 'ROLE_DENIED') {
      setTestedTraps((prev) => ({ ...prev, outOfScopeWire: true }));
    } else if (res.status === 401 && res.data.code === 'CAEP_SESSION_REVOKED') {
      setCaepMidFlightVerified(true);
    }
  };

  const handleSimulate15mExpiry = () => {
    setIsFastForwarded(true);
    setJitRemainingSec(0);
    setErpExportResult(null);
    setErpApproveResult(null);
    setTestedTraps((prev) => ({ ...prev, expirySimulation: true }));
  };

  const handleSubmitJitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionJwt || isRevoked) return;

    setJitSubmitLoading(true);
    setJitSubmitFeedback(null);

    const requestedRoles: WorkforceJourneyRole[] = includeAuditApproverTrap
      ? ['Viewer', 'Payment Creator', 'Audit Approver']
      : ['Viewer', 'Payment Creator'];

    const isPermanentTrap = durationOption === 'permanent';
    const currentSid = sessionId;

    const res = await submitWorkforceJitRequest({
      sessionId: currentSid,
      sessionJwt,
      justification,
      ttlSeconds: isPermanentTrap ? 86400 : 900,
      requestedRoles,
      permanent: isPermanentTrap,
      mode: labMode
    });

    if (sessionIdRef.current !== currentSid) return;
    recordSpan(res.span);
    setJitSubmitLoading(false);

    const data: WorkforceJourneyJitSubmitData = res.data;

    if (!res.ok || !data.request) {
      if (data.error === 'SOD_CONFLICT' || data.rule_id === 'SOD-FIN-001') {
        setTestedTraps((prev) => ({ ...prev, sodConflict: true }));
      }
      if (data.error === 'ZSP_MAX_TTL_EXCEEDED') {
        setTestedTraps((prev) => ({ ...prev, zspTtlExceeded: true }));
      }
      setJitSubmitFeedback({
        status: res.status,
        ok: false,
        title: `HTTP ${res.status} · ${data.error || 'REQUEST_REJECTED'}`,
        detail: data.message || 'JIT access request was rejected by policy.'
      });
      return;
    }

    setPendingRequest(data.request);
    setDeniedRequest(null);
    setMarcusFeedback(null);
    setJitSubmitFeedback({
      status: res.status,
      ok: true,
      title: `HTTP ${res.status} · #${data.request.request_id} Pending Manager Approval`,
      detail: `Automated SoD check (${data.rule_id || 'SOD-FIN-001'}: ${data.sod_status || 'PASS'}). Routed to Marcus Chen in AccessGuard Approval Inbox.`
    });
  };

  // ==================== Seat 2: Marcus Chen Actions ====================

  const handleMarcusDecision = async (decision: 'approve' | 'deny' | 'grant_permanent') => {
    if (!pendingRequest) return;

    setMarcusLoading(true);
    setMarcusFeedback(null);
    const currentSid = sessionId;

    const reason =
      decision === 'approve'
        ? 'Approved 15m JIT elevation for Q4 Ledger Close reconciliation'
        : decision === 'deny'
          ? 'Denied by Finance Manager during AccessGuard review'
          : 'Attempted permanent standing admin grant';

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

    if (decision === 'grant_permanent') {
      setTestedTraps((prev) => ({ ...prev, grantPermanentAdmin: true }));
      setMarcusFeedback({
        status: res.status,
        ok: false,
        title: `HTTP ${res.status} · ${data.error || 'ZSP_POLICY_VIOLATION'}`,
        detail:
          data.message ||
          'Zero Standing Privileges Violation: Granting permanent admin access is prohibited.'
      });
      return;
    }

    if (!res.ok) {
      setMarcusFeedback({
        status: res.status,
        ok: false,
        title: `HTTP ${res.status} · ${data.error || 'DECISION_REJECTED'}`,
        detail: data.message || 'Unable to process approval decision.'
      });
      return;
    }

    if (decision === 'deny') {
      setDeniedRequest(data.request || { ...pendingRequest, status: 'DENIED' });
      setPendingRequest(null);
      setMarcusFeedback({
        status: res.status,
        ok: true,
        title: `HTTP ${res.status} · Request #${pendingRequest.request_id} Denied`,
        detail: 'Request marked DENIED. Maya Lin remains on zero standing privileges (session:base).'
      });
      return;
    }

    // decision === 'approve'
    if (data.jit_jwt) {
      setJitJwt(data.jit_jwt);
      setJitClaims(data.decoded_claims || null);
      setJitRemainingSec(data.expires_in || 900);
      setIsFastForwarded(false);
    }
    if (data.scim_record) {
      setScimRecord(data.scim_record);
    }
    setApprovedRequest(data.request || { ...pendingRequest, status: 'APPROVED' });
    setPendingRequest(null);
    setErpExportResult(null);
    setErpApproveResult(null);
    setMayaView('erp');
    setPendingAutoLandToErp(true);
    setMarcusFeedback({
      status: res.status,
      ok: true,
      title: `HTTP ${res.status} · Approved 15m JIT (#${pendingRequest.request_id})`,
      detail:
        'Minted 900s HMAC-SHA256 jit_jwt (scope: admin:temp). Maya Lin is cleared for Q4 Ledger Close.'
    });
  };

  // ==================== Seat 3: Priya Nair Actions ====================

  const handleWaitForExpiryTrap = () => {
    setPriyaWaitedTrap(true);
    setTestedTraps((prev) => ({ ...prev, waitForExpiry: true }));
  };

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

    // Immediately clear Maya's stale success banners & auto-land her back on ERP
    setErpExportResult(null);
    setErpApproveResult(null);
    setJitRemainingSec(0);
    setMayaView('erp');
    setPendingAutoLandToErp(true);
  };

  // ==================== Seat Badges & Derived UI State ====================

  const mayaBadge: RoleSeatItem<SeatId>['badge'] = isRevoked
    ? { text: 'Session Revoked!', tone: 'crimson', pulse: true }
    : isJitExpired
      ? { text: 'JIT Expired', tone: 'amber' }
      : jitJwt
        ? { text: 'Approved · 15m', tone: 'emerald' }
        : pendingRequest?.status === 'PENDING'
          ? { text: 'Pending Approval', tone: 'amber' }
          : sessionJwt
            ? { text: 'Base SSO', tone: 'neutral' }
            : null;

  const marcusBadge: RoleSeatItem<SeatId>['badge'] =
    pendingRequest?.status === 'PENDING'
      ? { text: '● 1 Pending', tone: 'amber', pulse: true }
      : { text: '0 Pending', tone: 'neutral' };

  const priyaBadge: RoleSeatItem<SeatId>['badge'] = isRevoked
    ? { text: 'Contained', tone: 'emerald' }
    : threatAlertActive
      ? { text: '● 1 Critical Alert', tone: 'crimson', pulse: true }
      : { text: 'Monitoring', tone: 'neutral' };

  const seats: RoleSeatItem<SeatId>[] = [
    {
      id: 'maya-lin',
      name: 'Maya Lin',
      roleLabel: 'Finance Ops · Requester',
      appLabel: 'FinCore Treasury ERP',
      avatarInitials: 'ML',
      badge: mayaBadge
    },
    {
      id: 'marcus-chen',
      name: 'Marcus Chen',
      roleLabel: 'Finance Manager · Approver',
      appLabel: 'AccessGuard Approval Inbox',
      avatarInitials: 'MC',
      badge: marcusBadge
    },
    {
      id: 'priya-nair',
      name: 'Priya Nair',
      roleLabel: 'SecOps / IAM Admin',
      appLabel: 'Identity Threat Console',
      avatarInitials: 'PN',
      badge: priyaBadge
    }
  ];

  const mayaDisplayEmail = entraIdentity?.email || 'maya.lin@acme-corp.io';

  const erpSessionBadge = isRevoked
    ? {
        text: 'Session Revoked (CAEP)',
        bg: 'var(--accent-crimson-dim)',
        border: 'var(--accent-crimson-border)',
        color: 'var(--accent-crimson-ink)'
      }
    : isJitExpired
      ? {
          text: 'JIT Expired · 00:00',
          bg: 'var(--accent-amber-dim)',
          border: 'var(--accent-amber-border)',
          color: 'var(--accent-amber-ink)'
        }
      : isElevatedActive
        ? {
            text: `JIT Elevated (admin:temp) · ${formatCountdown(jitRemainingSec)}`,
            bg: 'var(--accent-emerald-dim)',
            border: 'var(--accent-emerald-border)',
            color: 'var(--accent-emerald-ink)'
          }
        : sessionJwt
          ? {
              text: 'Base SSO (session:base · No Standing Privilege)',
              bg: 'var(--accent-primary-dim)',
              border: 'var(--accent-primary-border)',
              color: 'var(--accent-primary-ink)'
            }
          : {
              text: provisioning ? 'Provisioning Base SSO…' : 'Base SSO Pending',
              bg: 'var(--bg-elevated)',
              border: 'var(--border-subtle)',
              color: 'var(--text-muted)'
            };

  const trapChecklist = [
    {
      key: 'sod',
      label: 'SoD Conflict (Audit Approver checkbox -> 403 SOD-FIN-001)',
      tested: testedTraps.sodConflict
    },
    {
      key: 'zspTtl',
      label: 'ZSP Max TTL Trap (24h / Permanent -> 400 ZSP_MAX_TTL_EXCEEDED)',
      tested: testedTraps.zspTtlExceeded
    },
    {
      key: 'permAdmin',
      label: 'Manager Grant Permanent Admin Trap (403 ZSP_POLICY_VIOLATION)',
      tested: testedTraps.grantPermanentAdmin
    },
    {
      key: 'rbac',
      label: 'Out-of-Scope Wire Approval (403 ROLE_DENIED)',
      tested: testedTraps.outOfScopeWire
    },
    {
      key: 'expiry',
      label: '15m Expiry Simulation (401 TOKEN_EXPIRED)',
      tested: testedTraps.expirySimulation
    },
    {
      key: 'waitTrap',
      label: 'SecOps Wait-for-15m-Expiry Blast-Radius Warning Trap',
      tested: testedTraps.waitForExpiry
    }
  ];

  const testedTrapCount = trapChecklist.filter((item) => item.tested).length;

  return (
    <div className="lab-shell">
      {/* Compact Capability-First Top Header */}
      <header className="lab-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onBackHome}
            aria-label="All Labs"
          >
            <ArrowLeft size={13} />
            <span>All Labs</span>
          </button>
          <span
            style={{
              fontSize: '14.5px',
              fontWeight: 700,
              letterSpacing: '-0.015em',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            Workforce Identity Lifecycle
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div
            role="group"
            aria-label="Execution Mode"
            style={{
              display: 'inline-flex',
              padding: '2px',
              borderRadius: '7px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <button
              type="button"
              aria-pressed={labMode === 'sandbox'}
              onClick={() => handleSwitchMode('sandbox')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                height: '28px',
                padding: '0 10px',
                borderRadius: '5px',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: labMode === 'sandbox' ? '#ffffff' : 'transparent',
                color: labMode === 'sandbox' ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: labMode === 'sandbox' ? 'var(--shadow-sm)' : 'none',
                fontFamily: 'inherit'
              }}
            >
              <Zap size={12} color="#059669" />
              <span>Sandbox</span>
            </button>
            <button
              type="button"
              aria-pressed={labMode === 'entra-external-id'}
              onClick={() => handleSwitchMode('entra-external-id')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                height: '28px',
                padding: '0 10px',
                borderRadius: '5px',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: labMode === 'entra-external-id' ? '#ffffff' : 'transparent',
                color: labMode === 'entra-external-id' ? '#1d4ed8' : 'var(--text-muted)',
                boxShadow: labMode === 'entra-external-id' ? 'var(--shadow-sm)' : 'none',
                fontFamily: 'inherit'
              }}
            >
              <Cloud size={12} color="#2563eb" />
              <span>Entra External ID</span>
            </button>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={handleResetLab}
            aria-label="Reset lab session"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>
      </header>

      {/* Main Natural-Flow Workspace */}
      <main className="lab-workspace">
        {/* 3-Seat Role Switcher Bar */}
        <RoleSwitcherBar
          seats={seats}
          activeSeatId={activeSeat}
          onSelectSeat={handleSelectSeat}
          ariaLabel="Workforce Identity 3-Seat Role Switcher"
        />

        {/* Entra External ID Mode Banner (when selected) */}
        {labMode === 'entra-external-id' && (
          <section
            aria-label="Entra External ID Authentication"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              marginBottom: '14px',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            {entraError && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--accent-crimson-dim)',
                  border: '1px solid var(--accent-crimson-border)',
                  color: 'var(--accent-crimson-ink)',
                  fontSize: '12px'
                }}
              >
                Entra OIDC Notice: <code>{entraError}</code>
              </div>
            )}

            {entraIdentity ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap',
                  fontSize: '12px',
                  color: 'var(--accent-emerald-ink)'
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  Verified · {entraIdentity.email} ({entraIdentity.oid.slice(0, 12)}…)
                </span>
                <span className="badge badge-emerald">Entra External ID Active</span>
              </div>
            ) : labConfig?.entra_external_id_configured ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}
              >
                <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  Authenticate with Microsoft Entra External ID Email OTP to bind a real CIAM identity to Seat 1.
                </span>
                <a
                  href="/api/workforce-journey/entra/login"
                  className="btn btn-dark btn-sm"
                >
                  <Mail size={14} />
                  <span>Sign in with Email OTP</span>
                </a>
              </div>
            ) : (
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--accent-primary-ink)',
                  backgroundColor: 'var(--accent-primary-dim)',
                  border: '1px solid var(--accent-primary-border)',
                  borderRadius: '6px',
                  padding: '9px 12px',
                  lineHeight: 1.5
                }}
              >
                <strong>Entra External ID not configured yet:</strong> Add{' '}
                <code>ENTRA_EXT_*</code> and <code>PRIVILEGED_GROUP_ID</code> secrets to Cloudflare Pages,
                or switch to <strong>Sandbox</strong> above to test now.
              </div>
            )}
          </section>
        )}

        {/* Base SSO Provisioning Error / Retry */}
        {provisionError && (
          <div
            role="alert"
            style={{
              marginBottom: '14px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--accent-crimson-dim)',
              border: '1px solid var(--accent-crimson-border)',
              color: 'var(--accent-crimson-ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
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
              <span>{provisioning ? 'Provisioning…' : 'Retry Base SSO'}</span>
            </button>
          </div>
        )}

        {/* ==================== SEAT 1: MAYA LIN ==================== */}
        {activeSeat === 'maya-lin' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Maya Workplace Lens Container */}
            <section
              aria-label="Maya Lin Workplace"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              {/* Workplace App Switcher Header */}
              <div
                style={{
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-canvas)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <div
                    role="tablist"
                    aria-label="Maya Lin Applications"
                    style={{
                      display: 'inline-flex',
                      padding: '2px',
                      borderRadius: '7px',
                      backgroundColor: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mayaView === 'erp'}
                      onClick={() => setMayaView('erp')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 11px',
                        borderRadius: '5px',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        backgroundColor: mayaView === 'erp' ? '#ffffff' : 'transparent',
                        color: mayaView === 'erp' ? 'var(--text-primary)' : 'var(--text-muted)',
                        boxShadow: mayaView === 'erp' ? 'var(--shadow-sm)' : 'none',
                        fontFamily: 'inherit'
                      }}
                    >
                      <FileSpreadsheet size={13} />
                      <span>FinCore Treasury ERP</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mayaView === 'access-hub'}
                      onClick={() => setMayaView('access-hub')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 11px',
                        borderRadius: '5px',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        backgroundColor: mayaView === 'access-hub' ? '#ffffff' : 'transparent',
                        color: mayaView === 'access-hub' ? 'var(--text-primary)' : 'var(--text-muted)',
                        boxShadow: mayaView === 'access-hub' ? 'var(--shadow-sm)' : 'none',
                        fontFamily: 'inherit'
                      }}
                    >
                      <KeyRound size={13} />
                      <span>Access Hub (Lumos)</span>
                    </button>
                  </div>

                  <span
                    style={{
                      fontSize: '11.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)'
                    }}
                  >
                    {mayaDisplayEmail}
                  </span>
                </div>

                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    border: `1px solid ${erpSessionBadge.border}`,
                    backgroundColor: erpSessionBadge.bg,
                    color: erpSessionBadge.color,
                    fontSize: '11.5px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Clock size={12} />
                  <span>{erpSessionBadge.text}</span>
                </span>
              </div>

              {/* VIEW 1A: FinCore Treasury ERP — Q4 Ledger Close */}
              {mayaView === 'erp' && (
                <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--text-muted)',
                          marginBottom: '2px'
                        }}
                      >
                        FinCore Treasury ERP · Q4 Ledger Close
                      </div>
                      <h1
                        style={{
                          fontSize: '18px',
                          fontWeight: 700,
                          letterSpacing: '-0.02em',
                          color: 'var(--text-primary)'
                        }}
                      >
                        Q4 Treasury Settlement &amp; Close
                      </h1>
                      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        Base SSO grants <strong>Viewer</strong> &amp; <strong>Payment Creator</strong> identity context with zero standing API privileges until a manager approves a 15-minute JIT grant.
                      </p>
                    </div>

                    {jitJwt && !isRevoked && !isFastForwarded && (
                      <button
                        type="button"
                        className="btn btn-amber-soft btn-sm"
                        onClick={handleSimulate15mExpiry}
                      >
                        <Clock size={13} />
                        <span>Simulate 15m Expiry</span>
                      </button>
                    )}
                  </div>

                  {/* Post-CAEP Revocation Callout (stale green 200 banner already cleared) */}
                  {isRevoked && !caepMidFlightVerified && (
                    <div
                      role="alert"
                      style={{
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--accent-crimson-dim)',
                        border: '1px solid var(--accent-crimson-border)',
                        color: 'var(--accent-crimson-ink)',
                        fontSize: '12.5px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                    >
                      <strong>CAEP Universal Logout Emitted — Stale Session Terminated</strong>
                      <span>
                        SecOps revoked your active tokens mid-session. Click{' '}
                        <strong>Export Q4 Treasury Ledger</strong> below to prove real{' '}
                        <code>HTTP 401 CAEP_SESSION_REVOKED</code> enforcement and unlock the Reflection Debrief.
                      </span>
                    </div>
                  )}

                  {/* Simulated Expiry Guidance Banner */}
                  {isFastForwarded && !isRevoked && (
                    <div
                      role="status"
                      style={{
                        padding: '11px 14px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--accent-amber-dim)',
                        border: '1px solid var(--accent-amber-border)',
                        color: 'var(--accent-amber-ink)',
                        fontSize: '12.5px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        flexWrap: 'wrap'
                      }}
                    >
                      <span>
                        <strong>15m JIT Window Fast-Forwarded (00:00):</strong> Click{' '}
                        <em>Export Q4 Treasury Ledger</em> to verify <code>HTTP 401 TOKEN_EXPIRED</code>, or switch to{' '}
                        <strong>Priya Nair</strong> to test CAEP Universal Logout.
                      </span>
                    </div>
                  )}

                  {/* FinCore Two-Action Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: '14px'
                    }}
                  >
                    {/* Action 1: In-Scope Export Q4 Treasury Ledger */}
                    <div
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px',
                        backgroundColor: 'var(--bg-canvas)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <span className="badge badge-blue">In-Scope · Payment Creator</span>
                          <code style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            POST /api/v1/payments/create
                          </code>
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          Export Q4 Treasury Ledger
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Exports $14.2M Q4 treasury settlement batch. Requires <code>scope: admin:temp</code> and{' '}
                          <code>Payment Creator</code> role.
                        </p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={erpLoading || !sessionJwt}
                          onClick={() => void handleExportQ4Ledger()}
                        >
                          <FileSpreadsheet size={14} />
                          <span>{erpLoading ? 'Calling FinCore API…' : 'Export Q4 Treasury Ledger'}</span>
                        </button>

                        {erpExportResult && (
                          <div
                            role="status"
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid',
                              borderColor:
                                erpExportResult.status === 200
                                  ? 'var(--accent-emerald-border)'
                                  : erpExportResult.status === 403
                                    ? 'var(--accent-amber-border)'
                                    : 'var(--accent-crimson-border)',
                              backgroundColor:
                                erpExportResult.status === 200
                                  ? 'var(--accent-emerald-dim)'
                                  : erpExportResult.status === 403
                                    ? 'var(--accent-amber-dim)'
                                    : 'var(--accent-crimson-dim)',
                              color:
                                erpExportResult.status === 200
                                  ? 'var(--accent-emerald-ink)'
                                  : erpExportResult.status === 403
                                    ? 'var(--accent-amber-ink)'
                                    : 'var(--accent-crimson-ink)',
                              fontSize: '12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px'
                            }}
                          >
                            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              HTTP {erpExportResult.status} ·{' '}
                              {erpExportResult.data.status ||
                                erpExportResult.data.code ||
                                erpExportResult.data.error}
                            </div>
                            <div>
                              {erpExportResult.status === 200
                                ? `Authorized: Q4 Treasury Ledger exported by ${erpExportResult.data.actor || mayaDisplayEmail} (${formatCountdown(jitRemainingSec)} remaining). Anomaly telemetry fired ALERT-9914 in Priya Nair's console.`
                                : erpExportResult.data.message ||
                                  'Standing privilege denied. Request a 15m JIT Token in Access Hub.'}
                            </div>

                            {erpExportResult.status === 403 &&
                              erpExportResult.data.error === 'INSUFFICIENT_SCOPE' && (
                                <button
                                  type="button"
                                  className="btn btn-dark btn-sm"
                                  onClick={() => setMayaView('access-hub')}
                                  style={{ alignSelf: 'flex-start' }}
                                >
                                  <span>Request 15m Access in Access Hub</span>
                                  <ArrowRight size={13} />
                                </button>
                              )}

                            {erpExportResult.status === 200 && threatAlertActive && !isRevoked && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => handleSelectSeat('priya-nair')}
                                style={{ alignSelf: 'flex-start' }}
                              >
                                <span>Inspect ALERT-9914 as Priya Nair</span>
                                <ArrowRight size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action 2: Out-of-Scope Approve Wire Release */}
                    <div
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px',
                        backgroundColor: 'var(--bg-canvas)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <span className="badge badge-amber">Out-of-Scope · Audit Approver</span>
                          <code style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            POST /api/v1/payments/approve
                          </code>
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          Approve Wire Release
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Releases external bank wires. Requires <code>Audit Approver</code> role—blocked even during an active 15m JIT session (Least Privilege).
                        </p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={erpLoading || !sessionJwt}
                          onClick={() => void handleApproveWireRelease()}
                        >
                          <Lock size={14} />
                          <span>{erpLoading ? 'Checking RBAC…' : 'Approve Wire Release'}</span>
                        </button>

                        {erpApproveResult && (
                          <div
                            role="status"
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--accent-crimson-border)',
                              backgroundColor: 'var(--accent-crimson-dim)',
                              color: 'var(--accent-crimson-ink)',
                              fontSize: '12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px'
                            }}
                          >
                            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              HTTP {erpApproveResult.status} ·{' '}
                              {erpApproveResult.data.code || erpApproveResult.data.error}
                            </div>
                            <div>
                              {erpApproveResult.data.message ||
                                'HTTP 403 Forbidden: Token lacks required role "Audit Approver".'}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* VIEW 1B: Access Hub (Lumos-style) — 2-Step JIT Submit + SoD & ZSP Traps */}
              {mayaView === 'access-hub' && (
                <form
                  onSubmit={(e) => void handleSubmitJitRequest(e)}
                  style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--text-muted)',
                          marginBottom: '2px'
                        }}
                      >
                        Access Hub · Just-In-Time Privilege Request
                      </div>
                      <h1
                        style={{
                          fontSize: '18px',
                          fontWeight: 700,
                          letterSpacing: '-0.02em',
                          color: 'var(--text-primary)'
                        }}
                      >
                        Request Temporary Access to FinCore Treasury ERP
                      </h1>
                      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        Requests are checked against <code>SOD-FIN-001</code> and Zero Standing Privileges (<code>&lt;= 900s</code>) before routing to Marcus Chen.
                      </p>
                    </div>

                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setMayaView('erp')}
                    >
                      <ArrowLeft size={13} />
                      <span>Back to Q4 Ledger Close</span>
                    </button>
                  </div>

                  {/* Requested Roles (with live SoD Trap) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Requested Roles
                    </span>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                        gap: '8px'
                      }}
                    >
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--accent-primary-border)',
                          backgroundColor: 'var(--accent-primary-dim)',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          color: 'var(--text-primary)'
                        }}
                      >
                        <input type="checkbox" checked readOnly />
                        <span>Viewer (Baseline)</span>
                      </label>

                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--accent-primary-border)',
                          backgroundColor: 'var(--accent-primary-dim)',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          color: 'var(--text-primary)'
                        }}
                      >
                        <input type="checkbox" checked readOnly />
                        <span>Payment Creator (Baseline)</span>
                      </label>

                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: includeAuditApproverTrap
                            ? '1.5px solid var(--accent-crimson)'
                            : '1px solid var(--border-strong)',
                          backgroundColor: includeAuditApproverTrap
                            ? 'var(--accent-crimson-dim)'
                            : 'var(--bg-canvas)',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          color: includeAuditApproverTrap
                            ? 'var(--accent-crimson-ink)'
                            : 'var(--text-primary)',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={includeAuditApproverTrap}
                            onChange={(e) => {
                              setIncludeAuditApproverTrap(e.target.checked);
                              setJitSubmitFeedback(null);
                            }}
                          />
                          <span>Audit Approver (Self-Approve Wires)</span>
                        </span>
                        <span className="badge badge-crimson">SoD Trap</span>
                      </label>
                    </div>

                    {includeAuditApproverTrap && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--accent-crimson-dim)',
                          border: '1px solid var(--accent-crimson-border)',
                          color: 'var(--accent-crimson-ink)',
                          fontSize: '12px'
                        }}
                      >
                        <strong>SOD-FIN-001 Preview:</strong> Combining <em>Payment Creator</em> and{' '}
                        <em>Audit Approver</em> violates Separation of Duties. Submitting will trigger a real server{' '}
                        <code>HTTP 403 SOD_CONFLICT</code> block.
                      </div>
                    )}
                  </div>

                  {/* Access Duration (with ZSP Permanent Admin / 24h Trap) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Access Duration (Zero Standing Privileges Policy)
                    </span>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '8px'
                      }}
                    >
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border:
                            durationOption === '15m'
                              ? '1.5px solid var(--accent-emerald)'
                              : '1px solid var(--border-strong)',
                          backgroundColor:
                            durationOption === '15m' ? 'var(--accent-emerald-dim)' : 'var(--bg-canvas)',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="radio"
                            name="jitDuration"
                            checked={durationOption === '15m'}
                            onChange={() => {
                              setDurationOption('15m');
                              setJitSubmitFeedback(null);
                            }}
                          />
                          <span>15 Minutes (900s · ZSP Max)</span>
                        </span>
                        <span className="badge badge-emerald">Compliant</span>
                      </label>

                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border:
                            durationOption === 'permanent'
                              ? '1.5px solid var(--accent-amber)'
                              : '1px solid var(--border-strong)',
                          backgroundColor:
                            durationOption === 'permanent' ? 'var(--accent-amber-dim)' : 'var(--bg-canvas)',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="radio"
                            name="jitDuration"
                            checked={durationOption === 'permanent'}
                            onChange={() => {
                              setDurationOption('permanent');
                              setJitSubmitFeedback(null);
                            }}
                          />
                          <span>Permanent Admin / 24 Hours (86400s)</span>
                        </span>
                        <span className="badge badge-amber">ZSP Trap</span>
                      </label>
                    </div>
                  </div>

                  {/* Justification */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label
                      htmlFor="jit-justification-input"
                      style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}
                    >
                      Business Justification &amp; Incident Ticket
                    </label>
                    <input
                      id="jit-justification-input"
                      type="text"
                      className="input-control"
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                    />
                  </div>

                  {/* Submit Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="submit"
                      className={
                        includeAuditApproverTrap || durationOption === 'permanent'
                          ? 'btn btn-danger-soft'
                          : 'btn btn-primary'
                      }
                      disabled={jitSubmitLoading || !sessionJwt || isRevoked}
                    >
                      <KeyRound size={14} />
                      <span>
                        {jitSubmitLoading ? 'Submitting Request…' : 'Submit JIT Access Request'}
                      </span>
                    </button>

                    {pendingRequest && (
                      <button
                        type="button"
                        className="btn btn-dark"
                        onClick={() => handleSelectSeat('marcus-chen')}
                      >
                        <span>Review as Marcus Chen (#{pendingRequest.request_id})</span>
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>

                  {jitSubmitFeedback && (
                    <div
                      role="status"
                      style={{
                        padding: '11px 14px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid',
                        borderColor: jitSubmitFeedback.ok
                          ? 'var(--accent-emerald-border)'
                          : 'var(--accent-crimson-border)',
                        backgroundColor: jitSubmitFeedback.ok
                          ? 'var(--accent-emerald-dim)'
                          : 'var(--accent-crimson-dim)',
                        color: jitSubmitFeedback.ok
                          ? 'var(--accent-emerald-ink)'
                          : 'var(--accent-crimson-ink)',
                        fontSize: '12.5px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                    >
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {jitSubmitFeedback.title}
                      </div>
                      <div>{jitSubmitFeedback.detail}</div>
                    </div>
                  )}
                </form>
              )}
            </section>

            {/* Phase 4: Reflection Debrief (Unlocked after mid-flight 401 CAEP_SESSION_REVOKED) */}
            {caepMidFlightVerified && (
              <section
                aria-label="Reflection Debrief"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1.5px solid var(--accent-emerald)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '18px 20px',
                  boxShadow: 'var(--shadow-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--accent-emerald)'
                      }}
                    >
                      Phase 4 · Reflection Debrief
                    </div>
                    <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Zero Standing Privileges &amp; Real-Time CAEP Containment Proven
                    </h2>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={handleResetLab}>
                    <RotateCcw size={12} />
                    <span>Restart Lab</span>
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '10px'
                  }}
                >
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '12px'
                    }}
                  >
                    <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                      1. Zero Standing Privileges
                    </strong>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Base SSO (<code>session:base</code>) hit real <code>HTTP 403 INSUFFICIENT_SCOPE</code> until manager approval minted a 15m <code>jit_jwt</code>.
                    </span>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '12px'
                    }}
                  >
                    <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                      2. Dual-Control &amp; SoD Guardrails
                    </strong>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      2-step queue (<code>jit-submit</code> → <code>jit-decision</code>) enforced <code>SOD-FIN-001</code> and capped TTL at <code>900s</code>.
                    </span>
                  </div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '12px'
                    }}
                  >
                    <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                      3. Mid-Flight CAEP Revocation
                    </strong>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      SecOps Universal Logout emitted an OpenID CAEP <code>session-revoked</code> SET, dropping active tokens to <code>HTTP 401 CAEP_SESSION_REVOKED</code>.
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-canvas)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Security Traps Explored ({testedTrapCount} / {trapChecklist.length})
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                      gap: '6px',
                      fontSize: '12px'
                    }}
                  >
                    {trapChecklist.map((trap) => (
                      <div
                        key={trap.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '7px',
                          color: trap.tested ? 'var(--accent-emerald-ink)' : 'var(--text-muted)'
                        }}
                      >
                        <CheckCircle2
                          size={14}
                          color={trap.tested ? '#059669' : '#cbd5e1'}
                          style={{ flexShrink: 0 }}
                        />
                        <span>{trap.label}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Open the sticky <strong>X-Ray Telemetry Drawer</strong> below to inspect every W3C{' '}
                    <code>traceparent</code> span and decoded JWT, SCIM 2.0, and CAEP proof payload.
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* ==================== SEAT 2: MARCUS CHEN ==================== */}
        {activeSeat === 'marcus-chen' && (
          <section
            aria-label="Marcus Chen AccessGuard Approval Inbox"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-sm)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-canvas)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserCheck size={16} color="#2563eb" />
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  AccessGuard Approval Inbox
                </span>
              </div>
              <span className={pendingRequest ? 'badge badge-amber' : 'badge'}>
                {pendingRequest ? '1 Pending Request' : '0 Pending'}
              </span>
            </div>

            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {pendingRequest ? (
                <div
                  style={{
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    backgroundColor: 'var(--bg-canvas)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <code
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: 'var(--accent-primary-ink)',
                            backgroundColor: 'var(--accent-primary-dim)',
                            padding: '2px 7px',
                            borderRadius: '4px'
                          }}
                        >
                          #{pendingRequest.request_id}
                        </code>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {pendingRequest.requester.name} · {pendingRequest.requester.department}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                        Requester: <code>{pendingRequest.requester.email}</code> · Target Scope:{' '}
                        <code>{pendingRequest.requested_scope}</code> · Requested Duration:{' '}
                        <strong>{Math.round(pendingRequest.ttl_seconds / 60)}m ({pendingRequest.ttl_seconds}s)</strong>
                      </div>
                    </div>

                    <span className="badge badge-emerald">
                      {pendingRequest.sod_check.rule_id}: {pendingRequest.sod_check.status}
                    </span>
                  </div>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '12.5px',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    <strong>Business Justification:</strong> “{pendingRequest.justification}”
                    <div style={{ marginTop: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Automated Policy Check: <code>SOD-FIN-001: PASS</code> — No conflicting{' '}
                      <code>Audit Approver</code> role requested.
                    </div>
                  </div>

                  {/* Manager Decision Buttons (including Grant Permanent Admin ZSP Trap) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-emerald"
                      disabled={marcusLoading}
                      onClick={() => void handleMarcusDecision('approve')}
                    >
                      <ShieldCheck size={14} />
                      <span>{marcusLoading ? 'Processing…' : 'Approve (15m JIT)'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn"
                      disabled={marcusLoading}
                      onClick={() => void handleMarcusDecision('deny')}
                    >
                      <XCircle size={14} />
                      <span>Deny Request</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-danger-soft"
                      disabled={marcusLoading}
                      onClick={() => void handleMarcusDecision('grant_permanent')}
                    >
                      <AlertTriangle size={14} />
                      <span>Grant Permanent Admin</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px dashed var(--border-strong)',
                    backgroundColor: 'var(--bg-canvas)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {approvedRequest
                      ? `Approved #${approvedRequest.request_id} · 15m JIT Token Active for Maya Lin`
                      : deniedRequest
                        ? `Denied #${deniedRequest.request_id} · Request Closed`
                        : 'Inbox Clear — Waiting for Maya Lin to submit a JIT request'}
                  </div>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    {approvedRequest
                      ? 'Switching back to Maya Lin will auto-land on FinCore Treasury ERP (Q4 Ledger Close) with her live 15:00 countdown.'
                      : deniedRequest
                        ? 'Maya Lin can submit a fresh 15m JIT request from Access Hub whenever ready.'
                        : 'Start as Maya Lin in FinCore Treasury ERP, hit the HTTP 403 wall, and submit a 15m request in Access Hub.'}
                  </p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        if (!approvedRequest) setMayaView('access-hub');
                        handleSelectSeat('maya-lin');
                      }}
                    >
                      <span>
                        {approvedRequest
                          ? 'Switch to Maya Lin (Q4 Ledger Close)'
                          : 'Switch to Maya Lin (Access Hub)'}
                      </span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              )}

              {marcusFeedback && (
                <div
                  role="status"
                  style={{
                    padding: '11px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid',
                    borderColor: marcusFeedback.ok
                      ? 'var(--accent-emerald-border)'
                      : 'var(--accent-crimson-border)',
                    backgroundColor: marcusFeedback.ok
                      ? 'var(--accent-emerald-dim)'
                      : 'var(--accent-crimson-dim)',
                    color: marcusFeedback.ok
                      ? 'var(--accent-emerald-ink)'
                      : 'var(--accent-crimson-ink)',
                    fontSize: '12.5px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {marcusFeedback.title}
                  </div>
                  <div>{marcusFeedback.detail}</div>
                  {marcusFeedback.ok && approvedRequest && (
                    <button
                      type="button"
                      className="btn btn-emerald btn-sm"
                      onClick={() => handleSelectSeat('maya-lin')}
                      style={{ alignSelf: 'flex-start', marginTop: '2px' }}
                    >
                      <span>Switch to Maya Lin (Q4 Ledger Close)</span>
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ==================== SEAT 3: PRIYA NAIR ==================== */}
        {activeSeat === 'priya-nair' && (
          <section
            aria-label="Priya Nair Identity Threat Console"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-sm)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-canvas)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={16} color={threatAlertActive && !isRevoked ? '#dc2626' : '#2563eb'} />
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Identity Threat Console (SecOps · OpenID CAEP)
                </span>
              </div>

              {jitJwt && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '3px 10px',
                    borderRadius: '999px',
                    backgroundColor: isRevoked
                      ? 'var(--accent-emerald-dim)'
                      : 'var(--accent-amber-dim)',
                    border: `1px solid ${
                      isRevoked ? 'var(--accent-emerald-border)' : 'var(--accent-amber-border)'
                    }`,
                    color: isRevoked ? 'var(--accent-emerald-ink)' : 'var(--accent-amber-ink)',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Clock size={12} />
                  <span>
                    {isRevoked
                      ? 'Maya Lin · CAEP Revoked (00:00)'
                      : isFastForwarded || jitRemainingSec <= 0
                        ? 'Maya Lin · JIT Window: 00:00 (Simulated Expiry)'
                        : `Maya Lin · Active JIT Window: ${formatCountdown(jitRemainingSec)} remaining`}
                  </span>
                </span>
              )}
            </div>

            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {isRevoked ? (
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--accent-emerald-dim)',
                    border: '1px solid var(--accent-emerald-border)',
                    color: 'var(--accent-emerald-ink)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' }}>
                    <CheckCircle2 size={16} />
                    <span>Threat Contained — CAEP Universal Logout Complete</span>
                  </div>
                  <p style={{ fontSize: '12.5px' }}>
                    Emitted OpenID CAEP <code>session-revoked</code> SET and invalidated{' '}
                    <code>{logoutResult?.revoked_jtis?.join(', ') || 'active JTIs'}</code> in directory &amp; edge KV.
                    Maya&apos;s stale ERP success state has been cleared immediately.
                  </p>
                  <div>
                    <button
                      type="button"
                      className="btn btn-emerald btn-sm"
                      onClick={() => handleSelectSeat('maya-lin')}
                    >
                      <span>Return to Maya Lin to verify mid-flight HTTP 401</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ) : threatAlertActive ? (
                <div
                  style={{
                    border: '1.5px solid var(--accent-crimson)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    backgroundColor: 'var(--accent-crimson-dim)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="badge badge-crimson">CRITICAL · ALERT-9914</span>
                        <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--accent-crimson-ink)' }}>
                          ALERT-9914 (Impossible Travel)
                        </span>
                      </div>
                      <p style={{ fontSize: '12.5px', color: 'var(--accent-crimson-ink)', marginTop: '6px' }}>
                        Session anomaly detected immediately after <strong>{mayaDisplayEmail}</strong> exported{' '}
                        <em>Q4 Treasury Ledger</em>: Singapore corporate VPN → Frankfurt TOR exit node within 4 minutes.
                      </p>
                    </div>

                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        backgroundColor: '#ffffff',
                        border: '1px solid var(--accent-crimson-border)',
                        color: 'var(--accent-crimson-ink)',
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: '12px',
                        fontWeight: 700,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Attacker window: {formatCountdown(jitRemainingSec)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-dark"
                      disabled={priyaLoading}
                      onClick={() => void handleCaepUniversalLogout()}
                    >
                      <LogOut size={14} />
                      <span>
                        {priyaLoading ? 'Revoking Sessions…' : 'Trigger CAEP Universal Logout'}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-amber-soft"
                      disabled={priyaLoading}
                      onClick={handleWaitForExpiryTrap}
                    >
                      <AlertOctagon size={14} />
                      <span>Wait for 15m Expiry</span>
                    </button>
                  </div>

                  {priyaWaitedTrap && (
                    <div
                      role="alert"
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: '#ffffff',
                        border: '1.5px solid var(--accent-amber)',
                        color: 'var(--accent-amber-ink)',
                        fontSize: '12.5px'
                      }}
                    >
                      <strong>Blast-Radius Warning:</strong> Waiting 15m leaves{' '}
                      <code style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatCountdown(jitRemainingSec)}
                      </code>{' '}
                      of active <code>admin:temp</code> privilege exposed. Automated exfiltration executes in
                      milliseconds—never rely on passive TTL expiry when an account is compromised.
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px dashed var(--border-strong)',
                    backgroundColor: 'var(--bg-canvas)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Telemetry Normal — Monitoring {mayaDisplayEmail}
                  </div>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    Once Maya Lin receives 15m JIT approval and executes <strong>Export Q4 Treasury Ledger</strong>{' '}
                    (<code>HTTP 200</code>), anomalous impossible-travel detection will raise{' '}
                    <code>ALERT-9914</code> here. You can also trigger CAEP Universal Logout early to test immediate token revocation.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSelectSeat('maya-lin')}
                    >
                      <span>Return to Maya Lin</span>
                      <ArrowRight size={13} />
                    </button>
                    {(sessionJwt || jitJwt) && (
                      <button
                        type="button"
                        className="btn btn-danger-soft btn-sm"
                        disabled={priyaLoading}
                        onClick={() => void handleCaepUniversalLogout()}
                      >
                        <LogOut size={13} />
                        <span>
                          {priyaLoading ? 'Revoking…' : 'Trigger CAEP Universal Logout'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* Sticky Bottom X-Ray Telemetry Drawer (Normal Document Flow) */}
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
