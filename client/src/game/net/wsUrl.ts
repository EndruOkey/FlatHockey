import type { RuntimeEnvironment } from '@flathockey/shared';
import { ENV } from '../../config/env';

type LocationLike = Pick<Location, 'protocol' | 'hostname' | 'host' | 'port' | 'pathname'>;

type RuntimeHints = {
  pathname: string;
  baseUri: string | null;
  assetSrcs: string[];
};

function requireDevWsUrl() {
  if (ENV.WS_DEV) return ENV.WS_DEV;
  throw new Error('VITE_WS_DEV is not configured');
}

function toWsProtocol(protocol: string) {
  return protocol === 'https:' ? 'wss:' : 'ws:';
}

function isPrivateIpv4Host(hostname: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
  if (!match) return false;

  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isProbablyLocalHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true;
  if (normalized.endsWith('.local')) return true;
  if (isPrivateIpv4Host(normalized)) return true;
  if (!normalized.includes('.') && !normalized.includes('flathockey')) return true;
  return false;
}

function buildWsUrl(location: LocationLike, portOverride?: string, pathOverride?: string) {
  const base = new URL(`${location.protocol}//${location.host}`);
  base.protocol = toWsProtocol(location.protocol);
  if (portOverride !== undefined) {
    base.port = portOverride;
  }
  base.pathname = pathOverride ?? resolveSocketPath(location.pathname);
  base.search = '';
  base.hash = '';
  return base.toString();
}

function isCanonicalDevPath(pathname: string) {
  return pathname === '/dev' || pathname.startsWith('/dev/');
}

function collectRuntimeHints(location: LocationLike): RuntimeHints {
  const pathname = location.pathname ?? '';
  if (typeof document === 'undefined') {
    return { pathname, baseUri: null, assetSrcs: [] };
  }

  const assetSrcs = Array.from(document.querySelectorAll('script[src]'))
    .map((node) => node.getAttribute('src') ?? '')
    .filter(Boolean);

  return {
    pathname,
    baseUri: typeof document.baseURI === 'string' ? document.baseURI : null,
    assetSrcs
  };
}

function isCanonicalDevRuntime(location: LocationLike) {
  const hints = collectRuntimeHints(location);
  if (isCanonicalDevPath(hints.pathname)) return true;
  if (hints.baseUri && hints.baseUri.includes('/dev/')) return true;
  return hints.assetSrcs.some((src) => src.includes('/dev/assets/'));
}

function resolveSocketPath(pathname: string) {
  return isCanonicalDevPath(pathname) ? '/dev/ws2' : '/ws2';
}

export function resolveWsUrl(location: LocationLike = window.location): string {
  const host = location.hostname;
  const canonicalDevRuntime = isCanonicalDevRuntime(location);
  console.info('[NET_BOOTSTRAP] URL_HINTS', {
    ts: new Date().toISOString(),
    hostname: location.hostname,
    pathname: location.pathname,
    port: location.port,
    canonicalDevRuntime,
    devBuild: ENV.DEV_BUILD
  });

  if (location.port === '8080') {
    return buildWsUrl(location, undefined, '/ws2');
  }

  if (location.port === '5173' && isProbablyLocalHost(host)) {
    return buildWsUrl(location, '8080', '/ws2');
  }

  if (isProbablyLocalHost(host)) {
    return buildWsUrl(location, '8080', '/ws2');
  }

  if (canonicalDevRuntime) {
    return buildWsUrl(location, undefined, '/dev/ws2');
  }

  if (ENV.DEV_BUILD || host.includes('flathockey-dev')) {
    return requireDevWsUrl();
  }

  return ENV.WS_PROD;
}

export function resolveExpectedRuntime(wsUrl: string, location: LocationLike = window.location): RuntimeEnvironment {
  try {
    const parsed = new URL(wsUrl);
    const host = parsed.hostname;
    const port = parsed.port;

    if (port === '8080' && isProbablyLocalHost(host)) {
      return 'local';
    }
    if (isProbablyLocalHost(host)) {
      return 'local';
    }
    if (port === '7778' || host.includes('flathockey-dev') || parsed.pathname.includes('/dev/')) {
      return 'dev';
    }
  } catch {
    // Fall through to location/env heuristics.
  }

  if (isCanonicalDevRuntime(location) || ENV.DEV_BUILD || location.hostname.includes('flathockey-dev')) {
    return 'dev';
  }

  return 'prod';
}
