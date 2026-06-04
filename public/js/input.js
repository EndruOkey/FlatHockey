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

    window.addEventListener('keydown', e => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });

    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { this.lmb = true; this.lmbJustPressed = true; }
      if (e.button === 1) { e.preventDefault(); this.mmb = true; this.mmbJustPressed = true; }
      if (e.button === 2) { this.rmb = true; this.rmbJustPressed = true; }
    });

    // Use window so release outside canvas is caught (prevents stuck lmb/rmb)
    window.addEventListener('mouseup', e => {
      if (e.button === 0) { this.lmb = false; this.lmbJustReleased = true; }
      if (e.button === 2) { this.rmb = false; }
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Ztráta fokusu (alt-tab, klik mimo) → vynuluj vstupy, ať klávesa nezůstane
    // "stisknutá" a postava se netočí dokola (zaseknutý A/D u tank-steeringu).
    const clearAll = () => {
      this.keys = {};
      this.lmb = this.rmb = this.mmb = false;
    };
    window.addEventListener('blur', clearAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll(); });
  }

  get shift() { return !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']); }

  get dx() {
    return (this.keys['KeyD'] || this.keys['ArrowRight'] ? 1 : 0)
         - (this.keys['KeyA'] || this.keys['ArrowLeft']  ? 1 : 0);
  }

  get dy() {
    return (this.keys['KeyS'] || this.keys['ArrowDown']  ? 1 : 0)
         - (this.keys['KeyW'] || this.keys['ArrowUp']    ? 1 : 0);
  }

  flush() {
    this.lmbJustPressed  = false;
    this.lmbJustReleased = false;
    this.rmbJustPressed  = false;
    this.mmbJustPressed  = false;
  }
}
