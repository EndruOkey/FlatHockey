import { RINK, PLAYER, PUCK } from './constants.js';
import { lerpAngle, clamp } from './utils.js';
import { t } from './i18n.js';
import { Input } from './input.js';
import { Engine, fromScreen, toScreen } from './engine.js';
import { World } from './world.js';
import { Player } from './entities/Player.js';
import { Puck } from './entities/Puck.js';
import { Goalie } from './entities/Goalie.js';
import { Passer } from './entities/Passer.js';
import { Rink } from './entities/Rink.js';
import { SFX } from './sound.js';

const CHARGE_RATE = 1.4; // pomalejší nápřah → slap shot je cítit (jen sandbox; online řídí server)

// Myš míří jen hokejku/střelu (turret). Rychlost natáčení škáluje s VZDÁLENOSTÍ kurzoru.
function _updateAim(player, rawAim, dt) {
  const d = player.aimDist ?? 100;
  const rate = clamp(d / 35, 0.12, 1) * 28;
  player.aimAngle = lerpAngle(player.aimAngle, rawAim, Math.min(1, rate * dt));
}

// Predikce nahrávky do jízdy — míří na HOKEJKU (čepel) příjemce, ne na tělo.
function _leadAim(from, target, speed) {
  const tx = target.x, ty = target.y;
  const dist = Math.hypot(tx - from.x, ty - from.y) || 1;
  // 2 iterace pro přesnější lead (konverguje při lineárním pohybu)
  let t = dist / speed;
  let px = tx + (target.vx || 0) * t;
  let py = ty + (target.vy || 0) * t;
  t  = Math.hypot(px - from.x, py - from.y) / speed;
  px = tx + (target.vx || 0) * t;
  py = ty + (target.vy || 0) * t;
  return Math.atan2(py - from.y, px - from.x);
}

// ════════════════════════════════════════════════════════════════════════
// NetGame — TENKÝ KLIENT k server-authoritative simulaci.
// Posílá jen vstupy, dostává snapshoty, vykresluje s interpolací. Žádná
// lokální fyzika → konec host/guest desyncu.
// ════════════════════════════════════════════════════════════════════════
export class NetGame {
  constructor(canvas, net, myId, settings) {
    this.canvas  = canvas;
    this.net     = net;
    this.myId    = myId;
    this.settings = settings || { teams: { home: { name: t('team_home_default'), color: '#3a9fff' }, away: { name: t('team_away_default'), color: '#ff4455' } } };
    this.clk = 0; this.per = 1; this.pers = 1; this.ended = false;
    this.input   = new Input(canvas);
    this.engine  = new Engine(canvas);

    // Difficulty: 'competitive' v ranked/tournaments, 'casual' v public lobbies
    this.difficulty = this.settings.difficulty || 'casual';

    this.rink    = new Rink();
    this.players = new Map();              // id -> { ent, isMe, tx,ty,tba,taa,tca,tsd, sx,sy }
    this.localEnt = null;                  // můj hráč (client-side prediction)
    this.puck    = new Puck(); this.puck._tx = this.puck.x; this.puck._ty = this.puck.y;
    this.goalieL = new Goalie('left', this.difficulty);
    this.goalieR = new Goalie('right', this.difficulty);
    this.score   = { home: 0, away: 0 };
    this.goalFlash = 0; this.goalText = '';

    this.call = null;   // odpískané pravidlo (offside/icing) — banner + zvýraznění čáry
    this.pnd = 0;       // předběžné varování (bitmask) — pulsující čára
    this._notice = null; // nenásilné upozornění (např. odpojení hráče)
    this._cam = null;
    this.onExit = null; // callback pro "zpět do menu"
    this._endBackBtn = null;
    net.onSnap = s => this._onSnap(s);
    net.onGoal = g => {
      this.goalFlash = 2.5; this.goalText = g.text;
      SFX.goalWhistle();
      setTimeout(() => SFX.goalHorn(), 950);
      setTimeout(() => SFX.crowd(3), 700);
    };
    net.onWhistle = d => {
      this.call = { rule: d.rule, lineX: d.lineX, color: d.color, t: 1.5 };
      // Přerušení hry = jeden ostrý hvizd; rozehrávka z buly se hvízdne při lock→unlock
      SFX.stopWhistle();
    };

    // Render-svět pro Engine: update = interpolace, draw = vykreslení
    this.renderWorld = {
      update: dt => this._interp(dt),
      draw: (ctx, cam) => this._draw(ctx, cam),
    };
  }

  // kompat s main.js (applyProfile/menu) — vlastní hráč (může být null před 1. snapem)
  get local() { const e = this.players.get(this.myId); return e ? e.ent : null; }

  start() {
    this.engine.onTick = (dt, cam) => this._tick(dt, cam);
    this.engine.onDraw = (ctx)     => this._overlay(ctx);
    this.engine.run(this.renderWorld);
  }

  stop() { this.engine.stop(); this.input.destroy?.(); }

  _tick(dt, cam) {
    this._cam = cam;
    if (this.call && (this.call.t -= dt) <= 0) this.call = null;
    if (this._notice && (this._notice.t -= dt) <= 0) this._notice = null;
    // Tlačítko "Zpět do menu" v end-game overlay
    if (this.ended && this._endBackBtn && this.input.lmbJustPressed) {
      const b = this._endBackBtn;
      if (this.input.mouseX >= b.x && this.input.mouseX <= b.x + b.w &&
          this.input.mouseY >= b.y && this.input.mouseY <= b.y + b.h) {
        this.onExit?.();
        return;
      }
    }
    const me = this.localEnt;
    let aim = 0, aimDist = 100;
    if (me) {
      const mouse = fromScreen(this.input.mouseX, this.input.mouseY, cam);
      aim = Math.atan2(mouse.y - me.y, mouse.x - me.x);
      aimDist = Math.hypot(mouse.x - me.x, mouse.y - me.y);
      // CLIENT-SIDE PREDICTION — vlastní hráč se hýbe OKAMŽITĚ (bez čekání na server);
      // server zůstává autoritativní, _interp pak jemně koriguje drift.
      me.aimDist = aimDist;
      _updateAim(me, aim, dt);
      if (!this.locked) me.update(dt);   // při buly setu / oslavě / píšťalce stojíme čelem k puku
      // Client-side passReq: okamžitá odezva (server si to taky nastaví)
      if (this.input.mmbJustPressed && !me.hasPuck) me.passReq = 0.9;
    }
    this.net.input({
      dx: this.input.dx, dy: this.input.dy,
      space: !!this.input.keys['Space'],
      lmb: this.input.lmb, rmb: this.input.rmb, mmb: this.input.mmb,
      aim, aimDist,
    });
    this.input.flush();
    if (this.goalFlash > 0) this.goalFlash -= dt;
  }

