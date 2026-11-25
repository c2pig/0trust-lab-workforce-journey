import React from 'react';
import { WorkforceJourneyJitRequestRecord } from '../../types';
import { EndpointCallSnapshot, formatCountdown } from '../../hooks/useWorkforceLab';

export interface FinCoreErpSeatProps {
  isRevoked: boolean;
  isElevatedActive: boolean;
  jitRemainingSec: number;
  erpLoading: boolean;
  provisioning: boolean;
  sessionJwt: string;
  erpExportResult: EndpointCallSnapshot | null;
  pendingRequest: WorkforceJourneyJitRequestRecord | null;
  show403Modal: boolean;
  setShow403Modal: (open: boolean) => void;
  showJitModal: boolean;
  setShowJitModal: (open: boolean) => void;
  justification: string;
  setJustification: (value: string) => void;
  jitSubmitLoading: boolean;
  onExportQ4Ledger: () => Promise<void>;
  onSubmitJitRequest: (e: React.FormEvent) => Promise<void>;
}

export const FinCoreErpSeat: React.FC<FinCoreErpSeatProps> = ({
  isRevoked,
  isElevatedActive,
  jitRemainingSec,
  erpLoading,
  provisioning,
  sessionJwt,
  erpExportResult,
  pendingRequest,
  show403Modal,
  setShow403Modal,
  showJitModal,
  setShowJitModal,
  justification,
  setJustification,
  jitSubmitLoading,
  onExportQ4Ledger,
  onSubmitJitRequest
}) => {
  return (
    <>
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
            onClick={() => void onExportQ4Ledger()}
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
            <form onSubmit={(e) => void onSubmitJitRequest(e)} className="modal-body" style={{ gap: '12px' }}>
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
    </>
  );
};
