// Most k CrazyGames SDK. SDK funguje jen na doménách CG, hra běží v iframe z flathockey.fun,
// proto SDK načítá obal (release/crazygames/index.html) a s hrou mluví přes postMessage.
// Tady je strana hry: zprávy bere jen od vlastního rodiče s ověřeným originem, token CG nikam neukládá.
import { getDeviceToken, setDeviceToken, authFetch } from './auth.js';

const PARENT_RE = /^(https:\/\/([a-z0-9-]+\.)*crazygames\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const FLAG = 'fh_cg_acct';   // zařízení má token CG účtu (po odhlášení z CG se vrátíme k hostu)

export const isCrazyGames = (() => {
  try { return new URLSearchParams(location.search).get('ref') === 'crazygames' && window.parent !== window; }
  catch { return false; }
})();

let parentOrigin = null, playing = false, busy = () => false, onSwap = async () => {}, pending = undefined;
const post = (type, extra) => {
  if (!isCrazyGames) return;
  try { window.parent.postMessage({ type, ...extra }, type === 'cg:hello' ? '*' : parentOrigin || '*'); } catch {}
};
// parentOrigin je pro ne-hello zprávy null jen před první odpovědí rodiče; tou dobou se nic nevolá

export function gameplay(on) {
  if (!isCrazyGames || playing === on) return;
  playing = on;
  post(on ? 'cg:gameplayStart' : 'cg:gameplayStop');
  if (!on && pending !== undefined) apply();   // odložená výměna účtu až v menu
}
export const happytime = () => post('cg:happytime');

async function apply() {
  const msg = pending;
  if (msg === undefined || busy()) return;
  pending = undefined;
  const flag = (() => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } })();
  if (!msg.token) {                       // odhlášen v CG
    if (flag) { setDeviceToken(null); try { localStorage.removeItem(FLAG); } catch {} await onSwap(); }
    return;
  }
  try {
    const res = await authFetch('/auth/crazygames', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: msg.token }),
    });
    if (res.ok) {
      const j = await res.json();
      if (j?.token) { setDeviceToken(j.token); try { localStorage.setItem(FLAG, '1'); } catch {} await onSwap(); }
    } else if (res.status === 401 && !apply.retried) { apply.retried = true; post('cg:requestToken'); }
  } catch {}
}

/** opts.busy() = true během zápasu (výměnu účtu odložíme); opts.onSwap() = přepojit socket + znovu načíst session. */
export function initCgBridge(opts = {}) {
  if (!isCrazyGames) return;
  document.documentElement.classList.add('cg');
  busy = opts.busy || busy; onSwap = opts.onSwap || onSwap;
  window.addEventListener('message', (ev) => {
    if (ev.source !== window.parent || !PARENT_RE.test(ev.origin)) return;
    const d = ev.data;
    if (!d || d.type !== 'cg:user') return;
    parentOrigin = ev.origin;
    pending = { token: typeof d.token === 'string' ? d.token : null };
    apply();
  });
  post('cg:hello');
}
