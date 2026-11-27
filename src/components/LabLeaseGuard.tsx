import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Lock, LogOut, ShieldCheck } from 'lucide-react';

export const DEFAULT_TURNSTILE_SITE_KEY = '0x4AAAAAAGVF1oWC5CsFWn-J';
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: 'light' | 'dark' | 'auto';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface LeaseStatusPayload {
  enabled: boolean;
  state: 'available' | 'active' | 'occupied';
  isOwner?: boolean;
  expiresAt?: number | null;
  retryAfterSec?: number;
  durationSec?: number;
  remainingCalls?: number;
  dailyRemaining?: number;
  turnstileSiteKey?: string;
  message?: string;
  error?: string;
}

interface CountdownAnchor {
  remainingSec: number;
  capturedAtPerf: number;
}

export interface LabLeaseGuardProps {
  labSlug: string;
  labTitle: string;
  siteKey?: string;
  children: React.ReactNode;
}

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function loadTurnstileScript(): Promise<TurnstileApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`
    );
    if (existing) {
      const check = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(check);
          resolve(window.turnstile);
        }
      }, 100);
      window.setTimeout(() => {
        window.clearInterval(check);
        resolve(window.turnstile ?? null);
      }, 6000);
      return;
    }

    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

export function LabLeaseGuard({
  labSlug,
  labTitle,
  siteKey = DEFAULT_TURNSTILE_SITE_KEY,
  children
}: LabLeaseGuardProps): React.ReactElement {
  const [status, setStatus] = useState<LeaseStatusPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [countdownAnchor, setCountdownAnchor] = useState<CountdownAnchor | null>(null);
  const [nowPerf, setNowPerf] = useState<number>(() =>
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  );
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const fetchingRef = useRef<boolean>(false);
  const expiredRef = useRef<boolean>(false);

  const captureCountdown = useCallback((remainingSec: number) => {
    const perfNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setCountdownAnchor({ remainingSec: Math.max(0, remainingSec), capturedAtPerf: perfNow });
    setNowPerf(perfNow);
    expiredRef.current = false;
  }, []);

  const fetchStatus = useCallback(async () => {
    if (
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
      setFetchError(null);
      setStatus({ enabled: false, state: 'available' });
      return;
    }

    if (fetchingRef.current) {
      return;
    }
    fetchingRef.current = true;

    try {
      const res = await fetch(`/api/lease/${encodeURIComponent(labSlug)}/status`, {
        method: 'GET',
        credentials: 'same-origin'
      });
      const ct = res.headers.get('Content-Type') || '';
      if (!ct.includes('application/json')) {
        setFetchError('Unable to verify lab bench availability (unexpected server response).');
        return;
      }
      const data = (await res.json()) as LeaseStatusPayload;
      if (!res.ok) {
        setFetchError(
          data.message || data.error || `Unable to verify lab bench availability (HTTP ${res.status}).`
        );
        return;
      }
      setFetchError(null);
      setStatus(data);
      const serverRemaining =
        typeof data.retryAfterSec === 'number' && Number.isFinite(data.retryAfterSec)
          ? data.retryAfterSec
          : 0;
      captureCountdown(serverRemaining);
    } catch {
      setFetchError('Network error while checking lab bench availability. Please retry.');
    } finally {
      fetchingRef.current = false;
    }
  }, [labSlug, captureCountdown]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Tick countdown every second while active or occupied
  useEffect(() => {
    if (!status?.enabled || (status.state !== 'active' && status.state !== 'occupied')) {
      return;
    }
    const timer = window.setInterval(() => {
      setNowPerf(typeof performance !== 'undefined' ? performance.now() : Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status?.enabled, status?.state]);

  // Poll status every 5 seconds while occupied so bench unlocks automatically
  useEffect(() => {
    if (!status?.enabled || status.state !== 'occupied') return;
    const poll = window.setInterval(() => {
      void fetchStatus();
    }, 5000);
    return () => window.clearInterval(poll);
  }, [status?.enabled, status?.state, fetchStatus]);

  const remainingSec = countdownAnchor
    ? Math.max(0, Math.ceil(countdownAnchor.remainingSec - (nowPerf - countdownAnchor.capturedAtPerf) / 1000))
    : 0;

  // Auto-refresh status at most once per lease epoch when a positive countdown reaches 0
  useEffect(() => {
    if (!status?.enabled || !countdownAnchor || countdownAnchor.remainingSec <= 0) return;
    if (remainingSec <= 0 && !expiredRef.current) {
      expiredRef.current = true;
      void fetchStatus();
    }
  }, [status?.enabled, countdownAnchor, remainingSec, fetchStatus]);

  // Mount official Cloudflare Turnstile explicit widget when gate is available
  useEffect(() => {
    if (!status?.enabled || status.state !== 'available') return;
    let cancelled = false;

    const resolvedSiteKey = status.turnstileSiteKey || siteKey;
    void loadTurnstileScript().then((api) => {
      if (cancelled || !api || !widgetContainerRef.current) return;
      if (widgetIdRef.current) {
        api.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      widgetIdRef.current = api.render(widgetContainerRef.current, {
        sitekey: resolvedSiteKey,
        action: `lease_${labSlug.replace(/-/g, '_')}`,
        theme: 'light',
        callback: (token: string) => {
          setTurnstileToken(token);
          setErrorMsg(null);
        },
        'expired-callback': () => {
          setTurnstileToken(null);
        },
        'error-callback': () => {
          setTurnstileToken(null);
          setErrorMsg('Turnstile verification encountered an error. Please retry.');
        }
      });
    });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [status?.enabled, status?.state, status?.turnstileSiteKey, siteKey, labSlug]);

  const handleAcquire = async () => {
    if (!turnstileToken) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/lease/${encodeURIComponent(labSlug)}/acquire`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken })
      });
      const ct = res.headers.get('Content-Type') || '';
      if (!ct.includes('application/json')) {
        setErrorMsg('Unable to start lab session (unexpected server response). Please retry.');
        setTurnstileToken(null);
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
        await fetchStatus();
        return;
      }
      const data = (await res.json()) as LeaseStatusPayload;
      if (res.ok && data.state === 'active') {
        const serverRemaining =
          typeof data.durationSec === 'number' && Number.isFinite(data.durationSec)
            ? data.durationSec
            : typeof data.retryAfterSec === 'number' && Number.isFinite(data.retryAfterSec)
              ? data.retryAfterSec
              : 0;
        captureCountdown(serverRemaining);
        setStatus({ ...data, enabled: true, state: 'active', isOwner: true });
      } else {
        setErrorMsg(data.message || 'Unable to start lab session. Please try again.');
        setTurnstileToken(null);
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
        await fetchStatus();
      }
    } catch {
      setErrorMsg('Network error starting lab session. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRelease = async () => {
    setSubmitting(true);
    try {
      await fetch(`/api/lease/${encodeURIComponent(labSlug)}/release`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      setTurnstileToken(null);
      await fetchStatus();
    } finally {
      setSubmitting(false);
    }
  };

  // Fail closed on non-localhost status fetch errors (never mount children)
  if (fetchError) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          backgroundColor: 'var(--bg-canvas)',
          color: 'var(--text-primary)'
        }}
      >
        <div
          role="alert"
          style={{
            width: '100%',
            maxWidth: '460px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--accent-crimson-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-md)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                backgroundColor: 'var(--accent-crimson-dim)',
                color: 'var(--accent-crimson-ink)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Lock size={18} />
            </span>
            <div>
              <h1 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{labTitle}</h1>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Lab Bench Availability Check Failed
              </div>
            </div>
          </div>
          <p style={{ fontSize: '13.5px', color: 'var(--accent-crimson-ink)', margin: 0 }}>
            {fetchError}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setFetchError(null);
              setStatus(null);
              void fetchStatus();
            }}
            style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontSize: '14px' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Loading gate while status === null (do not mount children)
  if (!status) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          backgroundColor: 'var(--bg-canvas)',
          color: 'var(--text-primary)'
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '460px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-md)',
            padding: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          <span
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor: 'var(--accent-primary-dim)',
              color: 'var(--accent-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ShieldCheck size={18} />
          </span>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{labTitle}</h1>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Checking lab bench availability…
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Passthrough only when lease gating is explicitly disabled
  if (!status.enabled) {
    return <>{children}</>;
  }

  if (status.state === 'active') {
    return (
      <>
        <div
          style={{
            position: 'fixed',
            bottom: '56px',
            right: '16px',
            zIndex: 55,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 12px',
            borderRadius: '999px',
            backgroundColor: '#0f172a',
            color: '#ffffff',
            boxShadow: 'var(--shadow-lg)',
            fontSize: '13px',
            fontWeight: 600
          }}
        >
          <Clock size={14} style={{ color: remainingSec <= 30 ? '#f87171' : '#38bdf8' }} />
          <span className="mono">Session {formatCountdown(remainingSec)}</span>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleRelease()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 9px',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.22)',
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <LogOut size={12} />
            <span>End Lab</span>
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor:
                status.state === 'occupied'
                  ? 'var(--accent-amber-dim)'
                  : 'var(--accent-primary-dim)',
              color:
                status.state === 'occupied'
                  ? 'var(--accent-amber-ink)'
                  : 'var(--accent-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {status.state === 'occupied' ? <Lock size={18} /> : <ShieldCheck size={18} />}
          </span>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{labTitle}</h1>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Dedicated 3-Minute Live Security Bench
            </div>
          </div>
        </div>

        {status.state === 'occupied' ? (
          <div
            style={{
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--accent-amber-dim)',
              border: '1px solid var(--accent-amber-border)',
              color: 'var(--accent-amber-ink)',
              fontSize: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <strong>Lab bench is currently in use</strong>
            <span>
              Next session opens automatically in{' '}
              <strong className="mono">{formatCountdown(remainingSec)}</strong>.
            </span>
          </div>
        ) : (
          <>
            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: 0 }}>
              Complete the Cloudflare Turnstile check to claim exclusive access to this lab for 3 minutes.
            </p>

            <div ref={widgetContainerRef} />

            {errorMsg && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--accent-crimson-dim)',
                  border: '1px solid var(--accent-crimson-border)',
                  color: 'var(--accent-crimson-ink)',
                  fontSize: '13px'
                }}
              >
                {errorMsg}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              disabled={!turnstileToken || submitting}
              onClick={() => void handleAcquire()}
              style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontSize: '14px' }}
            >
              {submitting ? 'Starting Lab Session…' : 'Start 3-Minute Lab Session'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
