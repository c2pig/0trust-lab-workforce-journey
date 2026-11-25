import React from 'react';
import { MonitorEventRow } from '../../hooks/useWorkforceLab';

export interface IdentityThreatMonitorSeatProps {
  userEmail: string;
  threatAlertActive: boolean;
  isRevoked: boolean;
  priyaLoading: boolean;
  monitorRows: MonitorEventRow[];
  onCaepUniversalLogout: () => Promise<void>;
}

export const IdentityThreatMonitorSeat: React.FC<IdentityThreatMonitorSeatProps> = ({
  userEmail,
  threatAlertActive,
  isRevoked,
  priyaLoading,
  monitorRows,
  onCaepUniversalLogout
}) => {
  return (
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
            onClick={() => void onCaepUniversalLogout()}
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
                        onClick={() => void onCaepUniversalLogout()}
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
  );
};
