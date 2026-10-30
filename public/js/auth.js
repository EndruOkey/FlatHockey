// Auth state — null = guest, object = přihlášený uživatel
let _user = null;
let _kind = null;          // 'account' (Discord) | 'guest' (účet zařízení) | null
const TOKEN_KEY = 'fh_device_token';
const _listeners = new Set();

export function getUser() { return _user; }
export function isGuest() { return _user === null; }
export function getKind() { return _kind; }

// Token zařízení (hostující účet): funguje i v iframe třetích stran, kde cookies nejdou
export function getDeviceToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setDeviceToken(tok) { try { tok ? localStorage.setItem(TOKEN_KEY, tok) : localStorage.removeItem(TOKEN_KEY); } catch {} }
export function authFetch(url, opts = {}) {
  const tok = getDeviceToken();
  const headers = { ...(opts.headers || {}) };
  if (tok) headers.Authorization = 'Bearer ' + tok;
  return fetch(url, { credentials: 'same-origin', ...opts, headers });
}
export function isSponsor() { return _user?.is_sponsor === true; }

export function onAuthChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  for (const fn of _listeners) fn(_user);
}

// Načte session ze serveru (při startu stránky)
// 401 = určitě nepřihlášen; 5xx/síťová chyba = zachovej předchozí stav
export async function loadSession() {
  try {
    const res = await authFetch('/auth/me');
    if (res.ok) {
      const u = await res.json();
      _kind = u.kind || 'account';
      _user = _kind === 'account' ? u : null;   // host zůstává „nepřihlášený“ pro UI (jen se mu ukládají statistiky)
    } else if (res.status === 401) {
      _user = null; _kind = null;
    }
    // 5xx — stav nezměníme, server je dočasně nedostupný
  } catch {
    // Síťová chyba — stav nezměníme
  }
  notify();
}

export async function loadServerStats() {
  if (!_user) return null;
  try {
    const res = await authFetch('/auth/stats');
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

export async function loadRankAndCredits() {
  if (!_user) return null;
  try {
    const [rankRes, credRes] = await Promise.all([
      authFetch('/api/me/rank'),
      authFetch('/api/me/credits'),
    ]);
    const rank    = rankRes.ok    ? await rankRes.json()    : null;
    const credits = credRes.ok    ? await credRes.json()    : null;
    return {
      rank_points:  rank?.rank_points  ?? 1000,
      position:     rank?.position     ?? null,
      puck_credits: credits?.puck_credits ?? 0,
    };
  } catch {}
  return null;
}

export async function saveServerProfile(data) {
  if (!_user && !getDeviceToken()) return;
  try {
    await authFetch('/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {}
}

export function loginWithDiscord() {
  const tok = getDeviceToken();   // server z něj ověří hosta a po přihlášení slije jeho statistiky do Discord účtu
  window.location.href = '/auth/discord' + (tok ? '?dt=' + encodeURIComponent(tok) : '');
}

export async function logout() {
  await authFetch('/auth/logout', { method: 'POST' });
  setDeviceToken(null);     // token po slučení ukazuje na Discord účet → po odhlášení ho zahoď (nový host)
  _user = null; _kind = null;
  notify();
}

// Detekuje ?auth_ok=1 nebo ?auth_error=... po OAuth redirect
export function handleOAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('auth_ok')) {
    history.replaceState(null, '', window.location.pathname);
    return 'ok';
  }
  if (params.has('auth_error')) {
    const err = params.get('auth_error');
    history.replaceState(null, '', window.location.pathname);
    return { error: err };
  }
  return null;
}

// ── Propojení účtů (link kód) ────────────────────────────────────────────────
export async function requestLinkCode() {
  try {
    const res = await authFetch('/api/link/code', { method: 'POST' });
    return res.ok ? await res.json() : { error: res.status === 429 ? 'rate_limited' : 'failed' };
  } catch { return { error: 'failed' }; }
}
export async function redeemLinkCode(code) {
  try {
    const res = await authFetch('/api/link/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { error: j.error || 'failed' };
  } catch { return { error: 'failed' }; }
}
