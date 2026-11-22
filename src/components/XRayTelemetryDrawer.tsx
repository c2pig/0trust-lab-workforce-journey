import React, { useId, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  EyeOff,
  FileCode2,
  ListTree,
  Radio,
  Trash2
} from 'lucide-react';
import {
  ObservabilitySpan,
  WorkforceJourneyDecodedJwt,
  WorkforceJourneyScimRecord
} from '../types';

export interface XRayDecodedProofSection {
  id: string;
  label: string;
  payload: unknown;
}

export interface XRayTelemetryDrawerProps {
  spans: ObservabilitySpan[];
  sessionJwt?: string;
  sessionClaims?: WorkforceJourneyDecodedJwt | null;
  jitJwt?: string;
  jitClaims?: WorkforceJourneyDecodedJwt | null;
  scimRecord?: WorkforceJourneyScimRecord | null;
  caepEvent?: Record<string, unknown> | null;
  decodedProofSections?: XRayDecodedProofSection[];
  onClear?: () => void;
  defaultExpanded?: boolean;
}

type XRayTabId = 'audit' | 'proof';

function getStatusPillStyle(status: number): React.CSSProperties {
  if (status >= 200 && status < 300) {
    return {
      backgroundColor: '#ecfdf5',
      color: '#065f46',
      border: '1px solid #a7f3d0'
    };
  }
  if (status === 401 || status === 403) {
    return {
      backgroundColor: '#fef2f2',
      color: '#991b1b',
      border: '1px solid #fecaca'
    };
  }
  return {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    border: '1px solid #fde68a'
  };
}

function redactJwtSignature(token?: string): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return '***REDACTED***';
  return `${parts[0]}.${parts[1]}.***REDACTED***`;
}

function formatSpanPayload(span: ObservabilitySpan) {
  return {
    traceparent: span.traceparent,
    session_id: span.session_id,
    http: `${span.method} ${span.path} -> ${span.status}`,
    latency_ms: span.latency_ms,
    timestamp: span.timestamp,
    authorization_header: span.redacted_auth_header || '(none)',
    redaction_applied: span.redaction_applied,
    execution_origin: span.execution_origin,
    otlp_export: span.otlp_export,
    response_summary: span.response_summary
  };
}

