const DEFAULT_ALLOWED_FORWARDED_HOSTS = new Set<string>(['lab.0trust.dev']);

const STRICT_HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/;
const LOCALHOST_PORT_PATTERN = /^(localhost|127\.0\.0\.1):\d{1,5}$/;

function isNonProduction(): boolean {
  return (
    typeof process === 'undefined' ||
    (process.env?.ENVIRONMENT !== 'production' && !process.env?.K_SERVICE)
  );
}

function firstHeaderValue(raw: string | null): string {
  if (!raw) return '';
  return raw.split(',')[0].trim().toLowerCase();
}

function getAllowedHosts(extraAllowedHosts?: Iterable<string>): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_FORWARDED_HOSTS);
  const envHosts =
    typeof process !== 'undefined' && process.env?.ALLOWED_FORWARDED_HOSTS
      ? process.env.ALLOWED_FORWARDED_HOSTS.split(',')
      : [];
  for (const host of envHosts) {
    const normalized = host.trim().toLowerCase();
    if (normalized && STRICT_HOST_PATTERN.test(normalized)) {
      allowed.add(normalized);
    }
  }
  if (extraAllowedHosts) {
    for (const host of extraAllowedHosts) {
      const normalized = host.trim().toLowerCase();
      if (normalized && STRICT_HOST_PATTERN.test(normalized)) {
        allowed.add(normalized);
      }
    }
  }
  return allowed;
}

export function isAllowedForwardedHost(
  host: string,
  extraAllowedHosts?: Iterable<string>
): boolean {
  if (!host || !STRICT_HOST_PATTERN.test(host)) {
    return false;
  }
  if (LOCALHOST_PORT_PATTERN.test(host)) {
    return isNonProduction();
  }
  return getAllowedHosts(extraAllowedHosts).has(host);
}

/**
 * Reconstruct the public origin from allowlisted X-Forwarded-Host / X-Forwarded-Proto headers.
 * Prevents Host Header Injection and Open Redirects by rejecting non-allowlisted hosts
 * and falling back to `new URL(request.url).origin`.
 */
export function resolvePublicOrigin(
  request: Request,
  extraAllowedHosts?: Iterable<string>
): string {
  const fallbackOrigin = new URL(request.url).origin;
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));

  if (!forwardedHost || !isAllowedForwardedHost(forwardedHost, extraAllowedHosts)) {
    return fallbackOrigin;
  }

  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const proto =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : LOCALHOST_PORT_PATTERN.test(forwardedHost)
        ? 'http'
        : 'https';

  return `${proto}://${forwardedHost}`;
}
