import React from 'react';
import { ArrowLeft, Compass, Mail, RefreshCw, RotateCcw } from 'lucide-react';
import { RoleSwitcherBar } from '../components/RoleSwitcherBar';
import { XRayTelemetryDrawer } from '../components/XRayTelemetryDrawer';
import { FinCoreErpSeat } from '../components/workforce/FinCoreErpSeat';
import { AccessGuardPamSeat } from '../components/workforce/AccessGuardPamSeat';
import { IdentityThreatMonitorSeat } from '../components/workforce/IdentityThreatMonitorSeat';
import { formatCountdown, useWorkforceLab } from '../hooks/useWorkforceLab';

export interface WorkforceLabPageProps {
  onBackHome: () => void;
}

export const WorkforceLabPage: React.FC<WorkforceLabPageProps> = ({ onBackHome }) => {
  const lab = useWorkforceLab();

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
              {lab.globalStatusLabel}
            </span>
          </div>

          {/* Right: Timer + Mode + Dropdown Role Switcher + Lab Tour + Reset */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {lab.isElevatedActive && (
              <span className="badge badge-amber mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                JIT {formatCountdown(lab.jitRemainingSec)}
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
                onClick={() => lab.handleSwitchMode('sandbox')}
                style={{
                  padding: '5px 8px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: lab.labMode === 'sandbox' ? 'var(--text-primary)' : 'var(--bg-surface)',
                  color: lab.labMode === 'sandbox' ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                Sandbox
              </button>
              <button
                type="button"
                onClick={() => lab.handleSwitchMode('entra-external-id')}
                style={{
                  padding: '5px 8px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  border: 'none',
                  borderLeft: '1px solid var(--border-strong)',
                  cursor: 'pointer',
                  backgroundColor:
                    lab.labMode === 'entra-external-id' ? 'var(--text-primary)' : 'var(--bg-surface)',
                  color: lab.labMode === 'entra-external-id' ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                Entra ID
              </button>
            </div>

            <RoleSwitcherBar
              seats={lab.seats}
              activeSeatId={lab.activeSeat}
              onSelectSeat={lab.setActiveSeat}
              variant="dropdown"
              ariaLabel="Switch workspace persona"
            />

            <div id="tour-lab-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={lab.startLabTour}
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
              <button type="button" onClick={lab.handleResetLab} className="btn btn-sm">
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
          {lab.labMode === 'entra-external-id' && (
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
              {lab.entraError && (
                <span style={{ color: 'var(--accent-crimson-ink)' }}>
                  Entra OIDC Notice: <code>{lab.entraError}</code>
                </span>
              )}
              {lab.entraIdentity ? (
                <>
                  <span className="mono" style={{ color: 'var(--accent-emerald-ink)', fontWeight: 600 }}>
                    Verified · {lab.entraIdentity.email} ({lab.entraIdentity.oid.slice(0, 12)}…)
                  </span>
                  <span className="badge badge-emerald">Entra External ID Active</span>
                </>
              ) : lab.labConfig?.entra_external_id_configured ? (
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
          {lab.provisionError && (
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
              <span>{lab.provisionError}</span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={lab.provisioning}
                onClick={() => void lab.provisionMayaBaseSession(lab.sessionId, lab.labMode, lab.entraTicket)}
              >
                <RefreshCw size={12} />
                <span>{lab.provisioning ? 'Provisioning…' : 'Retry'}</span>
              </button>
            </div>
          )}

          {/* Seat 1: FinCore Treasury ERP */}
          {lab.activeSeat === 'maya-lin' && (
            <FinCoreErpSeat
              isRevoked={lab.isRevoked}
              isElevatedActive={lab.isElevatedActive}
              jitRemainingSec={lab.jitRemainingSec}
              erpLoading={lab.erpLoading}
              provisioning={lab.provisioning}
              sessionJwt={lab.sessionJwt}
              erpExportResult={lab.erpExportResult}
              pendingRequest={lab.pendingRequest}
              show403Modal={lab.show403Modal}
              setShow403Modal={lab.setShow403Modal}
              showJitModal={lab.showJitModal}
              setShowJitModal={lab.setShowJitModal}
              justification={lab.justification}
              setJustification={lab.setJustification}
              jitSubmitLoading={lab.jitSubmitLoading}
              onExportQ4Ledger={lab.handleExportQ4Ledger}
              onSubmitJitRequest={lab.handleSubmitJitRequest}
            />
          )}

          {/* Seat 2: AccessGuard PAM */}
          {lab.activeSeat === 'marcus-chen' && (
            <AccessGuardPamSeat
              pendingRequest={lab.pendingRequest}
              approvedRequest={lab.approvedRequest}
              isElevatedActive={lab.isElevatedActive}
              jitRemainingSec={lab.jitRemainingSec}
              marcusLoading={lab.marcusLoading}
              onMarcusDecision={lab.handleMarcusDecision}
            />
          )}

          {/* Seat 3: JIT & Session Activity Monitor */}
          {lab.activeSeat === 'priya-nair' && (
            <IdentityThreatMonitorSeat
              userEmail={lab.userEmail}
              threatAlertActive={lab.threatAlertActive}
              isRevoked={lab.isRevoked}
              priyaLoading={lab.priyaLoading}
              monitorRows={lab.monitorRows}
              onCaepUniversalLogout={lab.handleCaepUniversalLogout}
            />
          )}
        </div>
      </main>

      {/* 3. Original Sticky-Bottom X-Ray Telemetry Drawer */}
      <XRayTelemetryDrawer
        spans={lab.spans}
        sessionJwt={lab.sessionJwt}
        sessionClaims={lab.sessionClaims}
        jitJwt={lab.jitJwt}
        jitClaims={lab.jitClaims}
        scimRecord={lab.scimRecord}
        caepEvent={lab.logoutResult?.caep_event || null}
        onClear={lab.clearSpans}
      />
    </div>
  );
};