export const XRayTelemetryDrawer: React.FC<XRayTelemetryDrawerProps> = ({
  spans,
  sessionJwt,
  sessionClaims,
  jitJwt,
  jitClaims,
  scimRecord,
  caepEvent,
  decodedProofSections,
  onClear,
  defaultExpanded = false
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const [activeTab, setActiveTab] = useState<XRayTabId>('audit');
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const baseId = useId();
  const auditTabId = `${baseId}-audit-tab`;
  const proofTabId = `${baseId}-proof-tab`;
  const auditPanelId = `${baseId}-audit-panel`;
  const proofPanelId = `${baseId}-proof-panel`;

  const auditTabRef = useRef<HTMLButtonElement>(null);
  const proofTabRef = useRef<HTMLButtonElement>(null);

  const sortedSpans = useMemo(() => {
    return [...spans].sort((a, b) => {
      if (a.timestamp === b.timestamp) return 0;
      return b.timestamp.localeCompare(a.timestamp);
    });
  }, [spans]);

  const latestSpan = sortedSpans[0] ?? null;
  const activeSpan =
    sortedSpans.find((span) => span.id === selectedSpanId) ?? latestSpan;

  const redactedSessionPreview = useMemo(() => redactJwtSignature(sessionJwt), [sessionJwt]);
  const redactedJitPreview = useMemo(() => redactJwtSignature(jitJwt), [jitJwt]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: XRayTabId) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next: XRayTabId = current === 'audit' ? 'proof' : 'audit';
      setActiveTab(next);
      if (next === 'audit') {
        auditTabRef.current?.focus();
      } else {
        proofTabRef.current?.focus();
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveTab('audit');
      auditTabRef.current?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveTab('proof');
      proofTabRef.current?.focus();
    }
  };

  const proofItemsCount =
    (sessionClaims ? 1 : 0) +
    (jitClaims ? 1 : 0) +
    (scimRecord ? 1 : 0) +
    (caepEvent ? 1 : 0);

  return (
    <section className="xray-drawer" aria-label="X-Ray Telemetry Drawer">
      {/* Collapsed / Sticky 1-Line Ticker Header */}
      <div
        className="xray-drawer-header"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <div className="xray-drawer-header-left">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#78350f',
              color: '#fef3c7',
              padding: '3px 9px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            <Activity size={13} />
            <span>X-RAY TELEMETRY</span>
          </span>

          <span
            style={{
              fontSize: '11.5px',
              backgroundColor: '#1e293b',
              padding: '2px 8px',
              borderRadius: '4px',
              color: '#cbd5e1',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            {sortedSpans.length} {sortedSpans.length === 1 ? 'span' : 'spans'}
          </span>

          {latestSpan && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                minWidth: 0,
                flexWrap: 'wrap'
              }}
            >
              <span
                className="xray-status-pill"
                style={getStatusPillStyle(latestSpan.status)}
              >
                HTTP {latestSpan.status}
              </span>
              <code
                style={{
                  color: '#38bdf8',
                  fontSize: '11.5px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '280px'
                }}
              >
                {latestSpan.method} {latestSpan.path}
              </code>
              <span
                style={{
                  color: '#a7f3d0',
                  fontSize: '11.5px',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap'
                }}
              >
                {latestSpan.latency_ms}ms
              </span>
              {latestSpan.redaction_applied && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: '#fcd34d',
                    fontSize: '11px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <EyeOff size={12} />
                  <span>JWT Sig Redacted</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div
          className="xray-drawer-header-right"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className="xray-drawer-secondary-hint"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              color: '#94a3b8',
              whiteSpace: 'nowrap'
            }}
            title="Async OTLP/HTTP export via Cloudflare waitUntil() (0ms user delay)"
          >
            <Radio size={12} color="#10b981" />
            <span>
              OTLP waitUntil:{' '}
              <strong style={{ color: '#e2e8f0' }}>
                {latestSpan?.otlp_export === 'configured' ? 'Grafana / New Relic' : 'In-Lab Sync'}
              </strong>
            </span>
          </span>

          {onClear && sortedSpans.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: '5px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit'
              }}
            >
              <Trash2 size={12} />
              <span>Clear</span>
            </button>
          )}

          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((prev) => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              backgroundColor: '#f59e0b',
              color: '#0f172a',
              border: 'none',
              borderRadius: '5px',
              padding: '4px 10px',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit'
            }}
          >
            <span>{isExpanded ? 'Hide X-Ray' : 'Open X-Ray'}</span>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {/* Bounded Expanded Panel */}
      {isExpanded && (
        <div className="xray-drawer-body">
          {/* Accessible Tab Strip */}
          <div
            role="tablist"
            aria-label="X-Ray Telemetry Views"
            className="xray-tablist"
          >
            <button
              ref={auditTabRef}
              id={auditTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === 'audit'}
              tabIndex={activeTab === 'audit' ? 0 : -1}
              className="xray-tab-btn"
              onClick={() => setActiveTab('audit')}
              onKeyDown={(e) => handleTabKeyDown(e, 'audit')}
            >
              <ListTree size={14} />
              <span>Security Audit Feed</span>
              <span
                style={{
                  backgroundColor: '#0f172a',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '999px',
                  padding: '0 6px',
                  fontSize: '10.5px',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                {sortedSpans.length}
              </span>
            </button>

            <button
              ref={proofTabRef}
              id={proofTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === 'proof'}
              tabIndex={activeTab === 'proof' ? 0 : -1}
              className="xray-tab-btn"
              onClick={() => setActiveTab('proof')}
              onKeyDown={(e) => handleTabKeyDown(e, 'proof')}
            >
              <FileCode2 size={14} />
              <span>Live Decoded Proof</span>
              <span
                style={{
                  backgroundColor: '#0f172a',
                  color: '#93c5fd',
                  border: '1px solid #334155',
                  borderRadius: '999px',
                  padding: '0 6px',
                  fontSize: '10.5px',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                {proofItemsCount > 0 ? `${proofItemsCount} active` : 'JWT · SCIM · CAEP'}
              </span>
            </button>
          </div>

          {/* Tab 1: Security Audit Feed */}
          <div
            id={auditPanelId}
            role="tabpanel"
            aria-labelledby={auditTabId}
            hidden={activeTab !== 'audit'}
          >
            {sortedSpans.length === 0 ? (
              <div
                style={{
                  backgroundColor: '#1e293b',
                  border: '1px dashed #334155',
                  borderRadius: '8px',
                  padding: '16px',
                  fontSize: '12.5px',
                  color: '#94a3b8'
                }}
              >
                No API spans captured yet. Trigger an action in the workspace to inspect live W3C{' '}
                <code>traceparent</code> propagation, edge latency, and automatic JWT signature redaction.
              </div>
            ) : (
              <div className="xray-audit-layout">
                <div className="xray-audit-list">
                  {sortedSpans.map((span) => {
                    const isSelected = activeSpan?.id === span.id;
                    const barWidthPct = Math.min(100, Math.max(8, span.latency_ms * 2));
                    const originLabel =
                      span.execution_origin === 'cloudflare-edge'
                        ? 'Edge Worker'
                        : 'Browser WebCrypto';

                    return (
                      <button
                        key={span.id}
                        type="button"
                        aria-current={isSelected ? 'true' : undefined}
                        className={`xray-audit-row${isSelected ? ' selected' : ''}`}
                        onClick={() => setSelectedSpanId(span.id)}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            minWidth: 0
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              minWidth: 0
                            }}
                          >
                            <span
                              className="xray-status-pill"
                              style={getStatusPillStyle(span.status)}
                            >
                              HTTP {span.status}
                            </span>
                            <code
                              style={{
                                fontSize: '11.5px',
                                color: '#38bdf8',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {span.method} {span.path}
                            </code>
                          </div>
                          <span
                            style={{
                              fontSize: '11px',
                              color: '#a7f3d0',
                              fontFamily: 'var(--font-mono)',
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}
                          >
                            {span.latency_ms}ms
                          </span>
                        </div>

                        <div
                          style={{
                            height: '4px',
                            backgroundColor: '#1e293b',
                            borderRadius: '999px',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              width: `${barWidthPct}%`,
                              height: '100%',
                              backgroundColor: span.status >= 400 ? '#f87171' : '#10b981'
                            }}
                          />
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            flexWrap: 'wrap',
                            fontSize: '10.5px',
                            color: '#94a3b8',
                            fontFamily: 'var(--font-mono)'
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '100%'
                            }}
                            title={span.traceparent}
                          >
                            traceparent: {span.traceparent}
                          </span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '8px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <span>{originLabel}</span>
                            {span.redaction_applied && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  color: '#fcd34d'
                                }}
                              >
                                <EyeOff size={11} />
                                <span>JWT Sig Redacted</span>
                              </span>
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Selected Audit Row Inspector */}
                <div className="xray-proof-card">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#94a3b8',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}
                    >
                      Selected Audit Row
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('proof')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: '#fbbf24',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit'
                      }}
                    >
                      <span>Inspect in Live Decoded Proof</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>

                  {activeSpan ? (
                    <pre className="xray-proof-pre">
                      {JSON.stringify(formatSpanPayload(activeSpan), null, 2)}
                    </pre>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Select an audit row to inspect its redacted telemetry payload.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Tab 2: Live Decoded Proof */}
          <div
            id={proofPanelId}
            role="tabpanel"
            aria-labelledby={proofTabId}
            hidden={activeTab !== 'proof'}
          >
            <div className="xray-proof-grid">
              {/* 1. Decoded session_jwt */}
              <div className="xray-proof-card">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px'
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#93c5fd',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    Decoded session_jwt (Header &amp; Claims)
                  </span>
                  {redactedSessionPreview && (
                    <span style={{ fontSize: '10px', color: '#fcd34d', whiteSpace: 'nowrap' }}>
                      Sig Redacted
                    </span>
                  )}
                </div>
                {redactedSessionPreview && (
                  <code
                    style={{
                      fontSize: '10.5px',
                      color: '#94a3b8',
                      wordBreak: 'break-all',
                      backgroundColor: '#020617',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      border: '1px solid #1e293b'
                    }}
                  >
                    {redactedSessionPreview}
                  </code>
                )}
                <pre className="xray-proof-pre" style={{ color: '#93c5fd' }}>
                  {JSON.stringify(
                    sessionClaims
                      ? { header: sessionClaims.header, payload: sessionClaims.payload }
                      : { info: 'No base session JWT yet' },
                    null,
                    2
                  )}
                </pre>
              </div>

              {/* 2. Decoded jit_jwt */}
              <div className="xray-proof-card">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px'
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#6ee7b7',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    Decoded jit_jwt (Header &amp; Claims)
                  </span>
                  {redactedJitPreview && (
                    <span style={{ fontSize: '10px', color: '#fcd34d', whiteSpace: 'nowrap' }}>
                      Sig Redacted
                    </span>
                  )}
                </div>
                {redactedJitPreview && (
                  <code
                    style={{
                      fontSize: '10.5px',
                      color: '#94a3b8',
                      wordBreak: 'break-all',
                      backgroundColor: '#020617',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      border: '1px solid #1e293b'
                    }}
                  >
                    {redactedJitPreview}
                  </code>
                )}
                <pre className="xray-proof-pre" style={{ color: '#6ee7b7' }}>
                  {JSON.stringify(
                    jitClaims
                      ? { header: jitClaims.header, payload: jitClaims.payload }
                      : { info: 'No active 15m JIT token yet' },
                    null,
                    2
                  )}
                </pre>
              </div>

              {/* 3. SCIM 2.0 Directory Record */}
              <div className="xray-proof-card">
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#cbd5e1',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  SCIM 2.0 Directory Record
                </span>
                <pre className="xray-proof-pre">
                  {JSON.stringify(
                    scimRecord || { status: 'IDLE', info: 'No SCIM directory record yet' },
                    null,
                    2
                  )}
                </pre>
              </div>

              {/* 4. OpenID CAEP session-revoked SET */}
              <div className="xray-proof-card">
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#fca5a5',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  OpenID CAEP session-revoked SET
                </span>
                <pre className="xray-proof-pre" style={{ color: '#fca5a5' }}>
                  {JSON.stringify(
                    caepEvent || { info: 'No CAEP revocation event emitted yet' },
                    null,
                    2
                  )}
                </pre>
              </div>

              {/* 5. Selected Audit Row Payload */}
              <div className="xray-proof-card">
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#fcd34d',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  Selected Audit Row Payload
                </span>
                <pre className="xray-proof-pre">
                  {JSON.stringify(
                    activeSpan
                      ? formatSpanPayload(activeSpan)
                      : { info: 'No audit span selected yet' },
                    null,
                    2
                  )}
                </pre>
              </div>

              {/* 6. Optional Extensible Proof Sections for Other Labs */}
              {decodedProofSections?.map((section) => (
                <div key={section.id} className="xray-proof-card">
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#cbd5e1',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    {section.label}
                  </span>
                  <pre className="xray-proof-pre">
                    {JSON.stringify(section.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