  _onSnap(s) {
    this.score = s.score;
    if (s.clk !== undefined) {
      this.clk = s.clk; this.per = s.per; this.pers = s.pers;
      if (s.end && !this.ended) this._endedAt = Date.now();
      this.ended = !!s.end;
    }
    this.pnd = s.pnd || 0;
    // Detekce rozehrávky (lock → unlock): krátká píšťalka bez goalFlash = buly
    if (this.locked && !s.lock && !this.goalFlash) SFX.whistle();
    this.locked = !!s.lock;

    // ── Zvukové události puku ─────────────────────────────────────────────
    const ev = s.puck.ev || 0;
    if (ev & 1) SFX.boards();          // mantinel / síť
    if (ev & 2) SFX.post();            // tyčka / břevno
    if (ev & 4) SFX.iceDrop();         // puk dopadl na led

    const seen = new Set();
    for (const ps of s.players) {
      seen.add(ps.id);
      const isMe = ps.id === this.myId;
      let e = this.players.get(ps.id);
      const prevHasPuck = e ? e.ent.hasPuck : false;
      if (!e) {
        const ent = new Player(ps.id, ps.team, isMe ? this.input : null);
        ent.x = ps.x; ent.y = ps.y; ent.bodyAngle = ps.ba; ent.aimAngle = ps.aa; ent.carryAngle = ps.ca; ent._stickDisp = ps.sd;
        e = { ent, isMe, tx: ps.x, ty: ps.y, tba: ps.ba, taa: ps.aa, tca: ps.ca, tsd: ps.sd, sx: ps.x, sy: ps.y };
        this.players.set(ps.id, e);
        if (isMe) this.localEnt = ent;
      }
      const ent = e.ent;
      // autoritativní diskrétní stav (pro všechny)
      ent.team = ps.team; ent.forehand = !!ps.fh; ent.charge = ps.ch;
      ent.handed = ps.hd; ent.name = ps.nm;
      ent.color = ps.col || null; ent.num = ps.num; ent.jersey = ps.js || 'solid';
      ent.helmet = ps.hc || null; ent.gloves = ps.gc || null; ent.tape = ps.tc || null;
      ent.stick = ps.sk || null; ent.tapeStyle = ps.ty || 'full'; ent.helmetType = ps.hy || 'visor'; ent.visor = ps.vc || null;

      // Pickup / shoot zvuky z hasPuck přechodu
      const newHasPuck = !!ps.hp;
      if (!prevHasPuck && newHasPuck)  SFX.pickup();      // sebral puk
      if ( prevHasPuck && !newHasPuck && !this.goalFlash) SFX.shoot(ent.charge ?? 0.5); // vystřelil
      ent.hasPuck = newHasPuck;

      if (isMe) {
        e.sx = ps.x; e.sy = ps.y;  // jen reconcile cíl; pozici/úhly/stick predikuju lokálně
      } else {
        e.tx = ps.x; e.ty = ps.y; e.tba = ps.ba; e.taa = ps.aa; e.tca = ps.ca; e.tsd = ps.sd;
        ent._dispReach = ps.dr; ent._dispCharge = ps.dc; ent.crossCheck = !!ps.cc; ent._lean = ps.ln;
        ent.passReq = ps.pr ?? 0;
      }
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) {
      if (this.players.get(id).ent === this.localEnt) this.localEnt = null;
      this.players.delete(id);
    }

    this.puck._tx = s.puck.x; this.puck._ty = s.puck.y; this.puck.z = s.puck.z;
    this.puck.trailColor = s.puck.tc || null;
    this._applyGoalie(this.goalieL, s.gl);
    this._applyGoalie(this.goalieR, s.gr);
  }

  _applyGoalie(g, d) {
    if (!d) return;
    const prevFlash = g._saveFlash || 0;
    g._tx = d.x; g._ty = d.y; g._ttilt = d.t;
    g._holdTimer = d.h ? 1 : 0; g._saveFlashMax = d.sm || 0.3; g._screen = d.sc;
    g.color = d.col || null;
    // Zvuk zákroku + vizuální recoil: nový saveFlash vyšší než starý = čerstvý zákrok
    if (d.sf > prevFlash + 0.05) {
      if      (d.st === 'glove')   SFX.glove();
      else if (d.st === 'blocker') SFX.blocker();
      else if (d.st === 'pads' || d.st === 'cover') SFX.pads();
      g._saveRecoil  = 0.15;
      g._saveRecoilX = Math.random() < 0.5 ? -1 : 1;
    }
    g._saveType = d.st; g._saveFlash = d.sf;
  }

  _interp(dt) {
    const k  = Math.min(1, 22 * dt);
    const ka = Math.min(1, 18 * dt);
    const rk = Math.min(1, 10 * dt); // reconcile vlastního hráče — jemná korekce driftu
    for (const e of this.players.values()) {
      const ent = e.ent;
      if (e.isMe) {
        // predikce proběhla v _tick; jemně dotáhni k serveru
        ent.x += (e.sx - ent.x) * rk;
        ent.y += (e.sy - ent.y) * rk;
        // STROP odchylky: predikce nesmí utéct od serveru (klient nepredikuje srážky
        // s gólmanem/soupeřem) → bez tohohle bys o ně „kroužil" na místě.
        const dx = ent.x - e.sx, dy = ent.y - e.sy, d = Math.hypot(dx, dy), MAX = 16;
        if (d > MAX) { ent.x = e.sx + dx / d * MAX; ent.y = e.sy + dy / d * MAX; }
        continue;
      }
      const px = ent.x, py = ent.y;
      ent.x += (e.tx - ent.x) * k; ent.y += (e.ty - ent.y) * k;
      ent.vx = (ent.x - px) / Math.max(dt, 1e-3); ent.vy = (ent.y - py) / Math.max(dt, 1e-3);
      ent.bodyAngle  = lerpAngle(ent.bodyAngle,  e.tba, ka);
      ent.aimAngle   = lerpAngle(ent.aimAngle,   e.taa, ka);
      ent.carryAngle = lerpAngle(ent.carryAngle, e.tca, k);
      ent._stickDisp = lerpAngle(ent._stickDisp ?? e.tsd, e.tsd, k);
      if (ent.passReq > 0) ent.passReq = Math.max(0, ent.passReq - dt);
    }
    // Puk: když ho držím lokálně, cradle k MÉ predikované holi (ostré vedení bez lagu),
    // jinak plynule k pozici od serveru.
    if (this.localEnt && this.localEnt.hasPuck) {
      this.puck._cradleTo(this.localEnt);
    } else {
      this.puck.x += (this.puck._tx - this.puck.x) * k;
      this.puck.y += (this.puck._ty - this.puck.y) * k;
    }
    for (const g of [this.goalieL, this.goalieR]) {
      const prevGY = g.y;
      g.x += ((g._tx ?? g.x) - g.x) * k;
      g.y += ((g._ty ?? g.y) - g.y) * k;
      g._vy = (g.y - prevGY) / Math.max(dt, 1e-3);
      g._tilt = lerpAngle(g._tilt, g._ttilt ?? 0, ka);
      if (g._saveFlash  > 0) g._saveFlash  = Math.max(0, g._saveFlash  - dt);
      if (g._saveRecoil > 0) g._saveRecoil = Math.max(0, g._saveRecoil - dt * 4);
    }
  }

  _draw(ctx, cam) {
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.rink.draw(ctx, cam);
    // Pevné objekty pro clip hokejky (hokejka neprojde hráči/gólmany)
    const solids = [];
    for (const e of this.players.values()) solids.push({ ent: e.ent, x: e.ent.x, y: e.ent.y, r: e.ent.radius });
    solids.push({ ent: this.goalieL, x: this.goalieL.x, y: this.goalieL.y, r: this.goalieL.radius });
    solids.push({ ent: this.goalieR, x: this.goalieR.x, y: this.goalieR.y, r: this.goalieR.radius });
    this.puck.draw(ctx, cam);   // puk POD hráči → hokejka se kreslí navrch (puk leží na ledě u čepele)
    for (const e of this.players.values()) {
      e.ent._solids = solids.filter(so => so.ent !== e.ent);
      e.ent._isLocal = e.isMe;   // charge arc kreslíme jen vlastnímu hráči (ostatní vidí nápřah hole)
      e.ent.draw(ctx, cam);
    }
    // Golmani navrchu — stejné pořadí jako solo (world: rink→puk→hráč→golman)
    this.goalieL.draw(ctx, cam);
    this.goalieR.draw(ctx, cam);
  }

  notify(text) { this._notice = { text, t: 3 }; }

