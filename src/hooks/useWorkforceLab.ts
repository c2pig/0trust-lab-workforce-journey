import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { RoleSeatItem } from '../components/RoleSwitcherBar';

export type SeatId = 'maya-lin' | 'marcus-chen' | 'priya-nair';

export interface EndpointCallSnapshot {
  status: number;
  data: WorkforceJourneyProtectedData;
}

export interface MonitorEventRow {
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

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function nowTimeStr(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

export function useWorkforceLab() {
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

  // Seat 1: Maya Lin Actions
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

  // Seat 2: Marcus Chen Actions
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

  // Seat 3: Priya Nair Actions
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

  // Derived Badges & Status
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
      avatarColor: '#2563eb',
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
      avatarColor: '#7c3aed',
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
      avatarColor: '#059669',
      badge:
        threatAlertActive && !isRevoked
          ? { text: 'Alert', tone: 'crimson', pulse: true }
          : null
    }
  ];

  const userEmail = scimRecord?.userName || 'maya.lin@acme-corp.io';

  return {
    sessionId,
    labMode,
    labConfig,
    entraTicket,
    entraIdentity,
    entraError,
    activeSeat,
    setActiveSeat,
    provisioning,
    provisionError,
    sessionJwt,
    sessionClaims,
    jitJwt,
    jitClaims,
    jitRemainingSec,
    scimRecord,
    erpLoading,
    erpExportResult,
    show403Modal,
    setShow403Modal,
    showJitModal,
    setShowJitModal,
    justification,
    setJustification,
    jitSubmitLoading,
    pendingRequest,
    approvedRequest,
    marcusLoading,
    threatAlertActive,
    priyaLoading,
    logoutResult,
    monitorRows,
    spans,
    clearSpans: () => setSpans([]),
    isRevoked,
    isElevatedActive,
    globalStatusLabel,
    seats,
    userEmail,
    startLabTour,
    provisionMayaBaseSession,
    handleResetLab,
    handleSwitchMode,
    handleExportQ4Ledger,
    handleSubmitJitRequest,
    handleMarcusDecision,
    handleCaepUniversalLogout
  };
}
