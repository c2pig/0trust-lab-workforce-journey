import React from 'react';
import { WorkforceJourneyJitRequestRecord } from '../../types';
import { formatCountdown } from '../../hooks/useWorkforceLab';

export interface AccessGuardPamSeatProps {
  pendingRequest: WorkforceJourneyJitRequestRecord | null;
  approvedRequest: WorkforceJourneyJitRequestRecord | null;
  isElevatedActive: boolean;
  jitRemainingSec: number;
  marcusLoading: boolean;
  onMarcusDecision: (decision: 'approve' | 'deny') => Promise<void>;
}

export const AccessGuardPamSeat: React.FC<AccessGuardPamSeatProps> = ({
  pendingRequest,
  approvedRequest,
  isElevatedActive,
  jitRemainingSec,
  marcusLoading,
  onMarcusDecision
}) => {
  return (
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
                            onClick={() => void onMarcusDecision('deny')}
                          >
                            Deny
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={marcusLoading}
                            onClick={() => void onMarcusDecision('approve')}
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
  );
};