  _overlay(ctx) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const tm = this.settings.teams;
    const cx = W / 2;
    // scoreboard
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx - 150, 8, 300, 56);
    const mm = Math.floor(this.clk / 60), ss = this.clk % 60;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 24px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, cx, 36);
    ctx.font = '11px monospace'; ctx.fillStyle = '#8aa';
    ctx.fillText(t('period_of', this.per, this.pers), cx, 54);
    // skóre + jména týmů
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'right'; ctx.fillStyle = tm.home.color; ctx.fillText(this.score.home, cx - 80, 44);
    ctx.textAlign = 'left';  ctx.fillStyle = tm.away.color; ctx.fillText(this.score.away, cx + 80, 44);
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'right'; ctx.fillStyle = tm.home.color; ctx.fillText(this._clip(tm.home.name, 12), cx - 80, 24);
    ctx.textAlign = 'left';  ctx.fillStyle = tm.away.color; ctx.fillText(this._clip(tm.away.name, 12), cx + 80, 24);

    if (this._notice) {                       // nenásilné upozornění (odpojení) — hra běží dál
      const a = Math.min(1, this._notice.t);
      ctx.font = '14px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(220,230,245,${0.85 * a})`;
      ctx.fillText(this._notice.text, cx, 80);
    }

    if (this.goalFlash > 0) {
      const a = Math.min(1, this.goalFlash);
      ctx.fillStyle = `rgba(255,220,60,${a * 0.12})`; ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 64px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,220,60,${a})`;
      ctx.fillText(this.goalText, cx, H / 2);
    }

    // Předběžné varování — výrazně pulsující čára (offside pozice / icing v běhu)
    if (this.pnd && this._cam) {
      const cam = this._cam, y0 = cam.oy, y1 = cam.oy + RINK.h * cam.scale;
      const p = 0.5 + 0.5 * Math.sin(Date.now() / 120);   // 0..1
      const line = (xw, col) => {
        const lx = cam.ox + xw * cam.scale;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = (12 + 16 * p) * cam.scale; // záře
        ctx.globalAlpha = 0.5 + 0.5 * p;
        ctx.lineWidth = (9 + 6 * p) * cam.scale;
        ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y1); ctx.stroke();
        ctx.restore();
      };
      if (this.pnd & 1) line(RINK.blueLineRight, '#86ccff');  // svítivá modrá (offside)
      if (this.pnd & 2) line(RINK.blueLineLeft, '#86ccff');
      if (this.pnd & 4) line(RINK.goalLineRight, '#ff6a55');  // svítivá červená (icing)
      if (this.pnd & 8) line(RINK.goalLineLeft, '#ff6a55');
    }

    // Odpískané pravidlo — zvýraznění čáry na ledě + banner
    if (this.call && this._cam) {
      const a = Math.min(1, this.call.t);
      const cam = this._cam;
      const lx = cam.ox + this.call.lineX * cam.scale;
      const y0 = cam.oy, y1 = cam.oy + RINK.h * cam.scale;
      ctx.save();
      ctx.strokeStyle = this.call.color; ctx.globalAlpha = 0.35 + 0.45 * a;
      ctx.lineWidth = 7 * cam.scale; ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y1); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = `rgba(0,0,0,0.5)`; ctx.fillRect(cx - 160, H * 0.3 - 30, 320, 52);
      ctx.font = 'bold 30px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = this.call.color; ctx.fillText(t(this.call.rule), cx, H * 0.3 + 7);
    }

    // Šipka k volnému příjemci — vidí jen lokální hráč s pukem
    const _me = this.local;
    if (_me?.hasPuck && this._cam) {
      const cam = this._cam;
      const pulse = Math.sin(Date.now() / 280) * 0.5 + 0.5;
      for (const [, e] of this.players) {
        if (e.isMe || !(e.ent.passReq > 0)) continue;
        const s1 = toScreen(_me.x, _me.y, cam);
        const s2 = toScreen(e.ent.x, e.ent.y, cam);
        const dx = s2.x - s1.x, dy = s2.y - s1.y, dist = Math.hypot(dx, dy);
        if (dist < 20) continue;
        const nx = dx / dist, ny = dy / dist, a = 0.55 + pulse * 0.45;
        ctx.save();
        ctx.strokeStyle = `rgba(80,200,255,${a})`; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(s1.x + nx * 22, s1.y + ny * 22);
        ctx.lineTo(s2.x - nx * 30, s2.y - ny * 30);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = `rgba(80,200,255,${a})`;
        ctx.save(); ctx.translate(s2.x - nx * 26, s2.y - ny * 26); ctx.rotate(Math.atan2(dy, dx));
        ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.restore();
      }
    }

    if (this.ended) {
      ctx.fillStyle = 'rgba(7,9,15,0.78)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.font = 'bold 52px "Segoe UI", sans-serif'; ctx.fillText(t('end_game'), cx, H / 2 - 50);
      ctx.font = 'bold 34px monospace';
      ctx.fillText(`${this._clip(tm.home.name, 12)}  ${this.score.home} : ${this.score.away}  ${this._clip(tm.away.name, 12)}`, cx, H / 2 + 6);
      const win = this.score.home > this.score.away ? tm.home.name : this.score.away > this.score.home ? tm.away.name : null;
      ctx.font = '22px "Segoe UI", sans-serif'; ctx.fillStyle = '#cde';
      ctx.fillText(win ? `${t('winner')}: ${this._clip(win, 14)}` : t('draw'), cx, H / 2 + 48);
      ctx.font = '15px "Segoe UI", sans-serif'; ctx.fillStyle = '#8aa';
      const secLeft = this._endedAt ? Math.max(0, Math.ceil((10000 - (Date.now() - this._endedAt)) / 1000)) : 10;
      ctx.fillText(secLeft > 0 ? t('rematch_in', secLeft) : t('starting_rematch'), cx, H / 2 + 86);
      // Tlačítko "Zpět do menu"
      if (this.onExit) {
        const btnW = 200, btnH = 38;
        const btnX = cx - btnW / 2, btnY = H / 2 + 112;
        this._endBackBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
        const mx = this.input.mouseX, my = this.input.mouseY;
        const hover = mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH;
        ctx.fillStyle = hover ? '#1a2a3a' : '#0e1620';
        ctx.strokeStyle = hover ? '#3a5070' : '#1e2a36';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(btnX, btnY, btnW, btnH, 8); else ctx.rect(btnX, btnY, btnW, btnH);
        ctx.fill(); ctx.stroke();
        ctx.font = '13px "Segoe UI", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = hover ? '#90b8d8' : '#4a6a82';
        ctx.fillText(t('esc_back'), cx, btnY + 19);
        ctx.textBaseline = 'alphabetic';
      } else {
        this._endBackBtn = null;
      }
    }
  }

  _clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) : s; }
}

// ════════════════════════════════════════════════════════════════════════
// SandboxGame — lokální trénink (1 hráč + passer), plná lokální simulace.
// ════════════════════════════════════════════════════════════════════════
export class SandboxGame {
  constructor(canvas) {
    this.canvas    = canvas;
    this.score     = { home: 0, away: 0 };
    this.goalFlash = 0;
    this.goalText  = '';

    this.input  = new Input(canvas);
    this.local  = new Player('local', 'home', this.input);
    this.local._isLocal = true;   // v solu vidím vlastní charge arc
    this.puck   = new Puck();
    this.goalie = new Goalie();
    this.passer = new Passer();

    this.world = new World([new Rink(), this.puck, this.local, this.goalie, this.passer]);
    this.world.onGoal     = result => this._handleGoal(result);
    this.world.onWhistle  = ev     => this._handleWhistle(ev);
    this.world.onResolveInteractions = world => this._resolveInteractions(world);
    this._whistleBanner = null;   // { text, t } — zobrazí se vlajka/banner

    this.engine = new Engine(canvas);
    this._rWas            = false;
    this._tabWas          = false;
    this._cam             = null;
    this._chargeDecaying  = false;
    this._chargeBlocked   = false;
    this._chargeCancelled = false;
    this._oneTimer        = false;
    this._goalLock        = false;
  }

  start() {
    this._reset();   // nájezd: hráč na středu s pukem od začátku
    this.engine.onTick      = (dt, cam) => this._tick(dt, cam);
    this.engine.onAfterTick = ()        => this._soundTick();
    this.engine.onDraw      = (ctx)     => this._drawOverlay(ctx);
    this.engine.run(this.world);
  }

  _soundTick() {
    const ev = this.puck._ev || 0;
    if (ev & 1) SFX.boards();
    if (ev & 2) SFX.post();
    if (ev & 4) SFX.iceDrop();
  }

  _tick(dt, cam) {
    const mouse = fromScreen(this.input.mouseX, this.input.mouseY, cam);
    const adx = mouse.x - this.local.x, ady = mouse.y - this.local.y;
    this.local.aimDist = Math.hypot(adx, ady); // dosah hole dle kurzoru
    _updateAim(this.local, Math.atan2(ady, adx), dt);

    if (this.input.lmbJustPressed) { this._chargeCancelled = false; this._oneTimer = !this.local.hasPuck; }
    if (!this.input.lmb) this._chargeBlocked = false;

    // Crosscheck (RMB bez puku) ruší jakékoli rozdělané nabití
    if (this.input.rmb && !this.local.hasPuck && this.local.charge > 0) {
      this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false; this._oneTimer = false;
    }

    // Při crosschecku (RMB bez puku) nelze nabíjet
    if (this.input.lmb && !this._chargeBlocked && !(this.input.rmb && !this.local.hasPuck)) {
      if (!this._chargeDecaying) {
        const cap = (this.local.hasPuck && !this._oneTimer) ? 1 : 0.95;
        this.local.charge = Math.min(cap, this.local.charge + CHARGE_RATE * dt);
        if (this.local.charge >= 1 && this.local.hasPuck && !this._oneTimer) { this._chargeDecaying = true; this.local.overcharged = true; }
      } else if (this.local.hasPuck) {
        this.local.charge = Math.max(0, this.local.charge - CHARGE_RATE * 1.8 * dt);
        if (this.local.charge <= 0) {
          this.local.shoot(this.puck, 0.12);
          this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
        }
      } else {
        this._chargeDecaying = false; this.local.overcharged = false;
      }
    }
    const rmbCancelledCharge = this.input.rmbJustPressed && this.local.hasPuck && this.local.charge > 0;
    if (this.input.lmbJustReleased && !rmbCancelledCharge) {
      if (this.local.hasPuck && !this._chargeCancelled) this.local.shoot(this.puck, this.local.charge);
      this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
      this._chargeCancelled = false; this._oneTimer = false;
    }
    if (this.input.rmbJustPressed && this.local.hasPuck) {
      if (this.local.charge > 0.08) {
        this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
        this._chargeBlocked = true;
        this._chargeCancelled = true;
      } else {
        this.local.charge = 0;
        const lead = _leadAim(this.local.stickTip, this.passer, PUCK.passSpeed);
        this.local.pass(this.puck, lead);
      }
    }

    const rDown = !!this.input.keys['KeyR'];
    if (rDown && !this._rWas) this._reset();
    this._rWas = rDown;

    // MMB — žádost o nahrávku od passeru
    if (this.input.mmbJustPressed) {
      this.local.passReq = 0.9;
      if (this.passer.hasPuck) {
        this.passer.forceReturn();
      } else if (!this.local.hasPuck) {
        const ang = _leadAim(this.passer, this.local, PUCK.passSpeed + 40);
        this.puck.x  = this.passer.x;
        this.puck.y  = this.passer.y;
        this.puck.vx = Math.cos(ang) * (PUCK.passSpeed + 40);
        this.puck.vy = Math.sin(ang) * (PUCK.passSpeed + 40);
        this.puck.z  = this.puck.vz = 0;
        this.passer._receiveCooldown = 0.55;
      }
    }

    // Tab held — drag passer to mouse position
    const tabDown = !!this.input.keys['Tab'];
    if (tabDown) {
      const mw = fromScreen(this.input.mouseX, this.input.mouseY, cam);
      this.passer.dragTo(mw.x, mw.y);
    }
    this.passer.isDragging = tabDown;
    this._tabWas = tabDown;

    this.input.flush();

    // Pevné objekty pro clip hokejky (hokejka neprojde gólmanem/passerem)
    this.local._solids = [
      { x: this.goalie.x, y: this.goalie.y, r: this.goalie.radius },
      { x: this.passer.x, y: this.passer.y, r: this.passer.radius ?? 7 },
    ];

    if (this.goalFlash > 0) this.goalFlash -= dt;
    if (this._whistleBanner && this._whistleBanner.t > 0) this._whistleBanner.t -= dt;
  }

  _resolveInteractions(world) {
    const { puck, players } = world;
    if (!puck) return;

    if (this._goalLock) return;

    // Fyzická kolize hráče s passerem běží VŽDY — i když passer drží puk
    // Při bodychecku tak hráč pocítí odpor (passer ho odrazí, zůstane pevný)
    for (const p of players) {
      const dx = p.x - this.passer.x, dy = p.y - this.passer.y;
      const dist = Math.hypot(dx, dy);
      const minD = (p.radius ?? 7) + (this.passer.radius ?? 7);
      if (dist > 0 && dist < minD) {
        const nx = dx / dist, ny = dy / dist, pen = minD - dist;
        const KB = 85;
        const both = !this.passer.isDragging && !this.passer.hasPuck;
        if (both) {
          p.x += nx * pen * 0.5; p.y += ny * pen * 0.5;
          this.passer.x -= nx * pen * 0.5; this.passer.y -= ny * pen * 0.5;
          this.passer.vx -= nx * KB; this.passer.vy -= ny * KB;
        } else {
          p.x += nx * pen; p.y += ny * pen;
        }
        const dot = p.vx * nx + p.vy * ny;
        if (dot < 0) { p.vx -= dot * nx; p.vy -= dot * ny; }
        p.vx += nx * KB; p.vy += ny * KB; p._knockT = 0.2;
      }
    }

    if (this.passer.hasPuck) {
      puck.x = this.passer.x;  puck.y  = this.passer.y;
      puck.vx = 0;             puck.vy  = 0;
      puck.z  = 0;             puck.vz  = 0;
      if (this.passer._wantsToReturn) {
        this.passer._wantsToReturn    = false;
        this.passer.hasPuck           = false;
        this.passer._receiveCooldown  = 0.55;
        const ang = _leadAim(this.passer, this.local, PUCK.passSpeed + 40);
        puck.vx = Math.cos(ang) * (PUCK.passSpeed + 40);
        puck.vy = Math.sin(ang) * (PUCK.passSpeed + 40);
      }
      return;
    }

    const anyoneHasPuck = players.some(p => p.hasPuck);

    for (const p of world.players) this.goalie.blockPlayer(p);
    for (const p of players) this.goalie.pokeCheck(p, puck);

    // Zvuky pickup/shoot (sandbox)
    for (const p of players) {
      const hadPuck = this._prevHasPuck?.get(p.id);
      if (hadPuck === false && p.hasPuck) SFX.pickup();
      if (hadPuck === true  && !p.hasPuck && !this.goalFlash) SFX.shoot(p.charge ?? 0.5);
    }
    if (!this._prevHasPuck) this._prevHasPuck = new Map();
    for (const p of players) this._prevHasPuck.set(p.id, p.hasPuck);

    for (let i = 0; i < players.length; i++)
      for (let j = 0; j < players.length; j++)
        if (i !== j) players[i].tryCrossCheck(players[j]);

    if (!anyoneHasPuck) {
      const prevSaveFlash = this.goalie._saveFlash || 0;
      const saved = this.goalie.blockPuck(puck, world);
      if (saved && (this.goalie._saveFlash || 0) > prevSaveFlash + 0.05) {
        const st = this.goalie._saveType;
        if      (st === 'glove')   SFX.glove();
        else if (st === 'blocker') SFX.blocker();
        else                       SFX.pads();
      }
      if (saved) puck.x = Math.min(puck.x, RINK.goalLineRight - 1);
      for (const p of players) if (p.tryDeflect(puck)) break;
      this.goalie.controlLoosePuck(puck);

      if (!this.goalie.isHolding) {
        let pickedUp = false;
        for (const p of players) {
          if (p.tryPickup(puck)) { pickedUp = true; break; }
        }
        if (!pickedUp) this.passer.tryReceive(puck);
      }
    }

    if (puck.goalScored) {
      this._goalLock = true;
      world.onGoal?.(puck.goalScored);
    }
  }

  _drawOverlay(ctx) {
    _renderHUD(ctx, this.score);
    if (this._whistleBanner && this._whistleBanner.t > 0) {
      _renderWhistleBanner(ctx, this._whistleBanner);
    }
    if (this.goalFlash > 0) {
      _renderJumbotron(ctx, this.goalFlash, this._goalTeam, this.score);
    }
  }

  _handleGoal(result) {
    const isHome = result === 'goal-home';
    if (isHome) this.score.home++; else this.score.away++;
    this._goalTeam  = isHome ? 'home' : 'away';
    this.goalFlash  = 4.0;
    SFX.goalWhistle();
    setTimeout(() => SFX.goalHorn(), 950);
    setTimeout(() => SFX.crowd(3), 700);
    setTimeout(() => this._reset(), 4200);
  }

  _handleWhistle(ev) {
    SFX.stopWhistle();
    const labels = {
      'goalie-hold':          '🧤 Golman drží příliš dlouho',
      'goalie-interference':  '🚫 Najíždění do golmana',
    };
    this._whistleBanner = { text: labels[ev.reason] ?? 'Přerušení hry', t: 2.5 };
    // Po 1s resetovat puk (faceoff)
    setTimeout(() => {
      this.puck.reset();
      this._goalLock = false;
      this.world._goalLock = false;
    }, 1000);
  }

  _reset() {
    // Nájezd: hráč na středu ledu, puk u čepele, čelem k bráně
    const cx = RINK.centerX, cy = RINK.h / 2;
    const p = this.local;
    p.x = cx; p.y = cy;
    p.vx = p.vy = 0;
    p.hasPuck = false;
    p.charge = 0; p.overcharged = false;
    p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = 0;

    // puck.reset() vyčistí goalScored, faceoffTimer a veškerý state
    this.puck.reset();
    this.puck.x  = cx + 18; this.puck.y  = cy;
    this.puck.vx = 0;       this.puck.vy = 0;
    this.puck.z  = 0;       this.puck.vz = 0;
    this.puck.faceoffTimer = 0;  // bez freeze — nájezd startuje hned

    this.passer.x = cx - 120; this.passer.y = cy;
    this.passer.vx = this.passer.vy = 0;
    this.passer.hasPuck = false;

    this.goalFlash = 0;
    this._goalLock = false;
    this.world._goalLock = false;
  }
}

// ════════════════════════════════════════════════════════════════════════
// TutorialGame — řízený onboarding (8 kroků → profil)
// ════════════════════════════════════════════════════════════════════════
const _TUT_ICON  = { move:'⛸️', brake:'🛑', aim:'🎯', spin:'🌀', pickup:'🏒', shoot:'💥', pass:'↗️', mmb:'📨', passer:'🤝', bodycheck:'💪', goal:'🥅' };
const _TUT_COLOR = { move:'#3a9fff', brake:'#22ccee', aim:'#9b5cff', spin:'#ff8a66', pickup:'#ff8a1e', shoot:'#ff4455', pass:'#19c37d', mmb:'#3a9fff', passer:'#ffcf3a', bodycheck:'#ff4455', goal:'#ffcf3a' };
const _TUT = [
  {
    id: 'move',
    title: { cs: 'Pohyb po ledě', en: 'Skating' },
    desc:  { cs: 'Dojeď do zeleného kruhu', en: 'Skate to the green circle' },
    sub:   { cs: 'W / A / S / D  nebo šipky', en: 'W / A / S / D  or arrow keys' },
    keys:  ['W', 'A', 'S', 'D'],
    hidePuck: true,
    setup(g) {
      g._reset();
      g.local.hasPuck = false;
      g.puck.x = 30; g.puck.y = RINK.h - 30; g.puck.vx = g.puck.vy = 0; g.puck.faceoffTimer = 1;
      g._tutTarget = { x: RINK.blueLineRight + 70, y: RINK.h / 2 - 50 };
    },
    check: g => Math.hypot(g.local.x - g._tutTarget.x, g.local.y - g._tutTarget.y) < 48,
    hl:    g => ({ type: 'zone', x: g._tutTarget.x, y: g._tutTarget.y, r: 48 }),
  },
  {
    id: 'brake',
    title: { cs: 'Hokejová brzda', en: 'Hockey stop' },
    desc:  { cs: 'Rozjeď se a přibrzdí — drž mezerník', en: 'Skate around, then brake — hold Space' },
    sub:   { cs: 'Space rychle snižuje rychlost · skvělé před bránou nebo při změně směru', en: 'Space brakes fast · great near goal or when changing direction' },
    keys:  ['Space'],
    hidePuck: true,
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      g.puck.x = 30; g.puck.y = RINK.h - 30; g.puck.vx = g.puck.vy = 0; g.puck.faceoffTimer = 1;
      g._tutBrakeTimer = 0;
    },
    check: g => g._tutBrakeTimer >= 0.4,
    hl:    null,
  },
  {
    id: 'aim',
    title: { cs: 'Hokejka a mušička', en: 'Stick & aiming' },
    desc:  { cs: 'Myš míří hokejkou — vzdálenost od hráče = vysunutí hole', en: 'Mouse aims the stick — distance from player = stick reach' },
    sub:   { cs: 'Blízko těla = stažená hůl · daleko = plné natažení · hůl jde za myší, ne za tělem', en: 'Close = tucked stick · far = full extension · stick follows mouse, not body' },
    keys:  { cs: ['pohyb myší'], en: ['mouse move'] },
    hidePuck: true,
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      g.puck.x = 30; g.puck.y = RINK.h - 30; g.puck.vx = g.puck.vy = 0; g.puck.faceoffTimer = 1;
      g._tutAimTimer = 0; g._tutAimLastAngle = null;
    },
    check: g => g._tutAimTimer >= 2.0,
    hl:    null,
  },
  {
    id: 'spin',
    title: { cs: 'Ztráta puku — rychlá rotace', en: 'Puck slip — fast rotation' },
    desc:  { cs: 'Drž puk a rychle roztočí myší — puk ti unikne. Vyzkoušej to!', en: 'Hold the puck and spin the mouse fast — it slips away. Try it!' },
    sub:   { cs: 'Kurzor BLÍZKO = krátká hůl, hůř ho ztratíš · daleko = velký oblouk, snáz vypadne', en: 'Cursor CLOSE = short stick, harder to lose · far = wide arc, slips easier' },
    keys:  { cs: ['rychlý pohyb myší'], en: ['spin mouse fast'] },
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = true;
      g.local.carryAngle = g.local.aimAngle;
      g.puck.z = g.puck.vz = 0; g.puck.faceoffTimer = 0;
      g.passer.hasPuck = false;
      g._tutSpinLost = false; g._tutSpinWasPuck = true;
    },
    check: g => g._tutSpinLost,
    hl:    null,
  },
  {
    id: 'pickup',
    title: { cs: 'Zvedni puk', en: 'Pick up the puck' },
    desc:  { cs: 'Přibruslí k puku — zvedne se automaticky', en: 'Skate close to the puck — it picks up automatically' },
    sub:   { cs: 'Puk leží na ledě, jen k němu přijeď', en: 'The puck is on the ice, just skate to it' },
    keys:  [],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      g.puck.reset();
      g.puck.x = g.local.x + 80; g.puck.y = g.local.y;
      g.puck.vx = g.puck.vy = 0; g.puck.z = g.puck.vz = 0; g.puck.faceoffTimer = 0;
      g.passer.hasPuck = false;
    },
    check: g => g.local.hasPuck,
    hl:    g => ({ type: 'target', x: g.puck.x, y: g.puck.y }),
  },
  {
    id: 'shoot',
    title: { cs: 'Střela', en: 'Shooting' },
    desc:  { cs: 'Miř myší na bránu a stiskni levé tlačítko', en: 'Aim cursor at the goal and press left mouse button' },
    sub:   { cs: 'Tap = žabička · drž déle = silnější slap shot', en: 'Tap = flick · hold longer = powerful slapshot' },
    keys:  ['LMB'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      if (!g.local.hasPuck) {
        g.puck.reset(); g.puck.x = g.local.x + 15; g.puck.y = g.local.y;
        g.puck.vx = g.puck.vy = 0; g.puck.z = g.puck.vz = 0; g.puck.faceoffTimer = 0;
      }
      g.passer.hasPuck = false;
      g._tutShot = false; g._tutShotHadPuck = g.local.hasPuck;
    },
    check: g => g._tutShot,
    hl:    g => ({ type: 'arrow', tx: RINK.goalLineRight, ty: RINK.h / 2 }),
  },
  {
    id: 'pass',
    title: { cs: 'Nahrávka', en: 'Passing' },
    desc:  { cs: 'Stiskni pravé tlačítko myši s pukem — nahrávka na passera', en: 'Right-click with the puck — pass to your teammate' },
    sub:   { cs: 'Bez puku = bodycheck / crosscheck', en: 'Without puck = bodycheck / crosscheck' },
    keys:  ['RMB'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.passer.x = RINK.centerX - 100; g.passer.y = RINK.h / 2 - 60;
      g.passer.vx = g.passer.vy = 0; g.passer.hasPuck = false;
      g.puck.reset(); g.puck.x = g.local.x + 12; g.puck.y = g.local.y;
      g.puck.vx = g.puck.vy = 0; g.puck.z = g.puck.vz = 0; g.puck.faceoffTimer = 0;
      g._tutPassDone = false;
    },
    check: g => g._tutPassDone,
    hl:    g => ({ type: 'target', x: g.passer.x, y: g.passer.y }),
  },
  {
    id: 'mmb',
    title: { cs: 'Žádost o nahrávku', en: 'Requesting a pass' },
    desc:  { cs: 'Stiskni kolečko myši — passer ti pošle puk', en: 'Click middle mouse button — passer sends you the puck' },
    sub:   { cs: 'Spoluhráči v online uvidí žluté kroužky — "jsem volný!"', en: 'Teammates in online see yellow rings — "I\'m open!"' },
    keys:  ['MMB'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      g.passer.x = RINK.centerX; g.passer.y = RINK.h / 2;
      g.passer.vx = g.passer.vy = 0; g.passer.hasPuck = true;
    },
    check: g => g.local.hasPuck,
    hl:    g => ({ type: 'target', x: g.passer.x, y: g.passer.y }),
  },
  {
    id: 'passer',
    title: { cs: 'Passer — tvůj spoluhráč', en: 'Passer — your teammate' },
    desc:  { cs: 'Přetáhni passera na libovolnou pozici — drž Tab + pohybuj myší', en: 'Drag the passer anywhere — hold Tab + move mouse' },
    sub:   { cs: 'Pouze v Tréninku · v online má každý tým reálné spoluhráče', en: 'Practice mode only · in online you play with real teammates' },
    keys:  ['Tab'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      g.puck.x = RINK.centerX + 160; g.puck.y = RINK.h / 2 + 60; g.puck.vx = g.puck.vy = 0;
      g.passer.x = RINK.centerX; g.passer.y = RINK.h / 2;
      g.passer.vx = g.passer.vy = 0; g.passer.hasPuck = false;
      g._tutTabTimer = 0;
    },
    check: g => g._tutTabTimer >= 1.5,
    hl:    g => ({ type: 'target', x: g.passer.x, y: g.passer.y }),
  },
  {
    id: 'bodycheck',
    title: { cs: 'Bodycheck', en: 'Bodycheck' },
    desc:  { cs: 'Přibliž se k passerovi a stiskni pravé tlačítko myši BEZ puku', en: 'Get close to the passer and right-click WITHOUT the puck' },
    sub:   { cs: 'Vyraž mu puk — musíš ho skutečně bumpnout', en: 'Knock the puck loose — you must actually bump into him' },
    keys:  ['RMB'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      g.local._passCooldown = 0; g.local._crossCheckCool = 0; g.local._shootCooldown = 0;
      g.passer.x = g.local.x + 80; g.passer.y = g.local.y;
      g.passer.vx = g.passer.vy = 0; g.passer.hasPuck = true;
      g.puck.x = g.passer.x; g.puck.y = g.passer.y; g.puck.vx = g.puck.vy = 0;
      g._tutBodycheck = false; g._tutBcWasCC = false;
    },
    check: g => g._tutBodycheck,
    hl:    g => ({ type: 'target', x: g.passer.x, y: g.passer.y }),
  },
  {
    id: 'goal',
    title: { cs: 'Dej gól!', en: 'Score a goal!' },
    desc:  { cs: 'Vyber si roh brány, namiř hokejku a vystřel', en: 'Pick a corner, aim your stick, and shoot' },
    sub:   { cs: 'Puk se vrátí po každé zachycené střele', en: 'Puck respawns after every save' },
    keys:  ['LMB'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      g.puck.reset(); g.puck.x = g.local.x + 15; g.puck.y = g.local.y;
      g.puck.vx = g.puck.vy = 0; g.puck.z = g.puck.vz = 0; g.puck.faceoffTimer = 0;
      g.passer.hasPuck = false; g.passer.x = RINK.centerX - 80; g.passer.y = RINK.h / 2;
      g._tutGoalRespawn = 0; g._tutGoalDone = false;
    },
    check: g => g._tutGoalDone,
    hl:    g => ({ type: 'arrow', tx: RINK.goalLineRight, ty: RINK.h / 2 }),
  },
];

export class TutorialGame extends SandboxGame {
  constructor(canvas) {
    super(canvas);
    this._tStep   = 0;
    this._tDone   = false;
    this._tDoneT  = 0;
    this._finished   = false;
    this._finT       = 0;
    this._tutTarget      = null;
    this._tutGoalRespawn = 0;
    this._tutGoalDone    = false;
    this._tutCam         = null;
    this._tSlide         = 0;   // 0=hidden → 1=visible, slide-in animation
    this.onComplete = null;
  }

  start() {
    super.start();
    _TUT[0].setup(this);

    const origTick = this.engine.onTick;
    this.engine.onTick = (dt, cam) => {
      this._tutCam = cam;
      this._preLmb = this.input.lmbJustPressed; // capture BEFORE origTick calls flush()
      origTick(dt, cam);
      this._tutTick(dt);
    };

    const origDraw = this.engine.onDraw;
    this.engine.onDraw = (ctx, cam) => {
      origDraw(ctx);
      this._drawTut(ctx, cam ?? this._tutCam);
    };
  }

  _handleGoal(result) {
    const goalStep = _TUT.findIndex(s => s.id === 'goal');
    if (this._tStep === goalStep && !this._tutGoalDone) {
      this._tutGoalDone = true;
      const isHome = result === 'goal-home';
      if (isHome) this.score.home++; else this.score.away++;
      this._goalTeam = isHome ? 'home' : 'away';
      this.goalFlash = 4.0;
      SFX.goalWhistle();
      setTimeout(() => SFX.goalHorn(), 950);
      setTimeout(() => SFX.crowd(3), 700);
      setTimeout(() => { this._finished = true; this._finT = 0; }, 4200);
    } else if (this._tStep < goalStep) {
      // Gól před goal stepem: potichu resetuj puk
      this._goalLock = false; this.world._goalLock = false;
      this.puck.reset();
      this.puck.x = this.local.x + 15; this.puck.y = this.local.y;
      this.puck.vx = this.puck.vy = 0; this.puck.z = this.puck.vz = 0; this.puck.faceoffTimer = 0;
    }
  }

  _tutTick(dt) {
    if (this._finished) {
      this._finT += dt;
      if (this._finT > 1.0) {
        const inp = this.input;
        const btn = this._finBtn;
        const clickOnBtn = this._preLmb && btn &&
          this.input.mouseX >= btn.x && this.input.mouseX <= btn.x + btn.w &&
          this.input.mouseY >= btn.y && this.input.mouseY <= btn.y + btn.h;
        if (clickOnBtn || inp.keys['Enter']) {
          const isFirst = !localStorage.getItem('hockey_tutorial_done');
          localStorage.setItem('hockey_tutorial_done', '1');
          this.onComplete?.(isFirst);
        }
      }
      return;
    }

    const step = _TUT[this._tStep];
    if (!step) return;

    // Zmraz puk v rohu pro kroky kde není potřeba (freeze každý frame po world ticku)
    if (step.hidePuck) {
      this.puck.x = 30; this.puck.y = RINK.h - 30;
      this.puck.vx = this.puck.vy = 0;
      this.puck.faceoffTimer = Math.max(this.puck.faceoffTimer, 0.5);
    }

    // Krok 'brake': drž Space při pohybu
    if (step.id === 'brake') {
      const speed = Math.hypot(this.local.vx, this.local.vy);
      if (this.input.keys['Space'] && speed > 30) {
        this._tutBrakeTimer = (this._tutBrakeTimer ?? 0) + dt;
      }
    }

    // Krok 'aim': sleduj pohyb mušičky po dobu 2s
    if (step.id === 'aim') {
      const ang = this.local.aimAngle;
      if (this._tutAimLastAngle !== null && Math.abs(ang - this._tutAimLastAngle) > 0.01) {
        this._tutAimTimer = (this._tutAimTimer ?? 0) + dt;
      }
      this._tutAimLastAngle = ang;
    }

    // Krok 'shoot': detekuj střelu (měl puk → ztratil puk, passer nemá)
    if (step.id === 'shoot') {
      const nowHas = this.local.hasPuck;
      if (this._tutShotHadPuck && !nowHas && !this.passer.hasPuck) this._tutShot = true;
      this._tutShotHadPuck = nowHas;
    }

    // Krok 'pass': passer dostal puk
    if (step.id === 'pass' && this.passer.hasPuck) this._tutPassDone = true;

    // Krok 'passer': drž Tab
    if (step.id === 'passer' && this.input.keys['Tab']) this._tutTabTimer = (this._tutTabTimer ?? 0) + dt;

    // Krok 'spin': ztráta puku rychlou rotací
    if (step.id === 'spin') {
      if (this._tutSpinWasPuck && !this.local.hasPuck) this._tutSpinLost = true;
      this._tutSpinWasPuck = this.local.hasPuck;
    }

    // Krok 'bodycheck': puk leží u passera; pokud ho hráč omylem sebere, vrátit
    if (step.id === 'bodycheck') {
      if (this.passer.hasPuck) {
        // Pin puk na passera každý frame (world ho může posunout)
        this.puck.x = this.passer.x; this.puck.y = this.passer.y;
        this.puck.vx = this.puck.vy = 0;
      }
      if (this.local.hasPuck) {
        // Hráč omylem sebral puk — vrátit passerovi
        this.local.hasPuck = false;
        this.local._shootCooldown = 0.3;
        this.passer.hasPuck = true;
        this.puck.x = this.passer.x; this.puck.y = this.passer.y;
        this.puck.vx = this.puck.vy = 0; this.puck.faceoffTimer = 0.35;
      } else {
        // Detekce bodycheck: RMB + blízkost
        const d = Math.hypot(this.local.x - this.passer.x, this.local.y - this.passer.y);
        if (this.input.rmb && d < 30) {
          this._tutBodycheck = true;
          this.passer.hasPuck = false;
          const nx = (this.passer.x - this.local.x) / (d || 1), ny = (this.passer.y - this.local.y) / (d || 1);
          this.passer.vx = nx * 220; this.passer.vy = ny * 220;
          this.puck.vx = nx * 180; this.puck.vy = ny * 180;
        }
      }
    }

    // Auto-respawn puck on miss/save during goal step
    if (step.id === 'goal' && !this._tutGoalDone && this.goalFlash <= 0) {
      if (this.local.hasPuck) {
        this._tutGoalRespawn = 0;
      } else {
        const dist = Math.hypot(this.puck.x - this.local.x, this.puck.y - this.local.y);
        if (!this._tutGoalRespawn && dist > 100) this._tutGoalRespawn = 1.8;
        if (this._tutGoalRespawn > 0) {
          this._tutGoalRespawn = Math.max(0, this._tutGoalRespawn - dt);
          if (this._tutGoalRespawn === 0) {
            this.puck.reset();
            this.puck.x = this.local.x + 15; this.puck.y = this.local.y;
            this.puck.vx = this.puck.vy = 0; this.puck.z = this.puck.vz = 0;
            this.puck.faceoffTimer = 0;
            this._goalLock = false; this.world._goalLock = false;
          }
        }
      }
    }

    if (!this._tDone && step.check(this)) {
      this._tDone = true; this._tDoneT = 0;
    }

    if (this._tDone) {
      this._tDoneT += dt;
      if (this._tDoneT > 0.9) {
        const next = this._tStep + 1;
        this._goalLock = false; this.world._goalLock = false; this.goalFlash = 0;
        if (next >= _TUT.length) {
          this._finished = true; this._finT = 0;
        } else {
          this._tStep = next; this._tSlide = 0;
          this._tDone = false; this._tDoneT = 0;
          _TUT[next].setup(this);
        }
      }
    }

    // Slide-in animace panelu
    this._tSlide = Math.min(1, (this._tSlide ?? 0) + dt * 5);
  }

  _drawTut(ctx, cam) {
    if (this._finished) { this._drawTutFinished(ctx); return; }
    const step = _TUT[this._tStep];
    if (!step) return;
    if (cam) this._drawTutHl(ctx, cam, step.hl?.(this));
    this._drawTutPanel(ctx, step, cam);
  }

  _drawTutHl(ctx, cam, hl) {
    if (!hl) return;
    const pulse = Math.sin(Date.now() / 340) * 0.5 + 0.5;
    const a = 0.55 + pulse * 0.45;
    ctx.save();
    if (hl.type === 'zone') {
      const s = toScreen(hl.x, hl.y, cam);
      const r = hl.r * cam.scale;
      ctx.strokeStyle = `rgba(70,210,110,${a})`;
      ctx.lineWidth = 2.5; ctx.setLineDash([10, 7]);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // Fill tint
      ctx.fillStyle = `rgba(70,210,110,${0.06 + pulse * 0.06})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    } else if (hl.type === 'target') {
      const s = toScreen(hl.x, hl.y, cam);
      ctx.strokeStyle = `rgba(70,210,110,${a})`;
      ctx.lineWidth = 2.5; ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(s.x, s.y, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      this._tutArrow(ctx, cam, this.local.x, this.local.y, hl.x, hl.y, a);
    } else if (hl.type === 'arrow') {
      this._tutArrow(ctx, cam, this.local.x, this.local.y, hl.tx, hl.ty, a);
    }
    ctx.restore();
  }

  _tutArrow(ctx, cam, x1, y1, x2, y2, a) {
    const s1 = toScreen(x1, y1, cam), s2 = toScreen(x2, y2, cam);
    const dx = s2.x - s1.x, dy = s2.y - s1.y, dist = Math.hypot(dx, dy);
    if (dist < 30) return;
    const nx = dx / dist, ny = dy / dist;
    ctx.strokeStyle = `rgba(70,210,110,${a})`;
    ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(s1.x + nx * 22, s1.y + ny * 22);
    ctx.lineTo(s2.x - nx * 30, s2.y - ny * 30);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = `rgba(70,210,110,${a})`;
    ctx.save();
    ctx.translate(s2.x - nx * 26, s2.y - ny * 26);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -7); ctx.lineTo(-7, 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawTutPanel(ctx, step, cam) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    const done = this._tDone;
    const col  = done ? '#22cc88' : (_TUT_COLOR[step.id] ?? '#3a9fff');
    const icon = _TUT_ICON[step.id] ?? '🏒';
    const ea   = _ease(Math.min(1, this._tSlide ?? 1));
    const PAD  = 14;
    const tail = 16;
    const bw   = Math.min(340, W * 0.44);

    // Resolve language-aware keys
    const keys = Array.isArray(step.keys) ? step.keys : (step.keys?.[lang] ?? []);
    const hasKeys = !done && keys.length > 0;

    // Measure text for dynamic height
    const titleText = (done ? '✓ ' : '') + (step.title?.[lang] ?? '');
    const descText  = step.desc?.[lang] ?? '';
    const subText   = step.sub ? (step.sub[lang] ?? step.sub.cs ?? '') : '';

    const LHD = 18;  // desc line height (font 13px)
    const LHS = 16;  // sub line height  (font 12px)

    ctx.font = '13px "Segoe UI", sans-serif';
    const descLines = _countLines(ctx, descText, bw - PAD * 2);
    ctx.font = '12px "Segoe UI", sans-serif';
    const subLines  = subText ? _countLines(ctx, subText, bw - PAD * 2) : 0;

    const HEADER_H = 46;
    const PAD_AH   = 10;               // gap after header before title
    const TITLE_H  = 22;               // bold 16px, baseline at +15
    const PAD_TD   = 5;                // title → desc gap
    const DESC_H   = descLines * LHD + 4;
    const PAD_DS   = subLines > 0 ? 6 : 0;
    const SUB_H    = subLines > 0 ? subLines * LHS + 2 : 0;
    const PAD_SK   = hasKeys ? 8 : 0;
    const KEYS_H   = hasKeys ? 28 : 0;
    const FOOT_H   = 16;
    const bh = HEADER_H + PAD_AH + TITLE_H + PAD_TD + DESC_H + PAD_DS + SUB_H + PAD_SK + KEYS_H + FOOT_H;

    // Anchor
    const hl = step.hl?.(this);
    let anc = null;
    if (cam) {
      if      (hl?.type === 'zone')   anc = toScreen(hl.x, hl.y, cam);
      else if (hl?.type === 'target') anc = toScreen(hl.x, hl.y, cam);
      else if (hl?.type === 'arrow')  anc = toScreen(hl.tx, hl.ty, cam);
      else                            anc = toScreen(this.local.x, this.local.y, cam);
    }

    let bx, by, tailDir = 'down';
    if (anc) {
      bx = anc.x - bw / 2;
      by = anc.y - bh - tail - 12;
      if (by < 70) { by = anc.y + tail + 12; tailDir = 'up'; }
      bx = Math.max(10, Math.min(W - bw - 10, bx));
      by = Math.max(10, Math.min(H - bh - 10, by));
    } else {
      bx = W / 2 - bw / 2; by = 70;
    }

    by += (1 - ea) * (tailDir === 'down' ? -36 : 36);

    ctx.save();
    ctx.globalAlpha = ea;

    // Glow + box
    ctx.shadowColor = col; ctx.shadowBlur = 30;
    ctx.fillStyle = '#060b1c'; ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    _rrect(ctx, bx, by, bw, bh, 14); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // Header fill
    ctx.globalAlpha = ea * (done ? 0.32 : 0.22);
    ctx.fillStyle = col;
    _rrect(ctx, bx, by, bw, HEADER_H, [14, 14, 0, 0]); ctx.fill();
    ctx.globalAlpha = ea;

    // Tail
    if (anc) {
      const tx = Math.max(bx + 22, Math.min(bx + bw - 22, anc.x));
      const ty = tailDir === 'down' ? by + bh : by;
      const sy = tailDir === 'down' ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(tx - tail * 0.7, ty); ctx.lineTo(tx, ty + sy * tail); ctx.lineTo(tx + tail * 0.7, ty);
      ctx.closePath();
      ctx.fillStyle = '#060b1c'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    }

    // Icon + step counter
    ctx.font = '22px serif'; ctx.textAlign = 'left';
    ctx.fillText(icon, bx + PAD, by + 30);
    ctx.font = 'bold 11px "Segoe UI", sans-serif'; ctx.fillStyle = col;
    ctx.fillText(`${this._tStep + 1} / ${_TUT.length}`, bx + 46, by + 17);

    // Progress bar
    const pbw = bw - 62;
    ctx.fillStyle = '#1a2540'; _rrect(ctx, bx + 46, by + 24, pbw, 4, 2); ctx.fill();
    ctx.fillStyle = col;
    _rrect(ctx, bx + 46, by + 24, pbw * ((this._tStep + (done ? 1 : 0.5)) / _TUT.length), 4, 2); ctx.fill();

    // — Flow layout —
    let ry = by + HEADER_H + PAD_AH;

    // Title (bold 16px, baseline 15px below section top)
    ctx.font = 'bold 16px "Segoe UI", sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = done ? '#22cc88' : '#ffffff';
    ctx.fillText(titleText, bx + PAD, ry + 15);
    ry += TITLE_H + PAD_TD;

    // Desc (13px, each line baseline = section top + 13 + i*LHD)
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillStyle = done ? '#8ddcb0' : '#d0e4f7';
    _wrapText(ctx, descText, bx + PAD, ry + 13, bw - PAD * 2, LHD);
    ry += DESC_H + PAD_DS;

    // Sub (12px, lighter color)
    if (subLines > 0) {
      ctx.font = '12px "Segoe UI", sans-serif'; ctx.fillStyle = '#8aacc4';
      _wrapText(ctx, subText, bx + PAD, ry + 11, bw - PAD * 2, LHS);
      ry += SUB_H + PAD_SK;
    }

    // Key chips
    if (hasKeys) {
      ctx.font = 'bold 11px "Segoe UI", monospace';
      let kx = bx + PAD, ky = ry + 2;
      for (const k of keys) {
        const kw = Math.max(32, ctx.measureText(k).width + 18);
        ctx.fillStyle = '#080f1e'; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        _rrect(ctx, kx, ky, kw, 22, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col; ctx.textAlign = 'center';
        ctx.fillText(k, kx + kw / 2, ky + 14);
        kx += kw + 6;
      }
    }

    // ESC hint
    ctx.font = '9px "Segoe UI", sans-serif'; ctx.fillStyle = '#2a3a52';
    ctx.textAlign = 'right'; ctx.fillText('Esc = menu', bx + bw - 8, by + bh - 5);

    ctx.restore();
  }

  _drawTutFinished(ctx) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const a = Math.min(1, this._finT * 1.6);
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    ctx.save();
    ctx.globalAlpha = a * 0.78;
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;

    const bw = Math.min(480, W - 32), bh = 178;
    const bx = (W - bw) / 2, by = H / 2 - bh / 2 - 20;

    ctx.shadowColor = '#22cc88'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#0a1420'; ctx.strokeStyle = '#22cc88'; ctx.lineWidth = 2;
    _rrect(ctx, bx, by, bw, bh, 14); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.globalAlpha = a * 0.15; ctx.fillStyle = '#22cc88';
    _rrect(ctx, bx, by, bw, 50, [14, 14, 0, 0]); ctx.fill();
    ctx.globalAlpha = a;

    ctx.textAlign = 'center';
    ctx.font = 'bold 28px "Segoe UI", sans-serif'; ctx.fillStyle = '#22cc88';
    ctx.fillText(lang === 'en' ? 'Tutorial complete! 🏒' : 'Tutoriál dokončen! 🏒', W / 2, by + 38);

    ctx.font = '14px "Segoe UI", sans-serif'; ctx.fillStyle = '#8aacca';
    ctx.fillText(lang === 'en' ? 'You know the basics — now go play!' : 'Ovládáš základy — jdi hrát!', W / 2, by + 76);

    // Tlačítko
    const btnW = 200, btnH = 44;
    const btnX = W / 2 - btnW / 2, btnY = by + bh - 60;
    this._finBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

    const mx = this.input?.mouseX ?? -1, my = this.input?.mouseY ?? -1;
    const hover = mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH;
    ctx.shadowColor = '#22cc88'; ctx.shadowBlur = hover ? 20 : 10;
    ctx.fillStyle = hover ? '#2de89a' : '#22cc88';
    _rrect(ctx, btnX, btnY, btnW, btnH, 10); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 16px "Segoe UI", sans-serif'; ctx.fillStyle = '#050a14';
    ctx.fillText(lang === 'en' ? 'Continue →' : 'Pokračovat →', W / 2, btnY + 28);

    ctx.font = '10px "Segoe UI", sans-serif'; ctx.fillStyle = '#2a3a52';
    ctx.fillText('Enter', W / 2, by + bh - 8);
    ctx.restore();
  }
}

