import { getLang } from './i18n.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.lmb = false;
    this.rmb = false;
    this.mmb = false;
    this.lmbJustPressed  = false;
    this.lmbJustReleased = false;
    this.rmbJustPressed  = false;
    this.mmbJustPressed  = false;
    // Ovládání: 'A' = WASD ve světě (výchozí), 'B2' = za kurzorem (steer.js). Q přepíná; hra pak dosadí this.steer.
    this.mode = 'A'; try { if (localStorage.getItem('fh_ctrl') === 'B2') this.mode = 'B2'; } catch {}
    this.steer = null;          // { dx, dy } od hry (jen v režimu B2)
    this.modeToggled = false;   // hrana pro hru
    this.online = false;        // NetGame online nastaví true → B2 se neuplatní (server kvantuje)

    window.addEventListener('keydown', e => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys[e.code] = true;
      if (e.code === 'KeyQ' && !e.repeat) { this.mode = this.mode === 'B2' ? 'A' : 'B2'; this.modeToggled = true; this.steer = null;
        try { localStorage.setItem('fh_ctrl', this.mode); } catch {}
        ctrlToast(this.mode, this.online); }
      // E = žádost o přihrávku (stejně jako MMB)
      if (e.code === 'KeyE' && !e.repeat) { this._mmbKey = true; this.mmb = true; this.mmbJustPressed = true; }
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'KeyE') { this._mmbKey = false; this.mmb = !!this._mmbBtn; }
    });

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });

    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { this.lmb = true; this.lmbJustPressed = true; }
      if (e.button === 1) { e.preventDefault(); this._mmbBtn = true; this.mmb = true; this.mmbJustPressed = true; }
      if (e.button === 2) { this.rmb = true; this.rmbJustPressed = true; }
    });

    // Use window so release outside canvas is caught (prevents stuck lmb/rmb)
    window.addEventListener('mouseup', e => {
      if (e.button === 0) { this.lmb = false; this.lmbJustReleased = true; }
      if (e.button === 1) { this._mmbBtn = false; this.mmb = !!this._mmbKey; }
      if (e.button === 2) { this.rmb = false; }
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Ztráta fokusu (alt-tab, klik mimo) → vynuluj vstupy, ať klávesa nezůstane
    // "stisknutá" a postava se netočí dokola (zaseknutý A/D u tank-steeringu).
    const clearAll = () => {
      this.keys = {};
      this.lmb = this.rmb = this.mmb = this._mmbBtn = this._mmbKey = false;
    };
    window.addEventListener('blur', clearAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll(); });
  }

  // Vynuluj vše (volá se např. při otevření Esc menu — ať nezůstane „zaseknutá" klávesa)
  clear() {
    this.keys = {};
    this.lmb = this.rmb = this.mmb = this._mmbBtn = this._mmbKey = false;
    this.lmbJustPressed = this.lmbJustReleased = this.rmbJustPressed = this.mmbJustPressed = false;
  }

  get shift() { return !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']); }

  get wasd() { const k = this.keys;
    return { w: !!(k.KeyW || k.ArrowUp), a: !!(k.KeyA || k.ArrowLeft), s: !!(k.KeyS || k.ArrowDown), d: !!(k.KeyD || k.ArrowRight) }; }

  get dx() {
    if (this.mode === 'B2' && this.steer) return this.steer.dx;
    return (this.keys['KeyD'] || this.keys['ArrowRight'] ? 1 : 0)
         - (this.keys['KeyA'] || this.keys['ArrowLeft']  ? 1 : 0);
  }

  get dy() {
    if (this.mode === 'B2' && this.steer) return this.steer.dy;
    return (this.keys['KeyS'] || this.keys['ArrowDown']  ? 1 : 0)
         - (this.keys['KeyW'] || this.keys['ArrowUp']    ? 1 : 0);
  }

  flush() {
    this.lmbJustPressed  = false;
    this.lmbJustReleased = false;
    this.rmbJustPressed  = false;
    this.mmbJustPressed  = false;
    this.modeToggled     = false;
  }
}

// Krátké oznámení po přepnutí ovládání (Q)
const CTRL_TXT = {
  cs: { B2: 'Ovládání: ZA KURZOREM · W ke kurzoru, při střele a pasu drží kurz · Q = WASD', A: 'Ovládání: WASD · Q = za kurzorem', on: ' (online zatím WASD)' },
  en: { B2: 'Controls: FOLLOW CURSOR · W to cursor, course holds while shooting or passing · Q = WASD', A: 'Controls: WASD · Q = follow cursor', on: ' (online stays WASD for now)' },
};
function ctrlToast(mode, online) {
  if (typeof document === 'undefined') return;
  const T = CTRL_TXT[getLang()] || CTRL_TXT.cs;
  let el = document.getElementById('fh-ctrl-toast');
  if (!el) { el = document.createElement('div'); el.id = 'fh-ctrl-toast';
    el.style.cssText = 'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:8px;'
      + 'background:rgba(10,20,35,.92);color:#fff;font:600 15px/1.35 system-ui,sans-serif;pointer-events:none;max-width:min(92vw,640px);text-align:center;'
      + 'border:2px solid #4cc3ff;transition:opacity .25s';
    document.body.appendChild(el); }
  el.textContent = T[mode] + (online && mode === 'B2' ? T.on : '');
  el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}
