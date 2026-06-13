// Auth state — null = guest, object = přihlášený uživatel
let _user = null;
const _listeners = new Set();

export function getUser() { return _user; }
export function isGuest() { return _user === null; }
export function isSponsor() { return _user?.is_sponsor === true; }

export function onAuthChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  for (const fn of _listeners) fn(_user);
}

// Načte session ze serveru (při startu stránky)
export async function loadSession() {
  try {
    const res = await fetch('/auth/me', { credentials: 'same-origin' });
    if (res.ok) {
      _user = await res.json();
    } else {
      _user = null;
    }
  } catch {
    _user = null;
  }
  notify();
}

export function loginWithDiscord() {
  window.location.href = '/auth/discord';
}

// Vrátí { ok: true } nebo { error: string }
export async function requestMagicLink(email) {
  const res = await fetch('/auth/email/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    credentials: 'same-origin',
  });
  return res.json();
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  _user = null;
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