function _rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
function _ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
function _wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lineH; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}
function _countLines(ctx, text, maxW) {
  if (!text) return 0;
  const words = text.split(' '); let line = ''; let n = 1;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (line && ctx.measureText(test).width > maxW) { line = w; n++; } else line = test;
  }
  return n;
}

function _renderHUD(ctx, score) {
  const width = ctx.canvas.width;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(width / 2 - 90, 12, 180, 42);
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = PLAYER.colors.home;
  ctx.fillText(score.home, width / 2 - 36, 44);
  ctx.fillStyle = '#888';
  ctx.fillText('–', width / 2, 44);
  ctx.fillStyle = PLAYER.colors.away;
  ctx.fillText(score.away, width / 2 + 36, 44);
}

function _renderWhistleBanner(ctx, banner) {
  const W = ctx.canvas.width, a = Math.min(1, banner.t);
  const cx = W / 2;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(cx - 200, 80, 400, 52);
  ctx.font = 'bold 22px "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffdf60';
  ctx.fillText(banner.text, cx, 115);
  ctx.restore();
}

function _renderJumbotron(ctx, flash, goalTeam, score) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const cx = W / 2, cy = H / 2;
  // Fáze animace: 4→3 = zoom-in, 3→1 = stable, 1→0 = fade
  const a = flash < 1 ? flash : 1;

  // Tmavý overlay celé obrazovky
  ctx.save();
  ctx.globalAlpha = a * 0.72;
  ctx.fillStyle = '#07090f';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // Barva gólu
  const col = goalTeam === 'home' ? PLAYER.colors.home : PLAYER.colors.away;

  // Záře za jumbotronem
  const grd = ctx.createRadialGradient(cx, cy, 40, cx, cy, 260);
  grd.addColorStop(0, `rgba(200,200,255,${a * 0.12})`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // Rám jumbotrounu (temný obdélník se zlatým okrajem)
  const bw = Math.min(480, W * 0.88), bh = 200;
  const bx = cx - bw / 2, by = cy - bh / 2;
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(5,8,16,0.94)';
  ctx.strokeStyle = '#c8a040';
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 10);
  else ctx.rect(bx, by, bw, bh);
  ctx.fill(); ctx.stroke();

  // "GOAL!" nápis
  const scale = flash > 3 ? 1 + (flash - 3) * 0.35 : 1;
  ctx.save();
  ctx.translate(cx, by + 68);
  ctx.scale(scale, scale);
  ctx.font = 'bold 62px "Segoe UI Black", "Arial Black", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = col; ctx.fillText('GOAL!', 0, 0);
  // Bílý odlesk
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillText('GOAL!', 0, 0);
  ctx.restore();

  // Skóre pod nápisem
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = PLAYER.colors.home;
  ctx.fillText(score.home, cx - 50, by + 148);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(':', cx, by + 148);
  ctx.fillStyle = PLAYER.colors.away;
  ctx.fillText(score.away, cx + 50, by + 148);

  ctx.restore();
}
