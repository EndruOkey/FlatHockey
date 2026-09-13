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
import { Defender } from './entities/Defender.js';
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
    if (ev & 1)  SFX.boards();          // mantinel
    if (ev & 2)  SFX.post();           // boční tyč
    if (ev & 4)  SFX.iceDrop();        // puk dopadl na led
    if (ev & 8)  SFX.crossbar();       // břevno
    if (ev & 16) SFX.spojnice();       // zadní/boční stěna sítě

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
      ent.helmet = ps.hc || null; ent.shorts = ps.sh || null; ent.gloves = ps.gc || null; ent.tape = ps.tc || null;
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
const _SB_DRILLS = [
  { cs: 'Volný trénink', en: 'Free practice' },
  { cs: 'Breakaway',     en: 'Breakaway'      },
  { cs: 'One-timer',     en: 'One-timer'       },
];
const _SB_DIFFS = [
  { cs: 'Snadný',  en: 'Easy'   },
  { cs: 'Střední', en: 'Medium' },
  { cs: 'Těžký',   en: 'Hard'   },
];
const _SB_DRILL_DESC = [
  {
    title: { cs: 'Volný trénink',    en: 'Free practice' },
    desc:  { cs: 'Střílej, nahrávej, pohybuj se — bez omezení', en: 'Shoot, pass, move — no restrictions' },
    hint:  { cs: '▲ Přidej nahrávače, kužele nebo plochy z menu', en: '▲ Add passer, cones or boards from menu' },
  },
  {
    title: { cs: 'Nájezd',    en: 'Breakaway' },
    desc:  { cs: 'Dojeď sám na bránu. Bránič tě pronásleduje.', en: 'One-on-one against goalie. Defender chases you.' },
    hint:  { cs: 'Tip: Změň stranu v poslední chvíli nebo střílej bekend', en: 'Tip: Change side at last moment or shoot backhand' },
  },
  {
    title: { cs: 'One-timer', en: 'One-timer' },
    desc:  { cs: 'Přijmi přihrávku a okamžitě vystřel — bez zastavení puku', en: 'Receive the pass and shoot immediately — no stopping' },
    hint:  { cs: 'Miř myší na bránu PŘED příchodem puku — načasování je klíč', en: 'Aim at goal BEFORE puck arrives — timing is the key' },
  },
];
const _SB_OT_CONFIGS = [
  { player: {x:870, y:165}, passer: {x:820, y:306} },
  { player: {x:870, y:295}, passer: {x:820, y:162} },
  { player: {x:900, y:165}, passer: {x:750, y:228} },
];

export class SandboxGame {
  constructor(canvas) {
    this.canvas    = canvas;
    this.score     = { home: 0, shots: 0, posts: 0 };
    this.goalFlash = 0;
    this.goalText  = '';

    this.input  = new Input(canvas);
    this.local  = new Player('local', 'home', this.input);
    this.local._isLocal = true;
    this.puck      = new Puck();
    this.goalie    = new Goalie();
    this.passer    = new Passer();
    this._defender = new Defender();

    this.world = new World([new Rink(), this.puck, this.local, this.goalie, this.passer, this._defender]);
    this.world.onGoal     = result => this._handleGoal(result);
    this.world.onWhistle  = ev     => this._handleWhistle(ev);
    this.world.onResolveInteractions = world => this._resolveInteractions(world);
    this._whistleBanner = null;

    this.engine = new Engine(canvas);
    this._rWas            = false;
    this._tabWas          = false;
    this._rWas            = false;
    this._toastMsg        = null;  // null = tab switch | 'reset' = scenario reset
    this._escWas          = false;
    this._isTutorial      = false;   // set true by TutorialGame to hide dock
    this._tabToast        = 0;       // seconds to show tab-switch banner

    // Scenario catalog (localStorage)
    this._catalogOpen     = false;
    this._catalogList     = null;    // null = not loaded yet
    this._catalogScroll   = 0;       // first visible row index
    this._catalogPanel    = null;    // set each frame by _drawCatalogOverlay
    this._catalogRows     = [];      // per-row hit areas set each frame
    this._cam             = null;
    this._chargeDecaying  = false;
    this._chargeBlocked   = false;
    this._chargeCancelled = false;
    this._oneTimer        = false;
    this._goalLock        = false;

    // Training state
    this._sessionTime  = 0;
    this._drillIdx     = 0;    // 0=free, 1=breakaway, 2=onetimer
    this._diffIdx      = 0;    // 0=snadný, 1=střední, 2=těžký
    this._passerPosIdx = 0;
    this._goalZone     = null; // { text, t }
    this._prePassT     = 0;
    this._d1Was = this._d2Was = this._d3Was = this._eWas = false;
    this._activeTab    = 'train';  // 'train' | 'build'
    this._scenarioCode = null;     // last generated code
    this._streak       = 0;
    this._bestStreak   = 0;
    this._lastPokedAt  = 0;
    this._niceGoalFlash = 0;

    // Training objects
    this._trainingObjects = [];
    this._dragObj  = null;
    this._dragOX   = 0;
    this._dragOY   = 0;

    // Defender config (BUILD mode)
    this._defConfig = { preset: 'balanced' };
    this._defConfigOpen = false;

    // Passer config (BUILD mode)
    this._passerConfigOpen = false;
  }

  start() {
    this._reset();
    // Camera: leave room for the always-visible training dock at the bottom
    this.engine.cameraOverride = (canvas) => {
      const DH = this._dockLayout(canvas.width, canvas.height).DH;
      const pad = 36;
      const availH = canvas.height - DH - pad;
      const scale = Math.min((canvas.width - pad*2) / RINK.w, availH / RINK.h);
      return { scale, ox: (canvas.width - RINK.w * scale) / 2, oy: pad + (availH - RINK.h * scale) / 2 };
    };
    this.engine.onTick      = (dt, cam) => this._tick(dt, cam);
    this.engine.onAfterTick = ()        => {
      this._soundTick();
      // Build mode: freeze player, puck and goalie AFTER world.update() so our zeros win
      const _inBuild = this._activeTab === 'build';
      this._defender._showBuild = _inBuild && this._drillIdx === 0;
      if (_inBuild) {
        this.local.vx = 0; this.local.vy = 0;
        this.local.crossCheck = false;
        if (this.puck) {
          this.puck.vx = 0; this.puck.vy = 0; this.puck.vz = 0; this.puck.z = 0;
        }
        // Goalie uses _gvx/_gvy/_vy (not vx/vy)
        this.goalie._gvx = 0; this.goalie._gvy = 0; this.goalie._vy = 0;
        // Freeze defender in build mode
        if (this._defender.active && this._drillIdx === 0) {
          this._defender.vx = 0; this._defender.vy = 0;
          this._defender.x = this._defender.homeX ?? this._defender.x;
          this._defender.y = this._defender.homeY ?? this._defender.y;
        }
      }
    };
    this.engine.onDraw      = (ctx)     => this._drawOverlay(ctx);
    this.engine.run(this.world);
  }

  _soundTick() {
    const ev = this.puck._ev || 0;
    if (ev & 1)  SFX.boards();
    if (ev & 2)  { SFX.post(); this.score.posts++; }
    if (ev & 4)  SFX.iceDrop();
    if (ev & 8)  { SFX.crossbar(); this.score.posts++; }
    if (ev & 16) SFX.spojnice();
  }

  _setDrill(idx) {
    this._drillIdx = idx;
    this._reset(false);
  }

  _applyDifficulty() {
    this.goalie.difficulty = this._diffIdx === 0 ? 'easy'
                           : this._diffIdx === 1 ? 'casual'
                           : 'competitive';
  }

  _schedulePasserFire(delayMs = 900, pos = null) {
    pos = pos ?? { x: this.passer.x, y: this.passer.y };
    this.passer.x  = pos.x; this.passer.y  = pos.y;
    this.passer.vx = 0;     this.passer.vy = 0;
    this.passer.hasPuck = true;
    this.puck.x  = pos.x;  this.puck.y  = pos.y;
    this.puck.vx = 0;       this.puck.vy = 0;
    this.puck.z  = 0;       this.puck.vz = 0;
    this._prePassT = delayMs / 1000;
    setTimeout(() => {
      if (this._drillIdx === 2 && this.passer.hasPuck) {
        this.passer._wantsToReturn = true;
      }
    }, delayMs);
  }

  _tick(dt, cam) {
    this._cam = cam;
    const _wasBuild = this._activeTab === 'build';
    const _uiClick = this._tickMenuInput(cam);
    if (_uiClick) { this._chargeBlocked = true; this._chargeCancelled = true; }

    const mouse = fromScreen(this.input.mouseX, this.input.mouseY, cam);
    if (!_wasBuild) {
      const adx = mouse.x - this.local.x, ady = mouse.y - this.local.y;
      this.local.aimDist = Math.hypot(adx, ady);
      _updateAim(this.local, Math.atan2(ady, adx), dt);
    }

    if (this.input.lmbJustPressed && !_uiClick) { this._chargeCancelled = false; this._oneTimer = !this.local.hasPuck; }
    if (!this.input.lmb) this._chargeBlocked = false;
    if (_wasBuild) { this._chargeBlocked = true; this._chargeCancelled = true; }

    if (!_wasBuild && this.input.rmb && !this.local.hasPuck && this.local.charge > 0) {
      this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false; this._oneTimer = false;
    }

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
    // D2: předat one-timer hint golmanovi — reaguje pomaleji na one-timer střelu
    this.goalie._oneTimerHint = this._oneTimer && this.local.charge > 0.15;
    // D1: weak spot overlay jen na easy
    this.goalie.showWeakSpots = this._diffIdx === 0 && !this._isTutorial;

    const rmbCancelledCharge = this.input.rmbJustPressed && this.local.hasPuck && this.local.charge > 0;
    if (!_wasBuild && this.input.lmbJustReleased && !rmbCancelledCharge && !_uiClick) {
      if (this.local.hasPuck && !this._chargeCancelled) this.local.shoot(this.puck, this.local.charge);
      this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
      this._chargeCancelled = false; this._oneTimer = false;
    }
    if (!_wasBuild && this.input.rmbJustPressed && this.local.hasPuck) {
      if (this.local.charge > 0.08) {
        this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
        this._chargeBlocked = true;
        this._chargeCancelled = true;
      } else if (this.passer.active) {
        this.local.charge = 0;
        const lead = _leadAim(this.local.stickTip, this.passer, PUCK.passSpeed);
        this.local.pass(this.puck, lead);
      } else {
        this.local.charge = 0;
      }
    }

    // ESC closes build mode if active
    const escDown = !!this.input.keys['Escape'];
    if (escDown && !this._escWas && _wasBuild) {
      this._activeTab = 'train';
      this._rotatingObj = null; this._pendingMenuDrag = null;
      this._hoverObj = null; this._dragObj = null; this._dragDidMove = false;
    }
    this._escWas = escDown;

    const rDown = !!this.input.keys['KeyR'];
    if (rDown && !this._rWas) {
      if (!_wasBuild) {
        this._reset();
      } else if (this._scenarioCode) {
        // BUILD mode: reload last scenario
        this._loadScenarioCode(this._scenarioCode);
        this._tabToast = 1.2; this._toastMsg = 'reset';
      }
    }
    this._rWas = rDown;

    if (!_wasBuild && this.input.mmbJustPressed && this.passer.active) {
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

    this.passer.isDragging = this._dragObj === this.passer;

    // Drill keys 1/2/3
    const d1 = !!this.input.keys['Digit1'];
    const d2 = !!this.input.keys['Digit2'];
    const d3 = !!this.input.keys['Digit3'];
    if (d1 && !this._d1Was) this._setDrill(0);
    if (d2 && !this._d2Was) this._setDrill(1);
    if (d3 && !this._d3Was) this._setDrill(2);
    this._d1Was = d1; this._d2Was = d2; this._d3Was = d3;

    // E — cycle goalie difficulty
    const eDown = !!this.input.keys['KeyE'];
    if (eDown && !this._eWas) {
      this._diffIdx = (this._diffIdx + 1) % _SB_DIFFS.length;
      this._applyDifficulty();
    }
    this._eWas = eDown;

    // Tab — přepínání TRÉNINK ↔ BUILD (not in tutorial)
    const tabDown = !!this.input.keys['Tab'];
    if (tabDown && !this._tabWas && !this._isTutorial) {
      if (this._activeTab === 'build') {
        this._activeTab = 'train';
        this._rotatingObj = null; this._pendingMenuDrag = null;
        this._hoverObj = null; this._dragObj = null; this._dragDidMove = false;
      } else {
        this._activeTab = 'build';
      }
      this._tabToast = 1.8;
    }
    this._tabWas = tabDown;
    if (this._tabToast > 0) this._tabToast -= dt;

    // Hover object for context menu (computed each frame, used by _drawOverlay too)
    if (this._rotatingObj) {
      this._hoverObj = this._rotatingObj; // keep hover on object being rotated
    } else {
      this._hoverObj = null;
      if (_wasBuild && !this._dragObj && !this._pendingMenuDrag && cam) {
        const mwH = fromScreen(this.input.mouseX, this.input.mouseY, cam);
        // 96px screen = covers rotation ring (54px) + delete button reach (76+18px)
        const HOVER_W = 96 / cam.scale;
        let bestD = HOVER_W;
        for (const obj of this._trainingObjects) {
          const d = Math.hypot(obj.x - mwH.x, obj.y - mwH.y);
          if (d < bestD) { bestD = d; this._hoverObj = obj; }
        }
        if (!this._hoverObj && this.passer.active) {
          const d = Math.hypot(this.passer.x - mwH.x, this.passer.y - mwH.y);
          if (d < HOVER_W) this._hoverObj = this.passer;
        }
        if (!this._hoverObj && this._defender.active && this._drillIdx === 0) {
          // Suppress defender hover when config panel is open and mouse is over it
          const p = this._defConfigPanel;
          const overPanel = p && this.input.mouseX >= p.x && this.input.mouseX <= p.x + p.w &&
                            this.input.mouseY >= p.y && this.input.mouseY <= p.y + p.h;
          if (!overPanel) {
            const dd = Math.hypot(this._defender.x - mwH.x, this._defender.y - mwH.y);
            if (dd < HOVER_W) this._hoverObj = this._defender;
          }
        }
        if (!this._hoverObj) {
          const dp = Math.hypot(this.local.x - mwH.x, this.local.y - mwH.y);
          if (dp < HOVER_W) this._hoverObj = this.local;
        }
        if (!this._hoverObj) {
          const dk = Math.hypot(this.puck.x - mwH.x, this.puck.y - mwH.y);
          if (dk < HOVER_W) this._hoverObj = this.puck;
        }
      }
    }

    // Pending drag from menu (object only spawns when user actually drags, not on click)
    if (this._pendingMenuDrag && this.input.lmb) {
      const moved = Math.hypot(
        this.input.mouseX - (this._pendingMenuClickSX ?? 0),
        this.input.mouseY - (this._pendingMenuClickSY ?? 0)
      );
      if (moved > 12) {
        const mw = fromScreen(this.input.mouseX, this.input.mouseY, cam);
        const type = this._pendingMenuDrag;
        if (type === 'passer') {
          this.passer.active = true;
          this.passer.x = Math.max(22, Math.min(RINK.w - 22, mw.x));
          this.passer.y = Math.max(22, Math.min(RINK.h - 22, mw.y));
          this.passer.vx = 0; this.passer.vy = 0; this.passer.hasPuck = false;
          this._dragObj = this.passer;
        } else if (type === 'defender') {
          const dx = Math.max(22, Math.min(RINK.w - 22, mw.x));
          const dy = Math.max(22, Math.min(RINK.h - 22, mw.y));
          this._defender.active = true;
          this._defender.homeX = dx; this._defender.homeY = dy;
          this._defender.reset(dx, dy);
          this._defender.config = { ...this._defConfig };
          this._dragObj = this._defender;
        } else {
          const obj = { type, x: Math.max(22, Math.min(RINK.w-22, mw.x)), y: Math.max(22, Math.min(RINK.h-22, mw.y)), vx: 0, vy: 0, angle: type === 'reboard' ? Math.PI/4 : 0 };
          this._trainingObjects.push(obj);
          this._dragObj = obj;
        }
        this._dragClickMW = { x: mw.x, y: mw.y };
        this._dragDidMove = true;
        this._pendingMenuDrag = null;
      }
    } else if (this._pendingMenuDrag && !this.input.lmb) {
      this._pendingMenuDrag = null; // released without dragging, cancel
    }

    // Ongoing rotation (continuous, angle follows mouse around ring)
    if (this._rotatingObj) {
      if (this.input.lmb && cam) {
        const obj = this._rotatingObj;
        const osx = cam.ox + obj.x * cam.scale, osy = cam.oy + obj.y * cam.scale;
        const curAngle = Math.atan2(this.input.mouseY - osy, this.input.mouseX - osx);
        let delta = curAngle - this._rotateBaseAngle;
        while (delta >  Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        obj.angle = this._rotateObjBase + delta;
      } else {
        this._rotatingObj = null;
      }
    }

    if (_wasBuild || this._dragObj || this._rotatingObj) {
      const mw = fromScreen(this.input.mouseX, this.input.mouseY, cam);

      // Context actions: delete button + rotation ring grab
      let _ctxHandled = false;
      const _isSpecial = this._hoverObj === this.local || this._hoverObj === this.puck;
      if (this.input.lmbJustPressed && !_uiClick && _wasBuild && this._hoverObj && cam && !this._rotatingObj && !_isSpecial) {
        const obj = this._hoverObj;
        const osx = cam.ox + obj.x * cam.scale, osy = cam.oy + obj.y * cam.scale;
        const msx = this.input.mouseX, msy = this.input.mouseY;
        const ROT_RING = 54, ROT_GRAB = 12, DEL_BTN = 18;
        const hasRotate = obj !== this.passer && obj.type === 'reboard';
        // Delete button (checked first, takes priority)
        const delAngle = hasRotate ? -Math.PI * 0.75 : -Math.PI / 2;
        const delDist  = hasRotate ? 76 : 54;
        if (Math.hypot(msx - (osx + Math.cos(delAngle)*delDist), msy - (osy + Math.sin(delAngle)*delDist)) < DEL_BTN) {
          if (obj === this.passer) { this.passer.active = false; }
          else if (obj === this._defender) { this._defender.active = false; this._defConfigOpen = false; }
          else { this._trainingObjects = this._trainingObjects.filter(o => o !== obj); }
          this._hoverObj = null;
          this._chargeBlocked = true; this._chargeCancelled = true; _ctxHandled = true;
        }
        // Gear button for defender config (at +44, -44 from center)
        if (!_ctxHandled && obj === this._defender) {
          if (Math.hypot(msx - (osx + 44), msy - (osy - 44)) < 16) {
            this._defConfigOpen = !this._defConfigOpen;
            this._chargeBlocked = true; this._chargeCancelled = true; _ctxHandled = true;
          }
        }
        // Gear button for passer config (at +44, -44 from passer center)
        if (!_ctxHandled && obj === this.passer) {
          if (Math.hypot(msx - (osx + 44), msy - (osy - 44)) < 16) {
            this._passerConfigOpen = !this._passerConfigOpen;
            this._chargeBlocked = true; this._chargeCancelled = true; _ctxHandled = true;
          }
        }
        // Rotation ring grab (anywhere on the circle)
        if (!_ctxHandled && hasRotate) {
          const dist = Math.hypot(msx - osx, msy - osy);
          if (Math.abs(dist - ROT_RING) < ROT_GRAB) {
            this._rotatingObj = obj;
            this._rotateBaseAngle = Math.atan2(msy - osy, msx - osx);
            this._rotateObjBase = obj.angle;
            this._chargeBlocked = true; this._chargeCancelled = true; _ctxHandled = true;
          }
        }
      }

      if (this.input.lmbJustPressed && !_uiClick && _wasBuild && !_ctxHandled) {
        let best = null, bestD = 28;
        for (const obj of this._trainingObjects) {
          const thresh = obj.type === 'cone' ? 12 : 28;
          const d = Math.hypot(obj.x - mw.x, obj.y - mw.y);
          if (d < thresh && d < bestD) { bestD = d; best = obj; }
        }
        if (!best && this.passer.active) {
          const dp = Math.hypot(this.passer.x - mw.x, this.passer.y - mw.y);
          if (dp < 20 && dp < bestD) { bestD = dp; best = this.passer; }
        }
        if (!best && this._defender.active && this._drillIdx === 0) {
          const dd = Math.hypot(this._defender.x - mw.x, this._defender.y - mw.y);
          if (dd < 20 && dd < bestD) { bestD = dd; best = this._defender; }
        }
        if (!best) {
          const dl = Math.hypot(this.local.x - mw.x, this.local.y - mw.y);
          if (dl < 20 && dl < bestD) { bestD = dl; best = this.local; }
        }
        if (!best) {
          // Puk — i když ho hráč drží, v BUILD modu ho lze odtrhnout
          const puckX = this.local.hasPuck ? this.local.x : this.puck.x;
          const puckY = this.local.hasPuck ? this.local.y : this.puck.y;
          const dk = Math.hypot(puckX - mw.x, puckY - mw.y);
          if (dk < 16 && dk < bestD) {
            bestD = dk; best = this.puck;
            if (this.local.hasPuck) {
              this.local.hasPuck = false;
              this.puck.x = this.local.x; this.puck.y = this.local.y;
              this.puck.vx = 0; this.puck.vy = 0; this.puck.spin = 0;
            }
          }
        }
        this._dragObj     = best;
        this._dragClickMW = { x: mw.x, y: mw.y };
        this._dragDidMove = false;
      }
      if (this.input.lmb && this._dragObj) {
        const moved = Math.hypot(mw.x - (this._dragClickMW?.x ?? mw.x), mw.y - (this._dragClickMW?.y ?? mw.y));
        if (moved > 4) this._dragDidMove = true;
        if (this._dragDidMove) {
          const tx = Math.max(22, Math.min(RINK.w - 22, mw.x));
          const ty = Math.max(22, Math.min(RINK.h - 22, mw.y));
          if (this._dragObj === this.passer) {
            this._dragObj.dragTo(mw.x, mw.y);
          } else if (this._dragObj === this._defender) {
            this._defender.x = tx; this._defender.y = ty;
            this._defender.homeX = tx; this._defender.homeY = ty;
            this._defender.vx = 0; this._defender.vy = 0;
          } else if (this._dragObj === this.local) {
            this.local.x = tx; this.local.y = ty;
            this.local.vx = 0; this.local.vy = 0;
          } else if (this._dragObj === this.puck) {
            this.puck.x = tx; this.puck.y = ty;
            this.puck.vx = 0; this.puck.vy = 0;
            this.puck.spin = 0;
          } else {
            this._dragObj.x = tx; this._dragObj.y = ty;
          }
        }
      }
      if (this.input.lmbJustReleased && this._dragObj) {
        this._dragObj = null; this._dragDidMove = false;
      }
    }

    // Update training object physics (cone = fast, reboard = slow)
    for (const obj of this._trainingObjects) {
      if (obj.type === 'cone') {
        if (!obj.vx) obj.vx = 0; if (!obj.vy) obj.vy = 0;
        const spd = Math.hypot(obj.vx, obj.vy);
        if (spd > 1) {
          obj.x += obj.vx * dt; obj.y += obj.vy * dt;
          const f = Math.max(0, 1 - 7 * dt);
          obj.vx *= f; obj.vy *= f;
          if (Math.hypot(obj.vx, obj.vy) < 1) { obj.vx = obj.vy = 0; }
          obj.x = Math.max(14, Math.min(RINK.w - 14, obj.x));
          obj.y = Math.max(14, Math.min(RINK.h - 14, obj.y));
        }
      } else if (obj.type === 'reboard') {
        if (!obj.vx) obj.vx = 0; if (!obj.vy) obj.vy = 0;
        const spd = Math.hypot(obj.vx, obj.vy);
        if (spd > 0.5) {
          obj.x += obj.vx * dt; obj.y += obj.vy * dt;
          const f = Math.max(0, 1 - 4 * dt); // slower stop
          obj.vx *= f; obj.vy *= f;
          if (Math.hypot(obj.vx, obj.vy) < 0.5) { obj.vx = obj.vy = 0; }
          obj.x = Math.max(26, Math.min(RINK.w - 26, obj.x));
          obj.y = Math.max(10, Math.min(RINK.h - 10, obj.y));
        }
      }
    }

    // Cursor
    let _cursorStyle = '';
    if (_wasBuild || this._dragObj || this._pendingMenuDrag || this._rotatingObj) {
      if (this._rotatingObj) {
        _cursorStyle = 'crosshair';
      } else if (this._dragDidMove || this._pendingMenuDrag) {
        _cursorStyle = 'grabbing';
      } else if (this._hoverObj && cam) {
        _cursorStyle = 'grab';
        const obj = this._hoverObj;
        const osx = cam.ox + obj.x * cam.scale, osy = cam.oy + obj.y * cam.scale;
        const ROT_RING = 54, ROT_GRAB = 12, DEL_BTN = 18;
        const msx = this.input.mouseX, msy = this.input.mouseY;
        const hasRotate = obj !== this.passer && obj.type === 'reboard';
        const delAngle = hasRotate ? -Math.PI * 0.75 : -Math.PI / 2;
        const delDist  = hasRotate ? 76 : 54;
        if (Math.hypot(msx-(osx+Math.cos(delAngle)*delDist), msy-(osy+Math.sin(delAngle)*delDist)) < DEL_BTN) {
          _cursorStyle = 'pointer';
        } else if (hasRotate && Math.abs(Math.hypot(msx-osx, msy-osy) - ROT_RING) < ROT_GRAB) {
          _cursorStyle = 'alias'; // signals rotation intent
        }
      } else if (this._dragObj) {
        _cursorStyle = 'grab';
      }
    }
    this.canvas.style.cursor = _cursorStyle || 'crosshair';

    this.input.flush();

    const solids = [{ x: this.goalie.x, y: this.goalie.y, r: this.goalie.radius }];
    if (this.passer.active) solids.push({ x: this.passer.x, y: this.passer.y, r: this.passer.radius ?? 7 });
    if (this._defender.active) solids.push({ x: this._defender.x, y: this._defender.y, r: this._defender.radius });
    this.local._solids = solids;

    // Defender and goalie sticks also clip against player bodies
    const localSolid = { x: this.local.x, y: this.local.y, r: this.local.radius };
    this.goalie._solids = [localSolid];
    if (this._defender.active) {
      this._defender._solids = [localSolid, { x: this.goalie.x, y: this.goalie.y, r: this.goalie.radius }];
    }

    if (this.goalFlash > 0) this.goalFlash -= dt;
    if (this._whistleBanner && this._whistleBanner.t > 0) this._whistleBanner.t -= dt;
    if (this._goalZone && this._goalZone.t > 0) this._goalZone.t -= dt;
    if (this._prePassT > 0) this._prePassT -= dt;

    if (!this._goalLock) this._sessionTime += dt;

    // Streak — reset on defender poke
    const pokedAt = this.local._pokedAt ?? 0;
    if (pokedAt > this._lastPokedAt) {
      this._lastPokedAt = pokedAt;
      this._streak = 0;
    }

    if (this._niceGoalFlash > 0) this._niceGoalFlash -= dt;
  }

  _resolveInteractions(world) {
    const { puck, players } = world;
    if (!puck) return;
    if (this._goalLock) return;

    if (this.passer.active) {
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
    }

    if (this._defender.active) {
      const def = this._defender;
      for (const p of players) {
        if (p === def || p.isGoalie || p.isPasser) continue;
        // Try bodycheck first (physical/crusher only)
        if (!def.tryBodycheck(p, 0)) {
          // Soft collision resolution
          const dx = p.x - def.x, dy = p.y - def.y;
          const dist = Math.hypot(dx, dy);
          const minD = (p.radius ?? 7) + def.radius;
          if (dist > 0 && dist < minD) {
            const nx = dx / dist, ny = dy / dist, pen = minD - dist;
            p.x += nx * pen * 0.5; p.y += ny * pen * 0.5;
            def.x -= nx * pen * 0.5; def.y -= ny * pen * 0.5;
            const dot = p.vx * nx + p.vy * ny;
            if (dot < 0) { p.vx -= dot * nx; p.vy -= dot * ny; }
          }
        }
      }
    }

    const anyoneCarrying = players.some(p => p.hasPuck) || (this.passer.active && this.passer.hasPuck);

    // Puck vs reboards — skip when puck is carried (prevents charge-sound bug)
    if (!anyoneCarrying) {
      for (const obj of this._trainingObjects) {
        if (obj.type !== 'reboard') continue;
        const c = Math.cos(obj.angle), s = Math.sin(obj.angle);
        const dx = puck.x - obj.x, dy = puck.y - obj.y;
        const lx =  dx * c + dy * s;
        const ly = -dx * s + dy * c;
        const hw = 22, hh = 4.5, pr = PUCK.radius;
        if (Math.abs(lx) < hw + pr && Math.abs(ly) < hh + pr) {
          const ox = hw + pr - Math.abs(lx), oy = hh + pr - Math.abs(ly);
          if (oy < ox) {
            const sign = ly < 0 ? -1 : 1;
            const nx = -s * sign, ny = c * sign;
            puck.x += nx * oy; puck.y += ny * oy;
            const dot = puck.vx * nx + puck.vy * ny;
            if (dot < 0) {
              puck.vx -= (1 + 0.82) * dot * nx; puck.vy -= (1 + 0.82) * dot * ny;
              puck._ev |= 1;
            }
          } else {
            const sign = lx < 0 ? -1 : 1;
            const nx = c * sign, ny = s * sign;
            puck.x += nx * ox; puck.y += ny * ox;
            const dot = puck.vx * nx + puck.vy * ny;
            if (dot < 0) {
              puck.vx -= (1 + 0.82) * dot * nx; puck.vy -= (1 + 0.82) * dot * ny;
              puck._ev |= 1;
            }
          }
        }
      }

      // Puck vs cones — weak bounce, cone gets knocked away; no sound (plastic thud)
      for (const obj of this._trainingObjects) {
        if (obj.type !== 'cone') continue;
        const cdx = puck.x - obj.x, cdy = puck.y - obj.y;
        const cdist = Math.hypot(cdx, cdy);
        const cMin = PUCK.radius + 5.5;
        if (cdist > 0 && cdist < cMin) {
          const cnx = cdx / cdist, cny = cdy / cdist;
          puck.x = obj.x + cnx * cMin;
          puck.y = obj.y + cny * cMin;
          const cdot = puck.vx * cnx + puck.vy * cny;
          if (cdot < 0) {
            const spd = Math.hypot(puck.vx, puck.vy);
            obj.vx = (obj.vx ?? 0) - cnx * spd * 0.65;
            obj.vy = (obj.vy ?? 0) - cny * spd * 0.65;
            puck.vx -= (1 + 0.20) * cdot * cnx;
            puck.vy -= (1 + 0.20) * cdot * cny;
          }
        }
      }
    }

    // Player vs training objects — cone yields to player, reboard is solid wall
    for (const obj of this._trainingObjects) {
      for (const p of players) {
        const pr = p.radius ?? 7;
        if (obj.type === 'cone') {
          const dx = p.x - obj.x, dy = p.y - obj.y;
          const dist = Math.hypot(dx, dy);
          const minD = pr + 5.5;
          if (dist > 0 && dist < minD) {
            const nx = dx / dist, ny = dy / dist;
            const pen = minD - dist;
            // Cone takes 90% of separation — player barely slowed
            obj.x -= nx * pen * 0.9; obj.y -= ny * pen * 0.9;
            p.x   += nx * pen * 0.1; p.y   += ny * pen * 0.1;
            const pspd = Math.hypot(p.vx, p.vy) * 0.35;
            obj.vx = (obj.vx ?? 0) - nx * pspd;
            obj.vy = (obj.vy ?? 0) - ny * pspd;
          }
        } else if (obj.type === 'reboard') {
          const c = Math.cos(obj.angle), s = Math.sin(obj.angle);
          const dx = p.x - obj.x, dy = p.y - obj.y;
          const lx =  dx * c + dy * s;
          const ly = -dx * s + dy * c;
          const hw = 22 + pr, hh = 4.5 + pr;
          if (Math.abs(lx) < hw && Math.abs(ly) < hh) {
            const ox = hw - Math.abs(lx), oy = hh - Math.abs(ly);
            const pspd = Math.hypot(p.vx, p.vy) * 0.13;
            if (oy < ox) {
              const sign = ly < 0 ? -1 : 1;
              const nx = -s * sign, ny = c * sign;
              p.x += nx * oy; p.y += ny * oy;
              const dot = p.vx * nx + p.vy * ny;
              if (dot < 0) { p.vx -= dot * nx; p.vy -= dot * ny; }
              obj.vx = (obj.vx ?? 0) - nx * pspd;
              obj.vy = (obj.vy ?? 0) - ny * pspd;
            } else {
              const sign = lx < 0 ? -1 : 1;
              const nx = c * sign, ny = s * sign;
              p.x += nx * ox; p.y += ny * ox;
              const dot = p.vx * nx + p.vy * ny;
              if (dot < 0) { p.vx -= dot * nx; p.vy -= dot * ny; }
              obj.vx = (obj.vx ?? 0) - nx * pspd;
              obj.vy = (obj.vy ?? 0) - ny * pspd;
            }
          }
        }
      }
    }

    if (this.passer.active && this.passer.hasPuck) {
      puck.x = this.passer.x;  puck.y  = this.passer.y;
      puck.vx = 0;             puck.vy  = 0;
      puck.z  = 0;             puck.vz  = 0;
      if (this.passer._wantsToReturn) {
        this.passer._wantsToReturn   = false;
        this.passer.hasPuck          = false;
        this.passer._receiveCooldown = 0.55;
        const tip = (this._drillIdx === 2 && this.local.stickTip) ? this.local.stickTip : null;
        const aimTarget = tip
          ? { x: tip.x, y: tip.y, vx: this.local.vx ?? 0, vy: this.local.vy ?? 0 }
          : this.local;
        const ang = _leadAim(this.passer, aimTarget, PUCK.passSpeed + 50);
        puck.vx = Math.cos(ang) * (PUCK.passSpeed + 50);
        puck.vy = Math.sin(ang) * (PUCK.passSpeed + 50);
      }
      return;
    }

    const anyoneHasPuck = players.some(p => p.hasPuck);
    for (const p of world.players) { if (!p.isDefender) this.goalie.blockPlayer(p); }
    for (const p of players) this.goalie.pokeCheck(p, puck);

    for (const p of players) {
      const hadPuck = this._prevHasPuck?.get(p.id);
      if (hadPuck === false && p.hasPuck) SFX.pickup();
      if (hadPuck === true  && !p.hasPuck && !this.goalFlash) {
        SFX.shoot(p.charge ?? 0.5);
        if (p === this.local && puck.vx > 30) this.score.shots++;
      }
    }
    if (!this._prevHasPuck) this._prevHasPuck = new Map();
    for (const p of players) this._prevHasPuck.set(p.id, p.hasPuck);

    const skaters = players.filter(p => !p.isGoalie && !p.isPasser && !p.isDefender);
    for (let i = 0; i < skaters.length; i++)
      for (let j = 0; j < skaters.length; j++)
        if (i !== j) skaters[i].tryCrossCheck(skaters[j]);

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
        if (!pickedUp && this.passer.active) this.passer.tryReceive(puck);
      }
    }

    if (puck.goalScored) {
      this._goalLock = true;
      world.onGoal?.(puck.goalScored);
    }
  }

  _drawOverlay(ctx) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    ctx.save();

    // ── Build mode: amber border + badge ──
    if (this._activeTab === 'build') {
      const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 500);
      const bw = 4;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = 'rgba(255,200,40,0.82)';
      ctx.lineWidth = bw * 2;
      ctx.strokeRect(bw, bw, W - bw * 2, H - bw * 2);
      ctx.globalAlpha = 1;
      const L = 28;
      ctx.strokeStyle = 'rgba(255,210,50,0.95)';
      ctx.lineWidth = 4;
      for (const [cx, cy, sx, sy] of [[0,0,1,1],[W,0,-1,1],[W,H,-1,-1],[0,H,1,-1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * bw, cy + sy * (bw + L));
        ctx.lineTo(cx + sx * bw, cy + sy * bw);
        ctx.lineTo(cx + sx * (bw + L), cy + sy * bw);
        ctx.stroke();
      }

      // Center ice BUILD icon
      if (this._cam) {
        const { scale: s, ox, oy } = this._cam;
        const cix = ox + (RINK.w / 2) * s;
        const ciy = oy + (RINK.h / 2) * s;
        const pulse2 = 0.6 + 0.4 * Math.sin(Date.now() / 700);
        ctx.save();
        ctx.globalAlpha = 0.18 * pulse2;
        ctx.font = `bold ${Math.round(s * 48)}px "Segoe UI",sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#F5C840';
        ctx.fillText('⚙', cix, ciy - s * 10);
        ctx.globalAlpha = 0.28 * pulse2;
        ctx.font = `700 ${Math.round(s * 14)}px "Segoe UI",sans-serif`;
        ctx.letterSpacing = '0.15em';
        ctx.fillText(lang === 'cs' ? 'STAVĚNÍ' : 'BUILD MODE', cix, ciy + s * 28);
        ctx.letterSpacing = '';
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }
    }

    // Distance rings on ice (semi-transparent, drawn in world space via cam)
    if (this._cam) {
      const { scale: s, ox, oy } = this._cam;
      const gx = ox + RINK.goalLineRight * s;
      const gy = oy + (RINK.goalY + RINK.goalH / 2) * s;
      ctx.setLineDash([5, 9]);
      for (const [d, a] of [[90, 0.11], [150, 0.075], [210, 0.05]]) {
        ctx.beginPath();
        ctx.arc(gx, gy, d * s, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(160,210,255,${a})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Draw training objects
      const _lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
      const _mwR = this._activeTab === 'build' && this.input
        ? fromScreen(this.input.mouseX, this.input.mouseY, this._cam) : null;
      for (const obj of this._trainingObjects) {
        const sx = ox + obj.x * s, sy = oy + obj.y * s;
        if (obj.type === 'cone') {
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.beginPath(); ctx.ellipse(sx + 1.5*s, sy + 2*s, 5*s, 3.5*s, 0, 0, Math.PI*2);
          ctx.fillStyle = '#000'; ctx.fill();
          ctx.restore();
          ctx.beginPath(); ctx.arc(sx, sy, 5.5*s, 0, Math.PI*2);
          ctx.fillStyle = '#f55000'; ctx.fill();
          ctx.beginPath(); ctx.arc(sx, sy, 4*s, 0, Math.PI*2);
          ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.5*s; ctx.stroke();
          ctx.beginPath(); ctx.arc(sx, sy, 1.5*s, 0, Math.PI*2);
          ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
          // Drag ring
          if (this._dragObj === obj) {
            ctx.save();
            ctx.setLineDash([4*s, 3*s]);
            ctx.beginPath(); ctx.arc(sx, sy, 11*s, 0, Math.PI*2);
            ctx.strokeStyle = 'rgba(100,200,255,0.85)'; ctx.lineWidth = 1.5*s; ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        } else if (obj.type === 'reboard') {
          ctx.save();
          ctx.translate(sx, sy); ctx.rotate(obj.angle);
          // Shadow
          ctx.save(); ctx.globalAlpha = 0.28;
          ctx.fillStyle = '#000';
          ctx.fillRect(-22*s + 2.5*s, -5*s + 2.5*s, 44*s, 10*s);
          ctx.restore();
          // Outer metal frame
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(-22*s, -5*s, 44*s, 10*s);
          // Bounce surface (orange-red padded surface inside frame)
          const surfGrad = ctx.createLinearGradient(-22*s, -3.5*s, -22*s, 3.5*s);
          surfGrad.addColorStop(0, '#e85d20');
          surfGrad.addColorStop(0.4, '#c03800');
          surfGrad.addColorStop(1, '#8a2000');
          ctx.fillStyle = surfGrad;
          ctx.fillRect(-20*s, -3.5*s, 40*s, 7*s);
          // Surface highlight (top sheen)
          ctx.fillStyle = 'rgba(255,140,60,0.35)';
          ctx.fillRect(-20*s, -3.5*s, 40*s, 2.5*s);
          // Center stripe (white line like real rebounders)
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(-0.5*s, -3.5*s, 1*s, 7*s);
          // End caps / feet
          ctx.fillStyle = '#444';
          ctx.fillRect(-22*s, -5*s, 3*s, 10*s);
          ctx.fillRect( 19*s, -5*s, 3*s, 10*s);
          // Frame border
          ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8*s;
          ctx.strokeRect(-22*s, -5*s, 44*s, 10*s);
          ctx.restore();

          // Unified ring: drag OR menu hover/rotate (reboard orange-red color)
          const _rbDrag = this._dragObj === obj;
          const _rbHover = this._activeTab === 'build' && (this._hoverObj === obj || this._rotatingObj === obj);
          if (_rbDrag || _rbHover) {
            const ROT_RING = 54, isRot = this._rotatingObj === obj;
            ctx.save();
            ctx.beginPath(); ctx.arc(sx, sy, ROT_RING, 0, Math.PI * 2);
            ctx.strokeStyle = isRot ? 'rgba(255,215,50,0.9)' : 'rgba(232,93,32,0.7)';
            ctx.lineWidth = (isRot || _rbDrag) ? 2 : 1.5;
            ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
            if (_rbHover) {
              // Rotation handle dot — perpendicular to board's long axis
              const ha = obj.angle - Math.PI / 2;
              const hx = sx + Math.cos(ha) * ROT_RING, hy = sy + Math.sin(ha) * ROT_RING;
              ctx.beginPath(); ctx.arc(hx, hy, isRot ? 9 : 7, 0, Math.PI * 2);
              ctx.fillStyle = isRot ? '#ffe066' : 'rgba(232,93,32,0.82)'; ctx.fill();
              ctx.strokeStyle = isRot ? '#c8960a' : 'rgba(180,60,10,0.5)';
              ctx.lineWidth = 1.5; ctx.stroke();
              // ↻ label
              const lx = sx + Math.cos(ha) * (ROT_RING + 17), ly = sy + Math.sin(ha) * (ROT_RING + 17);
              ctx.font = `bold ${isRot ? 13 : 11}px Arial`;
              ctx.fillStyle = isRot ? '#ffe066' : 'rgba(232,93,32,0.8)';
              ctx.textAlign = 'center'; ctx.fillText('↻', lx, ly + 4);
              // Angle line while rotating
              if (isRot && this.input) {
                ctx.globalAlpha = 0.45;
                ctx.beginPath(); ctx.moveTo(sx, sy);
                ctx.lineTo(this.input.mouseX, this.input.mouseY);
                ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1; ctx.stroke();
                ctx.globalAlpha = 1;
              }
              // Delete button (upper-left, outside ring at 76px)
              const delA = -Math.PI * 0.75;
              const dbx = sx + Math.cos(delA) * 76, dby = sy + Math.sin(delA) * 76;
              ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
              ctx.beginPath(); ctx.arc(dbx, dby, 18, 0, Math.PI * 2);
              ctx.fillStyle = '#cc2233'; ctx.fill();
              ctx.shadowBlur = 0;
              ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
              ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#fff';
              ctx.textAlign = 'center'; ctx.fillText('✕', dbx, dby + 5);
            }
            ctx.restore();
          }
        }

        // Unified ring for cone: drag OR menu hover (cone orange color)
        if (obj.type === 'cone' && (this._dragObj === obj || (this._activeTab === 'build' && this._hoverObj === obj))) {
          const _cDrag = this._dragObj === obj, _cHover = this._activeTab === 'build' && this._hoverObj === obj;
          ctx.save();
          ctx.beginPath(); ctx.arc(sx, sy, 38, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(245,85,0,0.7)';
          ctx.lineWidth = _cDrag ? 2 : 1.5; ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
          if (_cHover) {
            ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
            ctx.beginPath(); ctx.arc(sx, sy - 54, 18, 0, Math.PI * 2);
            ctx.fillStyle = '#cc2233'; ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#fff';
            ctx.textAlign = 'center'; ctx.fillText('✕', sx, sy - 54 + 5);
          }
          ctx.restore();
        }
      }

      // Unified ring for passer: drag OR menu hover (passer green color)
      if (this.passer.active && (this._dragObj === this.passer || (this._activeTab === 'build' && this._hoverObj === this.passer))) {
        const _pDrag = this._dragObj === this.passer, _pHover = this._activeTab === 'build' && this._hoverObj === this.passer;
        const pasx = ox + this.passer.x * s, pasy = oy + this.passer.y * s;
        ctx.save();
        ctx.beginPath(); ctx.arc(pasx, pasy, 38, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(61,216,112,0.7)';
        ctx.lineWidth = _pDrag ? 2 : 1.5; ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
        if (_pHover) {
          // Delete button
          ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
          ctx.beginPath(); ctx.arc(pasx, pasy - 54, 18, 0, Math.PI * 2);
          ctx.fillStyle = '#cc2233'; ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#fff';
          ctx.textAlign = 'center'; ctx.fillText('✕', pasx, pasy - 54 + 5);
          // Config gear button
          ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
          ctx.beginPath(); ctx.arc(pasx + 44, pasy - 44, 16, 0, Math.PI * 2);
          ctx.fillStyle = this._passerConfigOpen ? '#0D8844' : '#334455'; ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#fff';
          ctx.textAlign = 'center'; ctx.fillText('⚙', pasx + 44, pasy - 44 + 5);
        }
        ctx.restore();
      }

      // Unified ring for defender: drag OR menu hover (red color)
      if (this._defender.active && this._drillIdx === 0 && (this._dragObj === this._defender || (this._activeTab === 'build' && this._hoverObj === this._defender))) {
        const _dDrag = this._dragObj === this._defender, _dHover = this._activeTab === 'build' && this._hoverObj === this._defender;
        const dfsx = ox + this._defender.x * s, dfsy = oy + this._defender.y * s;
        ctx.save();
        ctx.beginPath(); ctx.arc(dfsx, dfsy, 38, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,60,60,0.7)';
        ctx.lineWidth = _dDrag ? 2 : 1.5; ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
        if (_dHover) {
          // Delete button above
          ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
          ctx.beginPath(); ctx.arc(dfsx, dfsy - 54, 18, 0, Math.PI * 2);
          ctx.fillStyle = '#cc2233'; ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#fff';
          ctx.textAlign = 'center'; ctx.fillText('✕', dfsx, dfsy - 54 + 5);
          // Config gear button (to the right of delete)
          ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
          ctx.beginPath(); ctx.arc(dfsx + 44, dfsy - 44, 16, 0, Math.PI * 2);
          ctx.fillStyle = this._defConfigOpen ? '#CC8800' : '#444466'; ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#fff';
          ctx.textAlign = 'center'; ctx.fillText('⚙', dfsx + 44, dfsy - 44 + 5);
        }
        ctx.restore();
      }

      // Ring pro LOCAL hráče v BUILD mode
      if (this._dragObj === this.local || (this._activeTab === 'build' && this._hoverObj === this.local)) {
        const lsx = ox + this.local.x * s, lsy = oy + this.local.y * s;
        const isDrag = this._dragObj === this.local;
        ctx.save();
        ctx.beginPath(); ctx.arc(lsx, lsy, 36, 0, Math.PI * 2);
        ctx.strokeStyle = isDrag ? 'rgba(100,180,255,0.9)' : 'rgba(100,180,255,0.65)';
        ctx.lineWidth = isDrag ? 2.5 : 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
        if (!isDrag) {
          ctx.font = 'bold 10px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(140,200,255,0.85)';
          ctx.textAlign = 'center';
          ctx.fillText(document.documentElement.lang === 'en' ? 'DRAG' : 'TÁHNI', lsx, lsy - 42);
        }
        ctx.restore();
      }

      // Ring pro PUK v BUILD mode
      if (this._dragObj === this.puck || (this._activeTab === 'build' && this._hoverObj === this.puck)) {
        const pkx = ox + this.puck.x * s, pky = oy + this.puck.y * s;
        const isDrag = this._dragObj === this.puck;
        ctx.save();
        ctx.beginPath(); ctx.arc(pkx, pky, 22, 0, Math.PI * 2);
        ctx.strokeStyle = isDrag ? 'rgba(255,220,80,0.9)' : 'rgba(255,220,80,0.65)';
        ctx.lineWidth = isDrag ? 2.5 : 1.5; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        if (!isDrag) {
          ctx.font = 'bold 10px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(255,220,80,0.85)';
          ctx.textAlign = 'center';
          ctx.fillText(document.documentElement.lang === 'en' ? 'DRAG' : 'TÁHNI', pkx, pky - 28);
        }
        ctx.restore();
      }
    }

    // ── Defender config panel — tutorial style, anchored to defender on ice ──
    this._defConfigPanel = null;
    if (this._activeTab === 'build' && this._drillIdx === 0 && this._defender.active && this._defConfigOpen && this._cam) {
      const cam = this._cam;
      const lang2 = document.documentElement.lang === 'en' ? 'en' : 'cs';
      const COL = '#ff4455';   // defender accent — matches tutorial col pattern

      // Single row: 3 presets replace the 3×3 grid
      const PRESET_OPTS = [
        { val: 'passive',   icon: '🧍', lbl: lang2 === 'cs' ? 'PASIVNÍ'  : 'PASSIVE',   sub: lang2 === 'cs' ? 'Jen stojí'    : 'Just stands' },
        { val: 'zone',      icon: '🏠', lbl: lang2 === 'cs' ? 'ZÓNA'     : 'ZONE',      sub: lang2 === 'cs' ? 'Drží pozici'  : 'Holds zone'  },
        { val: 'balanced',  icon: '⚖',  lbl: lang2 === 'cs' ? 'VYVÁŽENÝ' : 'BALANCED',  sub: lang2 === 'cs' ? 'Akorát'       : 'Just right'  },
        { val: 'forecheck', icon: '🏃', lbl: lang2 === 'cs' ? 'PRESINK'  : 'FORECHECK', sub: lang2 === 'cs' ? 'Tlačí'        : 'Presses'     },
      ];

      const PAD = 14, TAIL = 14, GAP_B = 8, BTN_W = 80, BTN_H = 48;
      const HEADER_H = 44;
      const PW = PAD * 2 + 4 * BTN_W + 3 * GAP_B;
      const PH = HEADER_H + BTN_H + PAD + 4;

      // Anchor to defender screen position
      const anc = toScreen(this._defender.x, this._defender.y, cam);
      let PX = Math.round(anc.x - PW / 2);
      let PY = Math.round(anc.y - PH - TAIL - 12);
      let tailDir = 'down';
      if (PY < 8) { PY = Math.round(anc.y + TAIL + 12); tailDir = 'up'; }
      PX = Math.max(8, Math.min(W - PW - 8, PX));
      PY = Math.max(8, Math.min(H - PH - 8, PY));

      ctx.save();

      // Glow + panel bg (tutorial style)
      ctx.shadowColor = COL; ctx.shadowBlur = 22;
      ctx.fillStyle = '#060b1c';
      _rrect(ctx, PX, PY, PW, PH, 12); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = COL; ctx.lineWidth = 2;
      _rrect(ctx, PX, PY, PW, PH, 12); ctx.stroke();

      // Header tint (tutorial-style)
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = COL;
      _rrect(ctx, PX, PY, PW, HEADER_H, [12, 12, 0, 0]); ctx.fill();
      ctx.globalAlpha = 1;

      // Tail arrow pointing to defender
      const tailTipX = Math.max(PX + 20, Math.min(PX + PW - 20, anc.x));
      const tailBaseY = tailDir === 'down' ? PY + PH : PY;
      const tailSY = tailDir === 'down' ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(tailTipX - TAIL * 0.65, tailBaseY);
      ctx.lineTo(tailTipX, tailBaseY + tailSY * TAIL);
      ctx.lineTo(tailTipX + TAIL * 0.65, tailBaseY);
      ctx.closePath();
      ctx.fillStyle = '#060b1c'; ctx.fill();
      ctx.strokeStyle = COL; ctx.lineWidth = 2; ctx.stroke();

      // Header — icon + title + close ×
      ctx.font = '20px serif'; ctx.textAlign = 'left';
      ctx.fillText('⚔', PX + PAD, PY + 30);
      ctx.font = 'bold 12px "Segoe UI",sans-serif'; ctx.fillStyle = COL;
      ctx.fillText(lang2 === 'cs' ? 'BRÁNIČ' : 'DEFENDER', PX + PAD + 28, PY + 19);
      ctx.font = '400 10px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.50)';
      ctx.fillText(lang2 === 'cs' ? 'klikni na volbu pro změnu' : 'click option to change', PX + PAD + 28, PY + 32);
      // Close ×
      const closeBtnX = PX + PW - 24, closeBtnY = PY + 22;
      ctx.font = 'bold 16px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'center'; ctx.fillText('×', closeBtnX, closeBtnY + 6);
      this._defConfigCloseBtn = { x: closeBtnX - 14, y: closeBtnY - 10, w: 28, h: 28 };

      // Single row of 3 preset buttons
      const panelBtns = [];
      const rowY = PY + HEADER_H + 4;
      const curPreset = this._defConfig.preset ?? 'balanced';
      PRESET_OPTS.forEach((opt, oi) => {
        const bx = PX + PAD + oi * (BTN_W + GAP_B);
        const by = rowY;
        const isActive = curPreset === opt.val;

        _rrect(ctx, bx, by, BTN_W, BTN_H, 7);
        if (isActive) {
          ctx.fillStyle = 'rgba(255,68,85,0.28)'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,68,85,0.90)'; ctx.lineWidth = 1.5; ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
        }

        ctx.font = '16px serif'; ctx.textAlign = 'center';
        ctx.fillText(opt.icon, bx + BTN_W / 2, by + 18);
        ctx.font = `${isActive ? '700' : '600'} 10px "Segoe UI",sans-serif`;
        ctx.fillStyle = isActive ? COL : 'rgba(200,200,220,0.75)';
        ctx.fillText(opt.lbl, bx + BTN_W / 2, by + 32);
        ctx.font = '400 8px "Segoe UI",sans-serif';
        ctx.fillStyle = 'rgba(180,180,200,0.45)';
        ctx.fillText(opt.sub, bx + BTN_W / 2, by + 43);

        panelBtns.push({ key: 'preset', val: opt.val, x: bx, y: by, w: BTN_W, h: BTN_H });
      });

      ctx.restore();
      this._defConfigPanel = { x: PX, y: PY, w: PW, h: PH, btns: panelBtns };
    }

    // ── Passer config panel ──
    this._passerConfigPanel = null;
    if (this._activeTab === 'build' && this._drillIdx === 0 && this.passer.active && this._passerConfigOpen && this._cam) {
      const cam   = this._cam;
      const lang2 = document.documentElement.lang === 'en' ? 'en' : 'cs';
      const COL   = '#3dd870';

      const SPEED_OPTS = [
        { val: 0, lbl: lang2 === 'cs' ? 'POMALU' : 'SLOW',   sub: '~80 px/s' },
        { val: 1, lbl: lang2 === 'cs' ? 'NORMÁLNĚ' : 'NORMAL', sub: lang2 === 'cs' ? 'jako hráč' : 'player speed' },
        { val: 2, lbl: lang2 === 'cs' ? 'RYCHLE' : 'FAST',   sub: '~300 px/s' },
      ];
      const ANGLE_OPTS = [
        { val: Math.PI / 2,  lbl: lang2 === 'cs' ? 'SVÍŠLě' : 'VERTICAL',   icon: '↕' },
        { val: 0,            lbl: lang2 === 'cs' ? 'VODOROVNĚ' : 'HORIZONTAL', icon: '↔' },
        { val: Math.PI / 4,  lbl: lang2 === 'cs' ? 'DIAGONÁLA ↗' : 'DIAG ↗', icon: '↗' },
        { val: -Math.PI / 4, lbl: lang2 === 'cs' ? 'DIAGONÁLA ↘' : 'DIAG ↘', icon: '↘' },
      ];

      const PAD = 12, TAIL = 14, GAP_B = 6;
      const BTN_W = 74, BTN_H = 44, ANG_W = 64, ANG_H = 40;
      const HEADER_H = 44, SEC_H = 20;
      const ROW1_H = BTN_H, ROW2_H = ANG_H;
      const INNER_SPD = 3 * BTN_W + 2 * GAP_B;   // 234
      const INNER_ANG = 4 * ANG_W + 3 * GAP_B;   // 274
      const PW = PAD * 2 + Math.max(INNER_SPD, INNER_ANG);
      const PH = HEADER_H + SEC_H + ROW1_H + 10 + SEC_H + ROW2_H + PAD;

      const anc = toScreen(this.passer.x, this.passer.y, cam);
      let PX = Math.round(anc.x - PW / 2);
      let PY = Math.round(anc.y - PH - TAIL - 12);
      let tailDir = 'down';
      if (PY < 8) { PY = Math.round(anc.y + TAIL + 12); tailDir = 'up'; }
      PX = Math.max(8, Math.min(W - PW - 8, PX));
      PY = Math.max(8, Math.min(H - PH - 8, PY));

      ctx.save();
      ctx.shadowColor = COL; ctx.shadowBlur = 18;
      ctx.fillStyle = '#060c18';
      _rrect(ctx, PX, PY, PW, PH, 12); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = COL; ctx.lineWidth = 2;
      _rrect(ctx, PX, PY, PW, PH, 12); ctx.stroke();

      ctx.globalAlpha = 0.18; ctx.fillStyle = COL;
      _rrect(ctx, PX, PY, PW, HEADER_H, [12, 12, 0, 0]); ctx.fill();
      ctx.globalAlpha = 1;

      // Tail
      const tailTipX = Math.max(PX + 20, Math.min(PX + PW - 20, anc.x));
      const tailBaseY = tailDir === 'down' ? PY + PH : PY;
      const tailSY    = tailDir === 'down' ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(tailTipX - TAIL * 0.65, tailBaseY);
      ctx.lineTo(tailTipX, tailBaseY + tailSY * TAIL);
      ctx.lineTo(tailTipX + TAIL * 0.65, tailBaseY);
      ctx.closePath();
      ctx.fillStyle = '#060c18'; ctx.fill();
      ctx.strokeStyle = COL; ctx.lineWidth = 2; ctx.stroke();

      // Header
      ctx.font = 'bold 12px "Segoe UI",sans-serif'; ctx.fillStyle = COL; ctx.textAlign = 'left';
      ctx.fillText(lang2 === 'cs' ? 'NAHRÁVAČ — POHYB' : 'PASSER — MOVEMENT', PX + PAD, PY + 19);
      ctx.font = '400 10px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(lang2 === 'cs' ? 'nastavení driftu' : 'drift settings', PX + PAD, PY + 33);
      const pcCloseBtnX = PX + PW - 24, pcCloseBtnY = PY + 22;
      ctx.font = 'bold 16px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'center'; ctx.fillText('×', pcCloseBtnX, pcCloseBtnY + 6);
      this._passerConfigCloseBtn = { x: pcCloseBtnX - 14, y: pcCloseBtnY - 10, w: 28, h: 28 };

      const panelBtns = [];
      let rowY = PY + HEADER_H + 4;

      // Section: Speed
      ctx.font = '600 9px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(61,216,112,0.55)'; ctx.textAlign = 'left';
      ctx.fillText(lang2 === 'cs' ? 'RYCHLOST' : 'SPEED', PX + PAD, rowY + 14);
      rowY += SEC_H;

      const spdOffX = PX + PAD + Math.round((INNER_ANG - INNER_SPD) / 2);
      SPEED_OPTS.forEach((opt, oi) => {
        const bx = spdOffX + oi * (BTN_W + GAP_B);
        const by = rowY;
        const isActive = (this.passer.driftSpeed ?? 1) === opt.val;
        _rrect(ctx, bx, by, BTN_W, BTN_H, 7);
        if (isActive) {
          ctx.fillStyle = 'rgba(61,216,112,0.22)'; ctx.fill();
          ctx.strokeStyle = COL; ctx.lineWidth = 2; _rrect(ctx, bx, by, BTN_W, BTN_H, 7); ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; _rrect(ctx, bx, by, BTN_W, BTN_H, 7); ctx.stroke();
        }
        ctx.font = `600 11px "Segoe UI",sans-serif`; ctx.textAlign = 'center';
        ctx.fillStyle = isActive ? COL : 'rgba(200,220,200,0.75)';
        ctx.fillText(opt.lbl, bx + BTN_W / 2, by + 26);
        ctx.font = '400 8px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(160,200,160,0.40)';
        ctx.fillText(opt.sub, bx + BTN_W / 2, by + 38);
        panelBtns.push({ key: 'speed', val: opt.val, x: bx, y: by, w: BTN_W, h: BTN_H });

      });
      rowY += BTN_H + 10;

      // Section: Angle
      ctx.font = '600 9px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(61,216,112,0.55)'; ctx.textAlign = 'left';
      ctx.fillText(lang2 === 'cs' ? 'SMĚR' : 'DIRECTION', PX + PAD, rowY + 14);
      rowY += SEC_H;

      const angOffX = PX + PAD;
      ANGLE_OPTS.forEach((opt, oi) => {
        const bx = angOffX + oi * (ANG_W + GAP_B);
        const by = rowY;
        const curAngle = this.passer.driftAngle ?? Math.PI / 2;
        const isActive = Math.abs(curAngle - opt.val) < 0.01;
        _rrect(ctx, bx, by, ANG_W, ANG_H, 7);
        if (isActive) {
          ctx.fillStyle = 'rgba(61,216,112,0.22)'; ctx.fill();
          ctx.strokeStyle = COL; ctx.lineWidth = 2; _rrect(ctx, bx, by, ANG_W, ANG_H, 7); ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; _rrect(ctx, bx, by, ANG_W, ANG_H, 7); ctx.stroke();
        }
        ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = isActive ? COL : 'rgba(200,220,200,0.6)';
        ctx.fillText(opt.icon, bx + ANG_W / 2, by + 20);
        ctx.font = '400 8px "Segoe UI",sans-serif'; ctx.fillStyle = isActive ? 'rgba(61,216,112,0.7)' : 'rgba(160,200,160,0.38)';
        ctx.fillText(opt.lbl, bx + ANG_W / 2, by + 33);
        panelBtns.push({ key: 'angle', val: opt.val, x: bx, y: by, w: ANG_W, h: ANG_H });
      });

      ctx.restore();
      this._passerConfigPanel = { x: PX, y: PY, w: PW, h: PH, btns: panelBtns };
    }

    // ── Drill description card — moved into panel drill buttons ──
    if (false && this._cam) {
      const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
      const ddesc = _SB_DRILL_DESC[this._drillIdx];
      if (ddesc) {
        const cx = 12, cy = H - 10;
        const cw = Math.min(290, W * 0.36);
        const ch = 58;
        ctx.save();
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = 'rgba(4,12,28,0.92)';
        _rrect(ctx, cx, cy - ch, cw, ch, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(60,140,220,0.35)'; ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px "Segoe UI",sans-serif';
        ctx.fillStyle = '#3a9fff';
        ctx.fillText(ddesc.title[lang], cx + 10, cy - ch + 16);
        ctx.font = '11px "Segoe UI",sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText(ddesc.desc[lang], cx + 10, cy - ch + 32);
        ctx.font = '10px "Segoe UI",sans-serif';
        ctx.fillStyle = 'rgba(140,200,255,0.6)';
        ctx.fillText(ddesc.hint[lang], cx + 10, cy - ch + 47);
        ctx.restore();
      }
    }

    // ── Nice goal flash ──
    if (this._niceGoalFlash > 0) {
      const prog = this._niceGoalFlash / 1.0;
      const ease = prog < 0.2 ? prog / 0.2 : (prog > 0.7 ? (1 - prog) / 0.3 : 1);
      ctx.save();
      const rg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      rg.addColorStop(0,   `rgba(255,220,60,${0.22 * ease})`);
      rg.addColorStop(0.5, `rgba(255,160,20,${0.10 * ease})`);
      rg.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // ── Top stats bar ──
    const mins  = Math.floor(this._sessionTime / 60);
    const secs  = Math.floor(this._sessionTime % 60);
    const timer = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    const goals = this.score.home;
    const shots = this.score.shots;
    const pct   = shots > 0 ? Math.round(goals / shots * 100) : 0;

    // Personal best — načti z localStorage, ulož při novém rekordu
    const _pbKey = 'fh_train_best_goals';
    let _pb = parseInt(localStorage.getItem(_pbKey) ?? '0', 10) || 0;
    if (goals > _pb) { _pb = goals; localStorage.setItem(_pbKey, String(_pb)); }
    const _isNewBest = goals > 0 && goals === _pb && shots > 0;

    // Pulse efekt při novém gólu (používá _goalFlashT nastavený v _handleGoal)
    const _gFlash = this._goalCounterFlash ?? 0;
    if (this._goalCounterFlash > 0) this._goalCounterFlash -= 1/60;

    const avgSecs = goals > 0 ? this._sessionTime / goals : 0;
    const avgStr  = goals > 0
      ? (avgSecs >= 60
        ? `${Math.floor(avgSecs/60)}:${String(Math.floor(avgSecs%60)).padStart(2,'0')}`
        : `${avgSecs.toFixed(1)}s`)
      : '—';
    const streak     = this._streak ?? 0;
    const bestStreak = this._bestStreak ?? 0;

    const cells = [
      { label: lang === 'cs' ? 'GÓLY'     : 'GOALS',    val: String(goals),  color: '#ffdf60', accent: true,  sub: null },
      { label: lang === 'cs' ? 'STŘELY'   : 'SHOTS',    val: String(shots),  color: '#c8d8f0', accent: false, sub: null },
      { label: lang === 'cs' ? 'PŘESNOST' : 'ACCURACY', val: shots > 0 ? `${pct}%` : '—', color: '#4de87a', accent: false, sub: null },
      { label: lang === 'cs' ? 'SÉRIE'    : 'STREAK',   val: String(streak), color: streak >= 3 ? '#ff9955' : '#c8d8f0', accent: false,
        sub: bestStreak > 1 ? `${lang === 'cs' ? 'MAX' : 'BEST'} ${bestStreak}` : null },
      { label: lang === 'cs' ? 'ČAS'      : 'TIME',     val: timer,          color: '#88bbdd', accent: false,
        sub: goals > 0 ? `ø ${avgStr}` : null },
    ];

    const cw = 76, ch = 52, gap = 1;
    const totalW = cells.length * cw + (cells.length - 1) * gap + 24;
    const bx = W / 2 - totalW / 2, by = 8;
    const radius = 8;

    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur   = 0;

    // Background panel
    ctx.fillStyle = 'rgba(4,8,18,0.80)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, totalW, ch, radius);
    else               ctx.rect(bx, by, totalW, ch);
    ctx.fill();

    // Top accent line (gradient)
    const grad = ctx.createLinearGradient(bx, by, bx + totalW, by);
    grad.addColorStop(0,   'rgba(60,140,255,0)');
    grad.addColorStop(0.35,'rgba(80,160,255,0.6)');
    grad.addColorStop(0.65,'rgba(80,160,255,0.6)');
    grad.addColorStop(1,   'rgba(60,140,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(bx + radius, by, totalW - radius * 2, 1.5);

    // Border
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, totalW, ch, radius);
    else               ctx.rect(bx, by, totalW, ch);
    ctx.strokeStyle = 'rgba(60,120,200,0.25)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Cells
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const cx2  = bx + 12 + i * (cw + gap) + cw / 2;

      // Divider
      if (i > 0) {
        ctx.fillStyle = 'rgba(60,100,160,0.25)';
        ctx.fillRect(bx + 12 + i * (cw + gap) - 1, by + 10, 1, ch - 20);
      }

      // Label
      ctx.font      = `600 9px "Segoe UI",sans-serif`;
      ctx.fillStyle = 'rgba(140,180,220,0.52)';
      ctx.fillText(cell.label, cx2, by + 15);

      // Value
      const isGoals = cell.accent;
      ctx.font      = `bold ${isGoals ? 21 : 17}px monospace`;
      ctx.fillStyle = cell.color;
      if (isGoals && _gFlash > 0) {
        ctx.save();
        ctx.shadowColor = 'rgba(255,210,40,0.85)';
        ctx.shadowBlur  = 10;
        ctx.globalAlpha = 0.7 + 0.3 * (_gFlash / 0.5);
        ctx.fillText(cell.val, cx2, by + 34);
        ctx.restore();
      } else {
        ctx.fillText(cell.val, cx2, by + 34);
      }

      // Personal best under goals
      if (isGoals && _pb > 0) {
        ctx.font      = `600 8px "Segoe UI",sans-serif`;
        ctx.fillStyle = _isNewBest ? 'rgba(255,210,50,0.85)' : 'rgba(120,160,200,0.36)';
        ctx.fillText(`${lang === 'cs' ? 'REKORD' : 'BEST'} ${_pb}`, cx2, by + ch - 8);
      }

      // Sub-label for other cells (streak best, avg time)
      if (!isGoals && cell.sub) {
        ctx.font      = `600 8px "Segoe UI",sans-serif`;
        ctx.fillStyle = 'rgba(140,180,220,0.45)';
        ctx.fillText(cell.sub, cx2, by + ch - 8);
      }
    }

    ctx.restore();

    // ── Pre-pass incoming indicator ──
    if (this._prePassT > 0.05) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 150);
      const alpha = Math.min(1, this._prePassT / 0.35) * (0.55 + pulse * 0.45);
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px "Segoe UI",sans-serif';
      ctx.fillStyle = `rgba(110,200,255,${alpha})`;
      const _passLang = document.documentElement.lang === 'en' ? 'en' : 'cs';
      ctx.fillText(_passLang === 'cs' ? `● PŘIHRÁVKA ZA ${Math.max(0, this._prePassT).toFixed(1)}s` : `● PASS IN ${Math.max(0, this._prePassT).toFixed(1)}s`, W * 0.77, H / 2);
    }

    // ── Goal zone feedback ──
    if (this._goalZone && this._goalZone.t > 0) {
      const fade = Math.min(1, this._goalZone.t / 0.6);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px "Segoe UI",sans-serif';
      ctx.fillStyle = '#ffdf60';
      const _zoneLang = document.documentElement.lang === 'en' ? 'en' : 'cs';
      ctx.fillText(`${_zoneLang === 'cs' ? 'GOL' : 'GOAL'}! ${this._goalZone.text}`, W * 0.72, H / 2 - 28);
      ctx.restore();
    }

    // ── Training dock (hidden in tutorial) ──
    if (!this._isTutorial) this._drawPanel(ctx, W, H);

    // ── Catalog overlay ──
    if (this._catalogOpen && !this._isTutorial) this._drawCatalogOverlay(ctx, W, H);

    // ── Tab-switch toast ──
    if (this._tabToast > 0) {
      const { DH } = this._dockLayout(W, H);
      const a = Math.min(1, this._tabToast * 2);
      ctx.save();
      ctx.globalAlpha = a;
      let txt, col;
      if (this._toastMsg === 'reset') {
        txt = lang === 'cs' ? '↺  NAČTENO' : '↺  RESET LOADED';
        col = '#80E890';
      } else {
        const isBuild = this._activeTab === 'build';
        txt = isBuild ? '⚙  BUILD MODE' : (lang === 'cs' ? '🏒  TRÉNINK' : '🏒  TRAINING');
        col = isBuild ? '#F5C840' : '#7FC4FF';
      }
      ctx.font = 'bold 17px "Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(txt).width + 32;
      ctx.fillRect(W/2 - tw/2, H - DH - 58, tw, 32);
      ctx.fillStyle = col;
      ctx.fillText(txt, W/2, H - DH - 36);
      ctx.restore();
    }
    if (this._tabToast <= 0) this._toastMsg = null;

    ctx.restore();
  }

  _tickMenuInput(cam) {
    const W = this.canvas.width, H = this.canvas.height;
    const mx = this.input.mouseX, my = this.input.mouseY;
    const { DH, OVH, PAD, GAP, SEP, BY, BH,
            DR_BW, DR_X0, DIFF_BW, DIFF_X0,
            BLD_W, BLD_X, SAVE_W, SAVE_X, PKS_W, PKS_X,
            OBJ_BW, OBJ_X0, SCEN_X, SCEN_W, RST_W } = this._dockLayout(W, H);
    const pY = H - DH;
    const ovY = pY - OVH;
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';

    if (!this.input.lmbJustPressed) return false;

    // ── Catalog overlay click handling (above dock) ──
    if (this._catalogOpen && this._catalogPanel) {
      const { PX, PY, PW, PH } = this._catalogPanel;
      // Close button
      const cb = this._catalogCloseBtn;
      if (cb && mx >= cb.x && mx <= cb.x + cb.w && my >= cb.y && my <= cb.y + cb.h) {
        this._catalogOpen = false; return true;
      }
      // New scenario button
      const nb = this._catalogNewBtn;
      if (nb && mx >= nb.x && mx <= nb.x + nb.w && my >= nb.y && my <= nb.y + nb.h) {
        this._showInputDialog({
          title: lang === 'cs' ? 'Název tréninku:' : 'Training pack name:',
          defaultValue: lang === 'cs' ? 'Můj trénink' : 'My training',
          onConfirm: v => { if (v.trim()) this._saveToLibrary(v.trim()); },
        });
        return true;
      }
      // Import button
      const ib = this._catalogImportBtn;
      if (ib && mx >= ib.x && mx <= ib.x + ib.w && my >= ib.y && my <= ib.y + ib.h) {
        this._catalogOpen = false;
        this._showInputDialog({
          title: lang === 'cs' ? 'Vlož kód scénáře:' : 'Paste scenario code:',
          placeholder: 'FH1-...',
          onConfirm: v => { if (v.trim()) this._loadScenarioCode(v.trim()); },
        });
        return true;
      }
      // Row buttons
      for (let i = 0; i < (this._catalogRows?.length ?? 0); i++) {
        const row = this._catalogRows[i]; if (!row) continue;
        const { btnY, btnH } = row;
        // LOAD button
        if (mx >= row.loadX && mx <= row.loadX + row.loadW && my >= btnY && my <= btnY + btnH) {
          this._loadScenarioCode(row.scen.code);
          this._catalogOpen = false; return true;
        }
        // COPY CODE button
        if (mx >= row.copyX && mx <= row.copyX + row.copyW && my >= btnY && my <= btnY + btnH) {
          const code = row.scen.code;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(code).catch(() => {
              this._showInputDialog({ title: lang === 'cs' ? 'Kód tréninku (zkopíruj)' : 'Training code (copy)', defaultValue: code, readonly: true });
            });
          } else {
            this._showInputDialog({ title: lang === 'cs' ? 'Kód tréninku (zkopíruj)' : 'Training code (copy)', defaultValue: code, readonly: true });
          }
          return true;
        }
        // DELETE button
        if (mx >= row.delX && mx <= row.delX + row.delW && my >= btnY && my <= btnY + btnH) {
          const id = row.scen.id, name = row.scen.name;
          this._showConfirmDialog({
            title: lang === 'cs' ? `Smazat „${name}"?` : `Delete "${name}"?`,
            onConfirm: () => this._deleteFromLibrary(id),
          });
          return true;
        }
        // RENAME (click on name area)
        if (mx >= row.nameX && mx <= row.nameX + row.nameW && my >= row.rowY && my <= row.rowY + row.rowH) {
          const id = row.scen.id, cur = row.scen.name || '';
          this._showInputDialog({
            title: lang === 'cs' ? 'Přejmenovat:' : 'Rename:',
            defaultValue: cur,
            onConfirm: v => { if (v.trim()) this._renameInLibrary(id, v.trim()); },
          });
          return true;
        }
      }
      // Click outside panel closes it
      if (mx < PX || mx > PX + PW || my < PY || my > PY + PH) { this._catalogOpen = false; }
      return true; // consume all clicks when catalog open
    }

    // ── Defender config panel (on ice, above dock) — must be before my<pY guard ──
    if (this._defConfigOpen && this._defConfigPanel) {
      const p = this._defConfigPanel;
      const cb = this._defConfigCloseBtn;
      if (cb && mx >= cb.x && mx <= cb.x + cb.w && my >= cb.y && my <= cb.y + cb.h) {
        this._defConfigOpen = false; return true;
      }
      if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) {
        for (const btn of (p.btns || [])) {
          if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
            this._defConfig[btn.key] = btn.val;
            this._defender.config = { ...this._defConfig };
            return true;
          }
        }
        return true;
      }
      this._defConfigOpen = false;
    }

    // ── Passer config panel ──
    if (this._passerConfigOpen && this._passerConfigPanel) {
      const p  = this._passerConfigPanel;
      const cb = this._passerConfigCloseBtn;
      if (cb && mx >= cb.x && mx <= cb.x + cb.w && my >= cb.y && my <= cb.y + cb.h) {
        this._passerConfigOpen = false; return true;
      }
      if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) {
        for (const btn of (p.btns || [])) {
          if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
            if (btn.key === 'speed') this.passer.driftSpeed = btn.val;
            if (btn.key === 'angle') { this.passer.driftAngle = btn.val; this.passer._driftT = 0; }
            return true;
          }
        }
        return true;
      }
      this._passerConfigOpen = false;
    }

    // ── BUILD overlay click handling (above dock — must be checked before pY guard) ──
    if (this._activeTab === 'build' && my >= ovY && my < pY) {
      if (this._drillIdx === 0) {
        for (let i = 0; i < 5; i++) {
          const bx = OBJ_X0 + i * (OBJ_BW + GAP);
          const { LBL_Y, LBL_H, OVH } = this._dockLayout(W, H);
          const BY2 = LBL_Y + LBL_H + 4, BH2 = OVH - BY2 - 8;
          if (mx >= bx && mx <= bx + OBJ_BW && my >= ovY + BY2 && my <= ovY + BY2 + BH2) {
            if (i === 4) {
              this._trainingObjects = []; this.passer.active = false;
              this._defender.active = false; this._defConfigOpen = false;
              this._rotatingObj = null; this._dragObj = null;
              this._dragDidMove = false; this._hoverObj = null;
            } else if (i === 3) {
              this._pendingMenuDrag = 'defender';
              this._pendingMenuClickSX = mx; this._pendingMenuClickSY = my;
            } else {
              this._pendingMenuDrag = ['passer', 'cone', 'reboard'][i];
              this._pendingMenuClickSX = mx; this._pendingMenuClickSY = my;
            }
            return true;
          }
        }
      }
      // SCENARIO buttons in overlay
      const { LBL_Y, LBL_H, OVH } = this._dockLayout(W, H);
      const BY2 = LBL_Y + LBL_H + 4, BH2 = OVH - BY2 - 8;
      const SBW = Math.floor((SCEN_W - 2*GAP - RST_W) / 2);
      const s1x = SCEN_X, s2x = SCEN_X + SBW + GAP, s3x = SCEN_X + 2*(SBW+GAP);
      if (mx >= s1x && mx <= s1x + SBW && my >= ovY + BY2 && my <= ovY + BY2 + BH2) {
        this._showInputDialog({ title: lang === 'cs' ? 'Název tréninku:' : 'Training pack name:', defaultValue: lang === 'cs' ? 'Můj trénink' : 'My training', onConfirm: v => { if (v.trim()) this._saveToLibrary(v.trim()); } });
        return true;
      }
      if (mx >= s2x && mx <= s2x + SBW && my >= ovY + BY2 && my <= ovY + BY2 + BH2) {
        this._catalogList = this._loadCatalog(); this._catalogScroll = 0; this._catalogOpen = true;
        return true;
      }
      if (mx >= s3x && mx <= s3x + RST_W && my >= ovY + BY2 && my <= ovY + BY2 + BH2) {
        if (this._scenarioCode) { this._loadScenarioCode(this._scenarioCode); this._tabToast = 1.2; this._toastMsg = 'reset'; }
        return true;
      }
      return true; // consume clicks within overlay
    }

    if (my < pY) return false;

    // ── Dock: BUILD ⚙ toggle button ──
    if (mx >= BLD_X && mx <= BLD_X + BLD_W && my >= pY + BY && my <= pY + BY + BH) {
      if (this._activeTab === 'build') {
        this._activeTab = 'train';
        this._rotatingObj = null; this._pendingMenuDrag = null;
        this._hoverObj = null; this._dragObj = null; this._dragDidMove = false;
      } else {
        this._activeTab = 'build';
      }
      return true;
    }

    // ── Dock: SAVE button (always visible) ──
    if (mx >= SAVE_X && mx <= SAVE_X + SAVE_W && my >= pY + BY && my <= pY + BY + BH) {
      this._showInputDialog({ title: lang === 'cs' ? 'Název tréninku:' : 'Training pack name:', defaultValue: lang === 'cs' ? 'Můj trénink' : 'My training', onConfirm: v => { if (v.trim()) this._saveToLibrary(v.trim()); } });
      return true;
    }

    // ── Dock: PACKS button (always visible) ──
    if (mx >= PKS_X && mx <= PKS_X + PKS_W && my >= pY + BY && my <= pY + BY + BH) {
      this._catalogList = this._loadCatalog(); this._catalogScroll = 0; this._catalogOpen = true;
      return true;
    }

    // ── Dock: DRILL buttons (always visible) ──
    for (let i = 0; i < 3; i++) {
      const bx = DR_X0 + i * (DR_BW + GAP);
      if (mx >= bx && mx <= bx + DR_BW && my >= pY + BY && my <= pY + BY + BH) {
        this._setDrill(i); return true;
      }
    }

    // ── Dock: GOALIE DIFF + RESET buttons (always visible) ──
    for (let i = 0; i < 4; i++) {
      const bx = DIFF_X0 + i * (DIFF_BW + GAP);
      if (mx >= bx && mx <= bx + DIFF_BW && my >= pY + BY && my <= pY + BY + BH) {
        if (i < 3) { this._diffIdx = i; this._applyDifficulty(); }
        else { this._reset(); }
        return true;
      }
    }

    return false;
  }

  // ── Dock layout — train content always visible, BUILD as overlay ──
  _dockLayout(W, H) {
    const DH   = 96;
    const OVH  = 86;   // výška BUILD overlay panelu (nad dockem)
    const PAD  = 16;
    const GAP  = 12;
    const SEP  = 28;
    const LBL_Y = 9;
    const LBL_H = 13;
    const BY = LBL_Y + LBL_H + 5;
    const BH = DH - BY - 10;

    // Pravá strana: BUILD ⚙ | PACKS | SAVE (vždy viditelné)
    const RPADS  = 10;
    const BLD_W  = 46;
    const SAVE_W = 70;
    const PKS_W  = 70;
    const BLD_X  = W - PAD - BLD_W;
    const PKS_X  = BLD_X - RPADS - PKS_W;
    const SAVE_X = PKS_X - RPADS - SAVE_W;
    const SEP2_X = SAVE_X - SEP / 2;  // vizuální oddělovač vlevo od SAVE/PACKS/BUILD

    // Levá část: DRILL + DIFF (zabírá prostor od PAD po SEP2_X)
    const AVAIL = SEP2_X - PAD - SEP;
    const DR_BW  = Math.floor((AVAIL * 0.56 - 2*GAP) / 3);
    const DR_X0  = PAD;
    const DRILL_SPAN = 3*DR_BW + 2*GAP;
    const DIFF_X0 = DR_X0 + DRILL_SPAN + SEP;
    const DIFF_BW = Math.floor((AVAIL - DRILL_SPAN - SEP - 3*GAP) / 4);

    // BUILD overlay: 5 OBJ + SEP + scenario (layout uvnitř overlay panelu)
    const OBJ_BW  = Math.floor((W - 2*PAD - 4*GAP - SEP) * 0.44 / 5);
    const OBJ_X0  = PAD;
    const OBJ_SPAN = 5*OBJ_BW + 4*GAP;
    const SCEN_X  = OBJ_X0 + OBJ_SPAN + SEP;
    const SCEN_W  = W - SCEN_X - PAD;
    const RST_W   = 60;

    // Legacy: TAB_W=0 pro zpětnou kompatibilitu s kódem co ho destructuruje
    const TAB_W = 0;
    const CW    = W;

    return { DH, OVH, TAB_W, PAD, GAP, SEP, LBL_Y, LBL_H, BY, BH, CW,
             DR_BW, DR_X0, DIFF_BW, DIFF_X0,
             BLD_W, BLD_X, SAVE_W, SAVE_X, PKS_W, PKS_X, SEP2_X,
             OBJ_BW, OBJ_X0, OBJ_SPAN, SCEN_X, SCEN_W, RST_W };
  }

  // ── Canvas-safe input dialog (replaces window.prompt — works on iOS/mobile) ──
  _showInputDialog({ title, defaultValue = '', placeholder = '', readonly = false, onConfirm, onCancel } = {}) {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    let overlay = document.getElementById('fh-input-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'fh-input-overlay';
      document.body.appendChild(overlay);
    }
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:"Segoe UI",sans-serif;';
    const escTitle = (title || '').replace(/</g, '&lt;');
    const escDef   = (defaultValue || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const escPH    = (placeholder || '').replace(/"/g, '&quot;');
    overlay.innerHTML = `
      <div style="background:#0D1128;border:1px solid rgba(60,120,200,0.40);border-radius:10px;padding:24px 24px 20px;min-width:300px;max-width:min(480px,90vw);box-shadow:0 8px 32px rgba(0,0,0,0.7);">
        <div style="color:#fff;font-weight:700;font-size:14px;margin-bottom:12px;">${escTitle}</div>
        <input id="fh-dlg-input" type="text" value="${escDef}" placeholder="${escPH}" ${readonly ? 'readonly' : ''}
          style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.08);border:1px solid rgba(60,120,200,0.35);border-radius:6px;color:#fff;padding:10px 12px;font-size:${readonly ? '11' : '14'}px;outline:none;font-family:${readonly ? 'monospace' : '"Segoe UI",sans-serif'};word-break:break-all;">
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button id="fh-dlg-cancel" style="padding:8px 18px;border-radius:5px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:rgba(255,255,255,0.60);cursor:pointer;font-size:13px;">${lang === 'cs' ? 'Zrušit' : 'Cancel'}</button>
          ${!readonly ? `<button id="fh-dlg-ok" style="padding:8px 20px;border-radius:5px;border:none;background:#1A60D0;color:#fff;cursor:pointer;font-size:13px;font-weight:700;">OK</button>` : ''}
        </div>
      </div>`;
    const inp = document.getElementById('fh-dlg-input');
    inp.focus(); if (!readonly) inp.select(); else inp.setSelectionRange(0, 999999);
    const close = (ok) => {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
      if (ok) onConfirm?.(inp.value); else onCancel?.();
    };
    document.getElementById('fh-dlg-cancel')?.addEventListener('click', () => close(false));
    document.getElementById('fh-dlg-ok')?.addEventListener('click',     () => close(true));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !readonly) close(true); if (e.key === 'Escape') close(false); e.stopPropagation(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
  }

  _showConfirmDialog({ title, onConfirm } = {}) {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    let overlay = document.getElementById('fh-input-overlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'fh-input-overlay'; document.body.appendChild(overlay); }
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:"Segoe UI",sans-serif;';
    const escTitle = (title || '').replace(/</g, '&lt;');
    overlay.innerHTML = `
      <div style="background:#0D1128;border:1px solid rgba(200,60,60,0.35);border-radius:10px;padding:24px;min-width:260px;max-width:min(380px,90vw);box-shadow:0 8px 32px rgba(0,0,0,0.7);">
        <div style="color:#fff;font-size:14px;margin-bottom:16px;">${escTitle}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="fh-dlg-cancel" style="padding:8px 18px;border-radius:5px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:rgba(255,255,255,0.60);cursor:pointer;font-size:13px;">${lang === 'cs' ? 'Zrušit' : 'Cancel'}</button>
          <button id="fh-dlg-ok" style="padding:8px 18px;border-radius:5px;border:none;background:rgba(200,40,40,0.85);color:#fff;cursor:pointer;font-size:13px;font-weight:700;">${lang === 'cs' ? 'Smazat' : 'Delete'}</button>
        </div>
      </div>`;
    const close = (ok) => { overlay.style.display = 'none'; overlay.innerHTML = ''; if (ok) onConfirm?.(); };
    document.getElementById('fh-dlg-cancel')?.addEventListener('click', () => close(false));
    document.getElementById('fh-dlg-ok')?.addEventListener('click',     () => close(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(false); });
  }

  // ── Scenario serialization ──
  _generateScenarioCode() {
    const s = {
      d: this._drillIdx, g: this._diffIdx,
      o: this._trainingObjects.map(o => [o.type[0], Math.round(o.x), Math.round(o.y), +((o.angle||0).toFixed(2))]),
      p: this.passer.active ? [Math.round(this.passer.x), Math.round(this.passer.y), this.passer.driftSpeed ?? 1, +((this.passer.driftAngle ?? Math.PI / 2).toFixed(3))] : null,
      s: [Math.round(this.local.x), Math.round(this.local.y)],
      df: this._defender.active ? {
        x: Math.round(this._defender.homeX ?? this._defender.x),
        y: Math.round(this._defender.homeY ?? this._defender.y),
        cfg: { ...this._defConfig },
      } : null,
    };
    return 'FH1-' + btoa(JSON.stringify(s)).replace(/=+$/, '');
  }

  _loadScenarioCode(raw) {
    const code = (raw || '').trim();
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    if (!code.startsWith('FH1-')) { this._showInputDialog({ title: lang === 'cs' ? '⚠ Neplatný kód scénáře' : '⚠ Invalid scenario code', defaultValue: code, readonly: true }); return; }
    try {
      const s = JSON.parse(atob(code.slice(4)));
      this._drillIdx = s.d ?? 0; this._diffIdx = s.g ?? 0;
      this._applyDifficulty();
      this._trainingObjects = (s.o || []).map(([t, x, y, a]) => ({
        type: t === 'r' ? 'reboard' : 'cone', x, y, angle: a || 0,
      }));
      if (s.p) {
        this.passer.active = true;
        this.passer.x = s.p[0]; this.passer.y = s.p[1];
        this.passer._anchorX = s.p[0]; this.passer._anchorY = s.p[1];
        this.passer.driftSpeed = s.p[2] ?? 1;
        this.passer.driftAngle = s.p[3] ?? Math.PI / 2;
        this.passer._driftT = 0;
      } else { this.passer.active = false; }
      if (s.s) { this.local.x = s.s[0]; this.local.y = s.s[1]; }
      if (s.df) {
        this._defConfig = { preset: s.df.cfg?.preset ?? s.df.cfg?.style ?? 'balanced' };
        this._defender.active = true;
        this._defender.homeX = s.df.x; this._defender.homeY = s.df.y;
        this._defender.reset(s.df.x, s.df.y);
        this._defender.config = { ...this._defConfig };
      } else {
        this._defender.active = false;
      }
      this._scenarioCode = code;
    } catch { this._showInputDialog({ title: lang === 'cs' ? '⚠ Neplatný kód' : '⚠ Invalid code', defaultValue: code, readonly: true }); }
  }

  // ── Scenario catalog (localStorage) ──
  _loadCatalog() {
    try { return JSON.parse(localStorage.getItem('fh_scenarios') || '[]'); } catch { return []; }
  }
  _saveCatalog(list) {
    try { localStorage.setItem('fh_scenarios', JSON.stringify(list.slice(0, 30))); } catch {}
  }
  _saveToLibrary(name) {
    const code = this._generateScenarioCode();
    const list = this._loadCatalog();
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    list.unshift({ id: Date.now(), name: name || (lang === 'cs' ? 'Bez názvu' : 'Untitled'), code, created: Date.now() });
    this._saveCatalog(list);
    this._catalogList = list;
  }
  _deleteFromLibrary(id) {
    const list = this._loadCatalog().filter(s => s.id !== id);
    this._saveCatalog(list);
    this._catalogList = list;
  }
  _renameInLibrary(id, newName) {
    const list = this._loadCatalog().map(s => s.id === id ? { ...s, name: newName } : s);
    this._saveCatalog(list);
    this._catalogList = list;
  }

  _drawCatalogOverlay(ctx, W, H) {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    const { DH } = this._dockLayout(W, H);
    const pY = H - DH;
    const list = this._catalogList || (this._catalogList = this._loadCatalog());

    // Local constants — no dependency on _dockLayout's GAP
    const CGAP = 8;
    const ROW_H = 50, HEADER_H = 52, FOOTER_H = 52, MAX_ROWS = 5;
    // Per row: [NAČÍST 76px] [KOPÍROVAT 76px] [SMAZAT 36px] = 196 + 2*CGAP = 212 + right margin 16
    const BTN_LOAD_W = 76, BTN_COPY_W = 76, BTN_DEL_W = 36, BTN_H = 28;
    const BTNS_TOTAL = BTN_LOAD_W + CGAP + BTN_COPY_W + CGAP + BTN_DEL_W + 16;
    const PW = Math.min(640, W - 48);
    const visRows = Math.max(1, Math.min(list.length, MAX_ROWS));
    const PH = HEADER_H + visRows * ROW_H + FOOTER_H;
    const PX = Math.round((W - PW) / 2);
    const PY = pY - PH - 14;

    this._catalogPanel = { PX, PY, PW, PH };
    this._catalogRows = [];

    const rr = (x, y, w, h, r) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    };

    ctx.save();

    // Dim backdrop
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, W, pY);

    // Panel bg
    ctx.fillStyle = '#0D1128';
    rr(PX, PY, PW, PH, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(182,196,255,0.28)'; ctx.lineWidth = 1.5;
    rr(PX, PY, PW, PH, 10); ctx.stroke();

    // Header
    ctx.fillStyle = '#141830';
    rr(PX, PY, PW, HEADER_H, [10, 10, 0, 0]); ctx.fill();
    ctx.fillStyle = '#1A60D0'; ctx.fillRect(PX, PY + HEADER_H - 1, PW, 1);

    const cnt = list.length;
    ctx.font = '400 11px "Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(182,196,255,0.55)'; ctx.textAlign = 'left';
    ctx.fillText(cnt > 0 ? `${cnt} ${lang === 'cs' ? 'uložených' : 'saved'}` : (lang === 'cs' ? 'Žádné tréninky' : 'Empty'), PX + 20, PY + 16);
    ctx.font = 'bold 14px "Segoe UI",sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(lang === 'cs' ? '🏒  MOJE TRÉNINKY' : '🏒  MY TRAINING PACKS', PX + 20, PY + 34);

    // Close × button
    const cbx = PX + PW - 28, cby = PY + 26;
    ctx.font = 'bold 18px "Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.textAlign = 'center';
    ctx.fillText('×', cbx, cby + 6);
    this._catalogCloseBtn = { x: cbx - 14, y: cby - 10, w: 28, h: 28 };

    // Column headers
    const nameColW = PW - BTNS_TOTAL - 20;
    const btn1X = PX + 20 + nameColW + CGAP;
    ctx.font = '400 9px "Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(182,196,255,0.35)'; ctx.textAlign = 'center';
    ctx.fillText(lang === 'cs' ? 'NAČÍST' : 'LOAD', btn1X + BTN_LOAD_W/2, PY + HEADER_H - 10);
    ctx.fillText(lang === 'cs' ? 'KOPÍROVAT KÓD' : 'COPY CODE', btn1X + BTN_LOAD_W + CGAP + BTN_COPY_W/2, PY + HEADER_H - 10);

    // Empty state
    if (list.length === 0) {
      ctx.font = '400 13px "Segoe UI",sans-serif';
      ctx.fillStyle = 'rgba(182,196,255,0.30)'; ctx.textAlign = 'center';
      ctx.fillText(lang === 'cs' ? 'Ulož svůj první trénink tlačítkem níže' : 'Save your first training pack below',
        PX + PW/2, PY + HEADER_H + ROW_H/2 + 6);
    }

    // Rows
    const startIdx = this._catalogScroll || 0;
    for (let i = startIdx; i < Math.min(startIdx + MAX_ROWS, list.length); i++) {
      const scen = list[i];
      const ri = i - startIdx;
      const rowY = PY + HEADER_H + ri * ROW_H;

      if (ri > 0) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(PX, rowY, PW, 1); }

      // Name + date (clickable = rename)
      const d = new Date(scen.created || 0);
      const dateStr = `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`;
      ctx.font = '600 13px "Segoe UI",sans-serif';
      ctx.fillStyle = '#EEF2FF'; ctx.textAlign = 'left';
      const maxNameW = nameColW;
      let dispName = scen.name || (lang === 'cs' ? 'Bez názvu' : 'Untitled');
      while (ctx.measureText(dispName).width > maxNameW - 8 && dispName.length > 3) dispName = dispName.slice(0, -1);
      if (dispName.length < (scen.name||'').length) dispName = dispName.slice(0, -1) + '…';
      ctx.fillText(dispName, PX + 20, rowY + ROW_H/2 - 3);
      ctx.font = '400 10px "Segoe UI",sans-serif';
      ctx.fillStyle = 'rgba(182,196,255,0.40)';
      ctx.fillText(lang === 'cs' ? `${dateStr} · klik = přejmenovat` : `${dateStr} · click = rename`, PX + 20, rowY + ROW_H/2 + 13);

      const btnY = rowY + (ROW_H - BTN_H) / 2;

      // NAČÍST button
      const loadX = PX + 20 + nameColW + CGAP;
      const gLoad = ctx.createLinearGradient(loadX, btnY, loadX + BTN_LOAD_W, btnY);
      gLoad.addColorStop(0, '#1A60D0'); gLoad.addColorStop(1, '#2A8FFF');
      ctx.fillStyle = gLoad;
      rr(loadX, btnY, BTN_LOAD_W, BTN_H, 4); ctx.fill();
      ctx.font = '700 11px "Segoe UI",sans-serif';
      ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
      ctx.fillText(lang === 'cs' ? 'NAČÍST' : 'LOAD', loadX + BTN_LOAD_W/2, btnY + 18);

      // KOPÍROVAT KÓD button
      const copyX = loadX + BTN_LOAD_W + CGAP;
      ctx.fillStyle = 'rgba(100,180,100,0.10)';
      rr(copyX, btnY, BTN_COPY_W, BTN_H, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(100,200,100,0.30)'; ctx.lineWidth = 1;
      rr(copyX, btnY, BTN_COPY_W, BTN_H, 4); ctx.stroke();
      ctx.font = '700 11px "Segoe UI",sans-serif';
      ctx.fillStyle = '#80E890'; ctx.textAlign = 'center';
      ctx.fillText('📋 KÓD', copyX + BTN_COPY_W/2, btnY + 18);

      // SMAZAT button
      const delX = copyX + BTN_COPY_W + CGAP;
      ctx.fillStyle = 'rgba(180,40,40,0.12)';
      rr(delX, btnY, BTN_DEL_W, BTN_H, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(220,60,60,0.25)'; ctx.lineWidth = 1;
      rr(delX, btnY, BTN_DEL_W, BTN_H, 4); ctx.stroke();
      ctx.font = '700 12px "Segoe UI",sans-serif';
      ctx.fillStyle = 'rgba(255,130,130,0.85)'; ctx.textAlign = 'center';
      ctx.fillText('✕', delX + BTN_DEL_W/2, btnY + 18);

      this._catalogRows[ri] = {
        scen, rowY, rowH: ROW_H,
        loadX, btnY, loadW: BTN_LOAD_W,
        copyX, copyW: BTN_COPY_W,
        delX, delW: BTN_DEL_W, btnH: BTN_H,
        nameX: PX + 20, nameW: maxNameW, nameY: rowY,
      };
    }

    // Scroll indicator
    if (list.length > MAX_ROWS) {
      const sf = startIdx / Math.max(1, list.length - MAX_ROWS);
      const tH = MAX_ROWS * ROW_H - 8, tX = PX + PW - 5, tY = PY + HEADER_H + 4;
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(tX, tY, 3, tH);
      const thH = Math.max(20, tH * MAX_ROWS / list.length);
      ctx.fillStyle = 'rgba(182,196,255,0.35)'; ctx.fillRect(tX, tY + sf * (tH - thH), 3, thH);
    }

    // Footer
    const footY = PY + PH - FOOTER_H;
    ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(PX, footY, PW, FOOTER_H);
    ctx.fillStyle = 'rgba(182,196,255,0.07)'; ctx.fillRect(PX, footY, PW, 1);

    // + ULOŽIT AKTUÁLNÍ
    const fBH = 30, fBW = 172;
    const nbx = PX + 16, nby = footY + (FOOTER_H - fBH) / 2;
    ctx.fillStyle = 'rgba(42,143,255,0.12)';
    rr(nbx, nby, fBW, fBH, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(42,143,255,0.38)'; ctx.lineWidth = 1;
    rr(nbx, nby, fBW, fBH, 5); ctx.stroke();
    ctx.font = '700 12px "Segoe UI",sans-serif';
    ctx.fillStyle = '#7FC4FF'; ctx.textAlign = 'center';
    ctx.fillText(lang === 'cs' ? '+ ULOŽIT AKTUÁLNÍ' : '+ SAVE CURRENT', nbx + fBW/2, nby + 20);
    this._catalogNewBtn = { x: nbx, y: nby, w: fBW, h: fBH };

    // ⬆ IMPORT KÓDEM
    const ibw = 148, ibx = PX + PW - 16 - ibw, iby = footY + (FOOTER_H - fBH) / 2;
    ctx.fillStyle = 'rgba(245,200,80,0.08)';
    rr(ibx, iby, ibw, fBH, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(245,200,80,0.28)'; ctx.lineWidth = 1;
    rr(ibx, iby, ibw, fBH, 5); ctx.stroke();
    ctx.font = '700 12px "Segoe UI",sans-serif';
    ctx.fillStyle = '#F5C840'; ctx.textAlign = 'center';
    ctx.fillText(lang === 'cs' ? '⬆  IMPORT KÓDEM' : '⬆  IMPORT CODE', ibx + ibw/2, iby + 20);
    this._catalogImportBtn = { x: ibx, y: iby, w: ibw, h: fBH };

    ctx.restore();
  }

  _drawPanel(ctx, W, H) {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    const { DH, OVH, PAD, GAP, SEP, LBL_Y, LBL_H, BY, BH,
            DR_BW, DR_X0, DIFF_BW, DIFF_X0,
            BLD_W, BLD_X, SAVE_W, SAVE_X, PKS_W, PKS_X, SEP2_X } = this._dockLayout(W, H);
    const pY = H - DH;
    const buildOpen = this._activeTab === 'build';

    // ── Dock background ──
    ctx.fillStyle = '#0A0C1A'; ctx.fillRect(0, pY, W, DH);
    ctx.fillStyle = '#b6c4ff'; ctx.fillRect(0, pY, W, 2);

    ctx.save();
    const CUT = 8;
    const _btnPath = (bx, by, bw, bh) => {
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + bw - CUT, by);
      ctx.lineTo(bx + bw, by + CUT); ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx, by + bh); ctx.closePath();
    };
    const _btnGrad = (bx, by, bw, bh, c0, c1) => {
      const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      g.addColorStop(0, c0); g.addColorStop(1, c1); return g;
    };
    const _sectionLabel = (text, x, y) => {
      ctx.font = '700 10px "Segoe UI",sans-serif';
      ctx.fillStyle = 'rgba(182,196,255,0.65)';
      ctx.textAlign = 'left';
      ctx.letterSpacing = '0.06em';
      ctx.fillText(text, x, y);
      ctx.letterSpacing = '';
    };

    // ═══════════════════════════════════════════════════
    // ── DRILL — vždy viditelné, dominantní ──
    // ═══════════════════════════════════════════════════
    _sectionLabel(lang === 'cs' ? 'DRILL — co hraješ' : 'DRILL — mode', DR_X0, pY + LBL_Y + LBL_H - 2);
    const drGrads   = [['#1A60D0','#2A8FFF'], ['#0C8044','#14B05A'], ['#5530A0','#8A58E0']];
    const drAccents = ['rgba(42,143,255,0.7)','rgba(20,176,90,0.7)','rgba(138,88,224,0.7)'];
    for (let i = 0; i < 3; i++) {
      const active = i === this._drillIdx;
      const bx = DR_X0 + i * (DR_BW + GAP), by = pY + BY;
      _btnPath(bx, by, DR_BW, BH);
      if (active) {
        ctx.fillStyle = _btnGrad(bx, by, DR_BW, BH, drGrads[i][0], drGrads[i][1]); ctx.fill();
        ctx.shadowColor = drGrads[i][1]; ctx.shadowBlur = 18;
        _btnPath(bx, by, DR_BW, BH); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = drGrads[i][1]; ctx.fillRect(bx, by, 4, BH);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
        ctx.fillStyle = drAccents[i]; ctx.fillRect(bx, by, 3, BH);
        _btnPath(bx, by, DR_BW, BH);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
      }
      const dDesc = _SB_DRILL_DESC[i];
      ctx.textAlign = 'left';
      ctx.font = active ? '700 16px "Segoe UI",sans-serif' : '500 13px "Segoe UI",sans-serif';
      ctx.fillStyle = active ? '#FFFFFF' : 'rgba(238,244,255,0.70)';
      ctx.fillText(dDesc.title[lang].toUpperCase(), bx + 12, by + (active ? 24 : 22));
      ctx.font = active ? '400 11px "Segoe UI",sans-serif' : '400 10px "Segoe UI",sans-serif';
      ctx.fillStyle = active ? 'rgba(238,244,255,0.85)' : 'rgba(238,244,255,0.45)';
      ctx.save();
      ctx.beginPath(); ctx.rect(bx + 12, by + 24, DR_BW - 24, BH); ctx.clip();
      ctx.fillText(dDesc.desc[lang], bx + 12, by + (active ? 38 : 36));
      ctx.restore();
      if (active) {
        ctx.font = '400 10px "Segoe UI",sans-serif';
        ctx.fillStyle = 'rgba(182,196,255,0.70)';
        ctx.save();
        ctx.beginPath(); ctx.rect(bx + 12, by + 40, DR_BW - 24, BH); ctx.clip();
        ctx.fillText(dDesc.hint[lang], bx + 12, by + BH - 6);
        ctx.restore();
      }
      ctx.textAlign = 'right'; ctx.font = '700 10px "Segoe UI",sans-serif';
      ctx.fillStyle = active ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)';
      ctx.fillText(`[${i+1}]`, bx + DR_BW - 8, by + 14);
    }

    // Separator DRILL / DIFF
    const drSepX = DR_X0 + 3*DR_BW + 2*GAP + Math.floor(SEP / 2);
    ctx.fillStyle = 'rgba(182,196,255,0.14)'; ctx.fillRect(drSepX, pY + BY + 4, 1, BH - 8);

    // ═══════════════════════════════════════════════════
    // ── GÓLMAN — sekundární, vždy viditelné ──
    // ═══════════════════════════════════════════════════
    _sectionLabel(lang === 'cs' ? 'GÓLMAN' : 'GOALIE', DIFF_X0, pY + LBL_Y + LBL_H - 2);
    const diffCfg = [
      { c0:'#0C6634', c1:'#14B05A', acc:'rgba(20,176,90,0.6)',  lbl: lang==='cs'?'SNADNÝ':'EASY',   sub: lang==='cs'?'pomalejší':'slower' },
      { c0:'#7A5800', c1:'#C48F00', acc:'rgba(196,143,0,0.6)',  lbl: lang==='cs'?'STŘEDNÍ':'MEDIUM', sub: lang==='cs'?'normální':'normal' },
      { c0:'#8A1020', c1:'#C42030', acc:'rgba(196,32,48,0.6)',  lbl: lang==='cs'?'TĚŽKÝ':'HARD',    sub: lang==='cs'?'rychlý':'fast' },
      { c0:null,      c1:null,      acc:'rgba(192,48,48,0.5)',  lbl:'↺',                              sub:'RESET' },
    ];
    for (let i = 0; i < 4; i++) {
      const bx = DIFF_X0 + i * (DIFF_BW + GAP), by = pY + BY;
      const active = i < 3 && i === this._diffIdx;
      const cfg = diffCfg[i];
      const isReset = i === 3;
      _btnPath(bx, by, DIFF_BW, BH);
      if (active) {
        ctx.fillStyle = _btnGrad(bx, by, DIFF_BW, BH, cfg.c0, cfg.c1); ctx.fill();
      } else if (isReset) {
        ctx.fillStyle = 'rgba(180,30,50,0.10)'; ctx.fill();
        ctx.fillStyle = '#C04040'; ctx.fillRect(bx, by, 3, BH);
        _btnPath(bx, by, DIFF_BW, BH); ctx.strokeStyle = 'rgba(180,30,50,0.22)'; ctx.lineWidth = 1; ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
        ctx.fillStyle = cfg.acc; ctx.fillRect(bx, by, 3, BH);
        _btnPath(bx, by, DIFF_BW, BH); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.font = active ? '700 13px "Segoe UI",sans-serif' : (isReset ? '700 16px "Segoe UI",sans-serif' : '500 12px "Segoe UI",sans-serif');
      ctx.fillStyle = active ? '#FFFFFF' : (isReset ? 'rgba(255,140,140,0.90)' : 'rgba(238,244,255,0.70)');
      ctx.fillText(cfg.lbl, bx + DIFF_BW / 2, by + BH / 2 + (BH > 40 ? (isReset ? 2 : -3) : 4));
      if (BH > 40 && !isReset) {
        ctx.font = '400 9px "Segoe UI",sans-serif';
        ctx.fillStyle = active ? 'rgba(255,255,255,0.60)' : 'rgba(238,244,255,0.35)';
        ctx.fillText(cfg.sub, bx + DIFF_BW / 2, by + BH / 2 + 10);
      }
      if (BH > 40 && isReset) {
        ctx.font = '700 9px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(255,140,140,0.65)';
        ctx.fillText('RESET', bx + DIFF_BW / 2, by + BH / 2 + 14);
      }
    }

    // ── Oddělovač vpravo (před SAVE / PACKS / BUILD) ──
    ctx.fillStyle = 'rgba(42,143,255,0.14)'; ctx.fillRect(SEP2_X, pY + BY + 4, 1, BH - 8);

    // ═══════════════════════════════════════════════════
    // ── SAVE + PACKS — vždy viditelné vpravo ──
    // ═══════════════════════════════════════════════════
    const savedN = (this._catalogList ?? this._loadCatalog()).length;
    // SAVE (modrý)
    _btnPath(SAVE_X, pY + BY, SAVE_W, BH);
    ctx.fillStyle = _btnGrad(SAVE_X, pY+BY, SAVE_W, BH, '#1A60D0', '#2A8FFF'); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '700 12px "Segoe UI",sans-serif'; ctx.fillStyle = '#FFFFFF';
    ctx.fillText(lang === 'cs' ? 'ULOŽIT' : 'SAVE', SAVE_X + SAVE_W / 2, pY + BY + BH / 2 + (BH > 40 ? -3 : 4));
    if (BH > 40) { ctx.font = '400 9px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.60)'; ctx.fillText(lang === 'cs' ? 'scénář' : 'scenario', SAVE_X + SAVE_W / 2, pY + BY + BH / 2 + 11); }
    // PACKS (amber)
    _btnPath(PKS_X, pY + BY, PKS_W, BH);
    const catOpen = this._catalogOpen;
    ctx.fillStyle = catOpen ? 'rgba(245,200,80,0.18)' : 'rgba(245,200,80,0.06)'; ctx.fill();
    ctx.fillStyle = 'rgba(245,200,80,0.65)'; ctx.fillRect(PKS_X, pY+BY, 3, BH);
    _btnPath(PKS_X, pY+BY, PKS_W, BH); ctx.strokeStyle = catOpen ? 'rgba(245,200,80,0.40)' : 'rgba(245,200,80,0.15)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.font = '700 12px "Segoe UI",sans-serif'; ctx.fillStyle = '#F0E0A0';
    ctx.fillText(lang === 'cs' ? 'TRÉNINKY' : 'PACKS', PKS_X + PKS_W / 2, pY + BY + BH / 2 + (BH > 40 ? -3 : 4));
    if (BH > 40) { ctx.font = '400 9px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(245,200,80,0.50)'; ctx.fillText(savedN > 0 ? `${savedN} ${lang==='cs'?'uloženo':'saved'}` : (lang==='cs'?'prázdné':'empty'), PKS_X + PKS_W / 2, pY + BY + BH / 2 + 11); }

    // ── BUILD ⚙ toggle — far right ──
    _btnPath(BLD_X, pY + BY, BLD_W, BH);
    if (buildOpen) {
      ctx.fillStyle = 'rgba(196,143,0,0.20)'; ctx.fill();
      ctx.fillStyle = '#C48F00'; ctx.fillRect(BLD_X, pY + BY, 3, BH);
      _btnPath(BLD_X, pY + BY, BLD_W, BH); ctx.strokeStyle = 'rgba(196,143,0,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
      ctx.fillStyle = 'rgba(196,143,0,0.45)'; ctx.fillRect(BLD_X, pY + BY, 3, BH);
      _btnPath(BLD_X, pY + BY, BLD_W, BH); ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.font = '700 16px "Segoe UI",sans-serif';
    ctx.fillStyle = buildOpen ? '#F5C840' : 'rgba(245,200,80,0.55)';
    ctx.fillText('⚙', BLD_X + BLD_W / 2, pY + BY + BH / 2 + (BH > 40 ? -1 : 5));
    if (BH > 40) {
      ctx.font = '700 9px "Segoe UI",sans-serif';
      ctx.fillStyle = buildOpen ? 'rgba(245,200,80,0.85)' : 'rgba(245,200,80,0.40)';
      ctx.fillText('BUILD', BLD_X + BLD_W / 2, pY + BY + BH / 2 + 13);
    }

    // ── BUILD overlay panel (nad dockem) ──
    if (buildOpen) this._drawBuildOverlay(ctx, W, H, { _btnPath, _btnGrad, _sectionLabel, CUT });

    ctx.restore();
  }

  // ── BUILD overlay — floating panel nad dockem, zobrazí se po kliknutí ⚙ ──
  _drawBuildOverlay(ctx, W, H, helpers) {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'cs';
    const { DH, OVH, PAD, GAP, SEP, LBL_Y, LBL_H, OBJ_BW, OBJ_X0, SCEN_X, SCEN_W, RST_W } = this._dockLayout(W, H);
    const { _btnPath, _btnGrad, _sectionLabel } = helpers;
    const pY = H - DH;
    const ovY = pY - OVH;  // top of overlay

    // Overlay background + border
    ctx.fillStyle = '#110E00'; ctx.fillRect(0, ovY, W, OVH);
    ctx.fillStyle = 'rgba(196,143,0,0.06)'; ctx.fillRect(0, ovY, W, OVH);
    ctx.fillStyle = '#C48F00'; ctx.fillRect(0, ovY, W, 1.5);

    const BY2 = LBL_Y + LBL_H + 4;
    const BH2 = OVH - BY2 - 8;

    _sectionLabel(lang === 'cs' ? 'OBJEKTY NA LED' : 'ICE OBJECTS', OBJ_X0, ovY + LBL_Y + LBL_H - 2);
    _sectionLabel(lang === 'cs' ? 'SCÉNÁŘ' : 'SCENARIO', SCEN_X, ovY + LBL_Y + LBL_H - 2);

    const objLocked = this._drillIdx !== 0;
    const _passerOn = this.passer.active;
    const _defOnBld = this._defender.active && this._drillIdx === 0;
    const objCfg = [
      { acc:'rgba(42,143,255,0.6)',  lbl: lang==='cs'?'NAHRÁVAČ':'PASSER', sub: _passerOn ? (lang==='cs'?'↩ odebrat':'↩ remove') : (lang==='cs'?'+ přidat':'+ add') },
      { acc:'rgba(20,176,90,0.6)',   lbl: lang==='cs'?'KUŽEL':'CONE',     sub: lang==='cs'?'+ přidat':'+ add' },
      { acc:'rgba(232,120,0,0.6)',   lbl: lang==='cs'?'PLOCHA':'BOARD',   sub: lang==='cs'?'+ přidat':'+ add' },
      { acc:'rgba(255,60,60,0.6)',   lbl: lang==='cs'?'BRÁNIČ':'DEFENDER', sub: _defOnBld ? (lang==='cs'?'↩ odebrat':'↩ remove') : (lang==='cs'?'+ přidat':'+ add') },
      { acc:'rgba(192,48,48,0.6)',   lbl: lang==='cs'?'VYČISTIT VŠE':'CLEAR ALL', sub: lang==='cs'?'smaže vše':'removes all' },
    ];
    for (let i = 0; i < 5; i++) {
      const bx = OBJ_X0 + i * (OBJ_BW + GAP), by = ovY + BY2;
      const isClear = i === 4, isPasserOn = i === 0 && _passerOn, isDefOn = i === 3 && _defOnBld;
      const locked = objLocked && !isClear;
      if (isClear) { ctx.fillStyle = 'rgba(200,50,50,0.30)'; ctx.fillRect(bx - GAP/2 - 1, by + 4, 1, BH2 - 8); }
      _btnPath(bx, by, OBJ_BW, BH2);
      if (locked) { ctx.fillStyle = 'rgba(255,255,255,0.02)'; ctx.fill(); }
      else if (isClear) { ctx.fillStyle = 'rgba(180,30,50,0.10)'; ctx.fill(); ctx.fillStyle = '#C04040'; ctx.fillRect(bx, by, 3, BH2); _btnPath(bx, by, OBJ_BW, BH2); ctx.strokeStyle = 'rgba(180,30,50,0.20)'; ctx.lineWidth = 1; ctx.stroke(); }
      else if (isPasserOn) { ctx.fillStyle = _btnGrad(bx, by, OBJ_BW, BH2, '#0C6634', '#14B05A'); ctx.fill(); }
      else if (isDefOn) { ctx.fillStyle = _btnGrad(bx, by, OBJ_BW, BH2, '#8B1010', '#CC3030'); ctx.fill(); }
      else { ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill(); ctx.fillStyle = objCfg[i].acc; ctx.fillRect(bx, by, 3, BH2); _btnPath(bx, by, OBJ_BW, BH2); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.textAlign = 'center';
      ctx.font = '600 12px "Segoe UI",sans-serif';
      ctx.fillStyle = locked ? 'rgba(245,200,80,0.25)' : (isClear ? 'rgba(255,140,140,0.95)' : ((isPasserOn || isDefOn) ? '#FFFFFF' : '#F0E0A0'));
      ctx.fillText(objCfg[i].lbl, bx + OBJ_BW/2, by + BH2/2 + (BH2 > 32 ? -2 : 4));
      if (BH2 > 32 && !locked) {
        ctx.font = '400 9px "Segoe UI",sans-serif';
        ctx.fillStyle = isClear ? 'rgba(255,140,140,0.55)' : ((isPasserOn || isDefOn) ? 'rgba(255,255,255,0.55)' : 'rgba(245,200,80,0.55)');
        ctx.fillText(objCfg[i].sub, bx + OBJ_BW/2, by + BH2/2 + 12);
      }
    }
    if (objLocked) {
      ctx.font = '400 9px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(182,196,255,0.45)';
      ctx.textAlign = 'center';
      ctx.fillText(lang === 'cs' ? 'dostupné jen ve volném tréninku' : 'available in free practice only', OBJ_X0 + (5*OBJ_BW+4*GAP)/2, ovY + BY2 + BH2 + 9);
    }

    // Separator OBJ / SCENARIO
    const objSepX = OBJ_X0 + 5*OBJ_BW + 4*GAP + Math.floor(SEP / 2);
    ctx.fillStyle = 'rgba(245,200,80,0.20)'; ctx.fillRect(objSepX, ovY + BY2 + 4, 1, BH2 - 8);

    // SCENARIO buttons in overlay
    const hasScen = !!this._scenarioCode;
    const savedN2 = (this._catalogList ?? this._loadCatalog()).length;
    const SBW  = Math.floor((SCEN_W - 2*GAP - RST_W) / 2);
    const s1x  = SCEN_X, s2x = SCEN_X + SBW + GAP, s3x = SCEN_X + 2*(SBW+GAP);
    // ULOŽIT
    _btnPath(s1x, ovY + BY2, SBW, BH2);
    ctx.fillStyle = _btnGrad(s1x, ovY+BY2, SBW, BH2, '#1A60D0', '#2A8FFF'); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '700 12px "Segoe UI",sans-serif'; ctx.fillStyle = '#FFFFFF';
    ctx.fillText(lang === 'cs' ? 'ULOŽIT' : 'SAVE', s1x + SBW/2, ovY + BY2 + BH2/2 + (BH2 > 32 ? -2 : 4));
    // TRÉNINKY
    _btnPath(s2x, ovY + BY2, SBW, BH2);
    const catA = this._catalogOpen;
    ctx.fillStyle = catA ? 'rgba(245,200,80,0.18)' : 'rgba(245,200,80,0.06)'; ctx.fill();
    ctx.fillStyle = 'rgba(245,200,80,0.65)'; ctx.fillRect(s2x, ovY+BY2, 3, BH2);
    _btnPath(s2x, ovY+BY2, SBW, BH2); ctx.strokeStyle = catA ? 'rgba(245,200,80,0.40)' : 'rgba(245,200,80,0.15)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.font = '700 12px "Segoe UI",sans-serif'; ctx.fillStyle = '#F0E0A0';
    ctx.fillText(lang === 'cs' ? 'TRÉNINKY' : 'PACKS', s2x + SBW/2, ovY + BY2 + BH2/2 + (BH2 > 32 ? -2 : 4));
    // ↺ RESET
    _btnPath(s3x, ovY + BY2, RST_W, BH2);
    ctx.fillStyle = hasScen ? 'rgba(100,220,120,0.12)' : 'rgba(255,255,255,0.03)'; ctx.fill();
    ctx.fillStyle = hasScen ? 'rgba(100,220,120,0.50)' : 'rgba(255,255,255,0.10)'; ctx.fillRect(s3x, ovY+BY2, 3, BH2);
    _btnPath(s3x, ovY+BY2, RST_W, BH2); ctx.strokeStyle = hasScen ? 'rgba(100,220,120,0.30)' : 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.font = '700 14px "Segoe UI",sans-serif';
    ctx.fillStyle = hasScen ? '#80E890' : 'rgba(255,255,255,0.20)';
    ctx.fillText('↺', s3x + RST_W/2, ovY + BY2 + BH2/2 + (BH2 > 32 ? -1 : 5));
    if (BH2 > 32) { ctx.font = '700 9px "Segoe UI",sans-serif'; ctx.fillStyle = hasScen ? 'rgba(128,232,144,0.75)' : 'rgba(255,255,255,0.15)'; ctx.fillText('RESET', s3x + RST_W/2, ovY + BY2 + BH2/2 + 12); }
  }

  _handleGoal(result) {
    if (result === 'goal-home') {
      this.score.home++;
      this._goalCounterFlash = 0.5;
      this._niceGoalFlash    = 1.0;
      this._streak = (this._streak ?? 0) + 1;
      if (this._streak > (this._bestStreak ?? 0)) this._bestStreak = this._streak;
      const _goalLang = document.documentElement.lang === 'en' ? 'en' : 'cs';
      const entryY = this.puck._goalEntryY ?? this.puck.y;
      const rel    = (entryY - RINK.goalY) / RINK.goalH;
      let zone;
      if      (rel < 0.33) zone = _goalLang === 'cs' ? '— HORNÍ ROH' : '— TOP CORNER';
      else if (rel > 0.67) zone = _goalLang === 'cs' ? '— DOLNÍ ROH' : '— BOTTOM CORNER';
      else                 zone = _goalLang === 'cs' ? '— PĚTKA'     : '— FIVE-HOLE';
      this._goalZone = { text: zone, t: 2.5 };

      // E2: po 3 gólech ze stejného místa posune passer na novou pozici
      if (this.passer.active && this._drillIdx === 0) {
        this._passerHintGoals = this._passerHintGoals ?? [];
        this._passerHintGoals.push(this.local.y);
        if (this._passerHintGoals.length >= 3) {
          const recent = this._passerHintGoals.slice(-3);
          const spread = Math.max(...recent) - Math.min(...recent);
          if (spread < 70) {
            const anchor = this.passer._anchorY ?? this.passer.y;
            const shift  = 50 + Math.random() * 25;
            const dir    = anchor < RINK.h / 2 ? 1 : -1;
            this.passer._anchorY = Math.max(22, Math.min(RINK.h - 22, anchor + dir * shift));
          }
          this._passerHintGoals = [];
        }
      }
    }

    if (this._drillIdx === 1) {
      setTimeout(() => { this._defender.active = false; this._reset(false); }, 1600);
      return;
    }

    if (this._drillIdx === 2) {
      this.puck.reset();
      this.puck.faceoffTimer = 0;
      setTimeout(() => {
        this._goalLock = false;
        this.world._goalLock = false;
        this._passerPosIdx = (this._passerPosIdx + 1) % _SB_OT_CONFIGS.length;
        const otCfg = _SB_OT_CONFIGS[this._passerPosIdx];
        this._schedulePasserFire(1000, otCfg.passer);
      }, 1100);
      return;
    }

    // Free: goalie passes back
    this._prePassT = 1.4;
    setTimeout(() => {
      this.puck.reset();
      this.puck.x  = RINK.goalLineRight - 35;
      this.puck.y  = RINK.goalY + RINK.goalH / 2 + (Math.random() - 0.5) * 30;
      this.puck.vx = -220 - Math.random() * 60;
      this.puck.vy = (Math.random() - 0.5) * 100;
      this.puck.z  = 0; this.puck.vz = 0;
      this.puck.faceoffTimer = 0;
      this._goalLock = false;
      this.world._goalLock = false;
      this._prePassT = 0;
    }, 1400);
  }

  _handleWhistle(ev) {
    SFX.stopWhistle();
    this._goalLock = false;
    this.world._goalLock = false;

    if (this._drillIdx === 1) {
      setTimeout(() => { this._defender.active = false; this._reset(false); }, 800);
      return;
    }

    if (this._drillIdx === 2) {
      this.puck.reset();
      this.puck.faceoffTimer = 0;
      this._prePassT = 0;
      this._passerPosIdx = (this._passerPosIdx + 1) % _SB_OT_CONFIGS.length;
      const otCfg = _SB_OT_CONFIGS[this._passerPosIdx];
      this._schedulePasserFire(1000, otCfg.passer);
      return;
    }

    // Free: goalie returns puck immediately
    this.puck.reset();
    this.puck.x  = RINK.goalLineRight - 35;
    this.puck.y  = RINK.goalY + RINK.goalH / 2;
    this.puck.vx = -200;
    this.puck.vy = 0;
    this.puck.z  = 0; this.puck.vz = 0;
    this.puck.faceoffTimer = 0;
  }

  _reset(clearStats = true) {
    const cx = RINK.centerX, cy = RINK.h / 2;
    const p = this.local;
    p.vx = p.vy = 0;
    p.hasPuck = false;
    p.charge = 0; p.overcharged = false;
    p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = 0;

    this.puck.reset();
    this.puck.vx = 0; this.puck.vy = 0;
    this.puck.z  = 0; this.puck.vz = 0;
    this.puck.faceoffTimer = 0;

    this.goalFlash    = 0;
    this._goalLock    = false;
    this.world._goalLock = false;
    this._prePassT    = 0;
    this._goalZone    = null;
    if (clearStats !== false) {
      this.score.home    = 0;
      this.score.shots   = 0;
      this.score.posts   = 0;
      this._sessionTime  = 0;
      this._streak       = 0;
      this._bestStreak   = 0;
      this._lastPokedAt  = 0;
    }
    if (this._drillIdx !== 0) {
      this._defender.active = false;
    }

    if (this._drillIdx === 0) {
      p.x = cx; p.y = cy;
      this.puck.x = cx + 18; this.puck.y = cy;
      this.passer.hasPuck = false;
      // Preserve BUILD defender: reset position to homeX/homeY but keep active
      if (this._defender.active) {
        this._defender.reset(this._defender.homeX ?? this._defender.x, this._defender.homeY ?? this._defender.y);
        this._defender.config = { ...this._defConfig };
      }

    } else if (this._drillIdx === 1) {
      p.x = RINK.centerX - 20; p.y = cy;
      p.vx = 100; p.vy = 0;
      p.bodyAngle = p.aimAngle = p.skateAngle = p.carryAngle = 0;
      p.hasPuck = true;
      this.puck.x = p.x + 18; this.puck.y = cy;
      this.puck.vx = 0; this.puck.vy = 0;
      this._defender.active = true;
      this._defender.reset(RINK.centerX - 90, cy + 20);
      this._defender.vx = 85; this._defender.vy = 0;

    } else if (this._drillIdx === 2) {
      this._passerPosIdx = 0;
      const otCfg = _SB_OT_CONFIGS[0];
      p.x = otCfg.player.x; p.y = otCfg.player.y;
      p.bodyAngle = p.aimAngle = p.skateAngle = p.carryAngle = Math.atan2(228 - otCfg.player.y, 990 - otCfg.player.x);
      this.passer.active = true;
      this._schedulePasserFire(900, otCfg.passer);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// TutorialGame — řízený onboarding (8 kroků → profil)
// ════════════════════════════════════════════════════════════════════════
const _TUT_ICON  = { move:'⛸️', brake:'🛑', aim:'🎯', spin:'🌀', pickup:'🏒', shoot:'💥', pass:'↗️', mmb:'📨', passer:'🤝', bodycheck:'💪', clona:'🛡️', tece:'↩️', goal:'🥅' };
const _TUT_COLOR = { move:'#3a9fff', brake:'#22ccee', aim:'#9b5cff', spin:'#ff8a66', pickup:'#ff8a1e', shoot:'#ff4455', pass:'#19c37d', mmb:'#3a9fff', passer:'#ffcf3a', bodycheck:'#ff4455', clona:'#22ccee', tece:'#a066ff', goal:'#ffcf3a' };
// ── Tutorial steps: 12 kroků (vše kromě přemisťování passera Tabem) ──
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
    title: { cs: 'Objížďka a spin', en: 'Spin move' },
    desc:  { cs: 'Drž puk a obkroužíš hůlí celý kruh', en: 'Carry the puck and sweep the stick in a full circle' },
    sub:   { cs: 'Rychlé krouživé gesto myší — nejlepší manévr pro obejití bránícího hráče', en: 'Fast circular mouse gesture — the best move to get past a defender' },
    keys:  ['LMB hold'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      // Give player puck at current position — no teleport
      g.local.hasPuck = true;
      g.puck.x = g.local.x; g.puck.y = g.local.y;
      g.puck.vx = g.puck.vy = 0; g.puck.faceoffTimer = 0;
      g.passer.active = false;
      g._tutSpinDelta = 0; g._tutSpinLastAngle = null;
    },
    check: g => (g._tutSpinDelta ?? 0) >= Math.PI * 1.5,
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
      // Place puck ahead of player's current position
      g.puck.x = g.local.x + 90; g.puck.y = g.local.y;
      g.puck.vx = g.puck.vy = 0; g.puck.z = g.puck.vz = 0; g.puck.faceoffTimer = 0;
      g.passer.active = false;
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
      g.passer.active = false;
      g._tutShot = false; g._tutShotHadPuck = g.local.hasPuck;
    },
    check: g => g._tutShot,
    hl:    g => ({ type: 'arrow', tx: RINK.goalLineRight, ty: RINK.h / 2 }),
  },
  {
    id: 'pass',
    title: { cs: 'Přihrávka nahrávači', en: 'Pass to teammate' },
    desc:  { cs: 'Namiř hokejku na nahrávače a vystřel (LMB)', en: 'Aim at the teammate and shoot (LMB)' },
    sub:   { cs: 'Krátká přihrávka = žabička k nahrávači · puk doletí ke spoluhráči a chytí ho', en: 'Short pass = tap toward teammate · puck flies to teammate and they catch it' },
    keys:  ['LMB'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      if (!g.local.hasPuck) {
        g.puck.reset(); g.puck.x = g.local.x + 15; g.puck.y = g.local.y;
        g.puck.vx = g.puck.vy = 0; g.puck.z = g.puck.vz = 0; g.puck.faceoffTimer = 0;
      }
      // Passer appears to player's left (toward center ice) — no teleport needed
      g.passer.active = true;
      g.passer.x = Math.max(80, g.local.x - 180);
      g.passer.y = g.local.y + 30;
      g.passer.vx = 0; g.passer.vy = 0;
      g.passer.hasPuck = false; g.passer._returnTimer = 0; g.passer._receiveCooldown = 0.3;
    },
    check: g => g.passer.hasPuck,
    hl:    g => ({ type: 'target', x: g.passer.x, y: g.passer.y }),
  },
  {
    id: 'mmb',
    title: { cs: 'Přihraj zpátky!', en: 'Call for the pass!' },
    desc:  { cs: 'Nahrávač má puk — stiskni střední tlačítko myši (kolečko)', en: 'Teammate has the puck — press middle mouse button (scroll wheel click)' },
    sub:   { cs: 'MMB = žádost o přihrávku · nahrávač pošle puk zpět ke mně', en: 'MMB = request pass · teammate sends puck back to you' },
    keys:  ['MMB'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      // Passer has puck, placed ahead of player (toward goal)
      g.passer.active = true;
      g.passer.x = Math.min(RINK.goalLineRight - 60, g.local.x + 160);
      g.passer.y = g.local.y;
      g.passer.hasPuck = true;
      g.passer._returnTimer = 0; g.passer._shouldReturn = false; g.passer._wantsToReturn = false;
      g.passer.vx = 0; g.passer.vy = 0;
      g.puck.faceoffTimer = 1;
    },
    check: g => g.local.hasPuck,
    hl:    g => ({ type: 'target', x: g.passer.x, y: g.passer.y }),
  },
  {
    id: 'bodycheck',
    title: { cs: 'Bodyček!', en: 'Body check!' },
    desc:  { cs: 'Najeď do nahrávače — sraz ho z místa', en: 'Skate into the player — knock them down' },
    sub:   { cs: 'Vyšší rychlost = silnější bodyček · bez puku = není čeho se bát', en: 'Faster skating = harder hit · they don\'t have the puck — safe to check' },
    keys:  [],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      g.puck.x = 30; g.puck.y = RINK.h - 30; g.puck.vx = g.puck.vy = 0; g.puck.faceoffTimer = 1;
      // Passer without puck, placed in player's current movement path
      g.passer.active = true;
      g.passer.hasPuck = false;
      g.passer.x = Math.min(RINK.goalLineRight - 40, g.local.x + 80);
      g.passer.y = g.local.y;
      g.passer.vx = 0; g.passer.vy = 0;
      g._tutBodycheckDone = false;
    },
    check: g => g._tutBodycheckDone,
    hl:    g => ({ type: 'target', x: g.passer.x, y: g.passer.y }),
  },
  {
    id: 'clona',
    title: { cs: 'Clona před brankářem', en: 'Screen the goalie' },
    desc:  { cs: 'Postav se do slotu — zablokuj výhled brankáři', en: 'Position yourself in the slot — block the goalie\'s view' },
    sub:   { cs: 'Slot = prostor přímo před brankou · odtud jsou střely nejnebezpečnější', en: 'Slot = area directly in front of goal · shots from here are hardest to stop' },
    keys:  [],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false; g.passer.active = false;
      // Teleport player to entry of slot area (right side)
      g.local.x = RINK.blueLineRight - 80; g.local.y = RINK.h / 2;
      g.local.vx = 0; g.local.vy = 0;
      g.puck.x = 30; g.puck.y = RINK.h - 30; g.puck.vx = g.puck.vy = 0; g.puck.faceoffTimer = 1;
      g._tutClonaTimer = 0;
    },
    check: g => g._tutClonaTimer >= 1.5,
    hl:    g => ({ type: 'zone', x: RINK.goalLineRight - 90, y: RINK.h / 2, r: 82 }),
  },
  {
    id: 'tece',
    title: { cs: 'Tečování (dorážka)', en: 'Deflection' },
    desc:  { cs: 'Stůj u tyče — nahrávač vystřelí, ty puk přesměruj', en: 'Stand by the post — teammate shoots, you deflect it' },
    sub:   { cs: 'Pohyb myší těsně před kontaktem s pukem změní jeho trajektorii · brankáři se pak těžko chytá', en: 'Moving mouse right before puck contact changes its angle · goalie can\'t react in time' },
    keys:  ['pohyb myší / mouse move'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false;
      // Player at right goal post
      g.local.x = RINK.goalLineRight - 22; g.local.y = RINK.h / 2 + 28;
      g.local.vx = 0; g.local.vy = 0;
      // Passer at right circle, has puck, will shoot automatically
      g.passer.active = true;
      g.passer.x = RINK.blueLineRight - 30; g.passer.y = RINK.h / 2 - 110;
      g.passer.hasPuck = true;
      g.passer.vx = 0; g.passer.vy = 0;
      g.passer._wantsToReturn = false;
      g.puck.faceoffTimer = 1;
      g._tutTeceTimer = 2.5;
      g._tutTeceShot = false;
      g._tutTeceDone = false;
      g._tutTeceFallback = 0;
    },
    check: g => g._tutTeceDone,
    hl:    g => g._tutTeceShot ? ({ type: 'arrow', tx: RINK.goalLineRight, ty: RINK.h / 2 }) : ({ type: 'target', x: g.passer.x, y: g.passer.y }),
  },
  {
    id: 'goal',
    title: { cs: 'Dej gól!', en: 'Score a goal!' },
    desc:  { cs: 'Vyber si roh brány, namiř hokejku a vystřel', en: 'Pick a corner, aim your stick, and shoot' },
    sub:   { cs: 'Puk se vrátí po každé zachycené střele', en: 'Puck respawns after every save' },
    keys:  ['LMB'],
    setup(g) {
      g._goalLock = false; g.world._goalLock = false; g.goalFlash = 0;
      g.local.hasPuck = false; g.passer.active = false;
      g.puck.reset(); g.puck.x = g.local.x + 15; g.puck.y = g.local.y;
      g.puck.vx = g.puck.vy = 0; g.puck.z = g.puck.vz = 0; g.puck.faceoffTimer = 0;
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
    // Per-step state
    this._tutBrakeTimer    = 0;
    this._tutAimTimer      = 0;
    this._tutAimLastAngle  = null;
    this._tutSpinDelta     = 0;
    this._tutSpinLastAngle = null;
    this._tutShot          = false;
    this._tutShotHadPuck   = false;
    this._tutBodycheckDone = false;
    this._tutClonaTimer    = 0;
    this._tutTeceTimer     = 0;
    this._tutTeceShot      = false;
    this._tutTeceDone      = false;
    this._tutTeceFallback  = 0;
  }

  start() {
    this._isTutorial = true;   // SandboxGame._drawOverlay checks this to skip the dock
    super.start();
    // Tutorial gets full-screen view — no dock offset needed
    this.engine.cameraOverride = null;
    _TUT[0].setup(this);

    const origTick = this.engine.onTick;
    this.engine.onTick = (dt, cam) => {
      this._tutCam = cam;
      this._preLmb = this.input.lmbJustPressed;
      origTick(dt, cam);
      this._tutTick(dt);
    };
    // Replace draw entirely: no dock, only tutorial panels
    this.engine.onDraw = (ctx, cam) => {
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

    // Krok 'spin': kruh myší 270°+ zatímco má hráč puk
    if (step.id === 'spin') {
      if (this.local.hasPuck) {
        const ang = this.local.aimAngle;
        if (this._tutSpinLastAngle !== null) {
          let d = ang - this._tutSpinLastAngle;
          while (d >  Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          this._tutSpinDelta = (this._tutSpinDelta ?? 0) + Math.abs(d);
        }
        this._tutSpinLastAngle = ang;
      }
    }

    // Krok 'shoot': detekuj střelu (měl puk → ztratil puk, passer nemá)
    if (step.id === 'shoot') {
      const nowHas = this.local.hasPuck;
      if (this._tutShotHadPuck && !nowHas && !this.passer.hasPuck) this._tutShot = true;
      this._tutShotHadPuck = nowHas;
    }

    // Krok 'bodycheck': detekuj knockback passera (byl sražen)
    if (step.id === 'bodycheck') {
      if (Math.hypot(this.passer.vx, this.passer.vy) > 50) this._tutBodycheckDone = true;
    }

    // Krok 'clona': hráč musí být v slotu 1.5s
    if (step.id === 'clona') {
      const inSlot = this.local.x > RINK.goalLineRight - 195 && this.local.x < RINK.goalLineRight - 10 &&
                     Math.abs(this.local.y - RINK.h / 2) < 85;
      if (inSlot) this._tutClonaTimer = (this._tutClonaTimer ?? 0) + dt;
      else this._tutClonaTimer = Math.max(0, (this._tutClonaTimer ?? 0) - dt * 2);
    }

    // Krok 'tece': passer vystřelí po 2.5s, hráč musí tečovat (nebo fallback 5s)
    if (step.id === 'tece') {
      if (!this._tutTeceShot) {
        this._tutTeceTimer = Math.max(0, this._tutTeceTimer - dt);
        if (this._tutTeceTimer === 0) {
          this.passer._wantsToReturn = true;
          this._tutTeceShot = true;
          this._tutTeceFallback = 0;
        }
      } else {
        if (this.local._deflectCool > 0.25 || this.goalFlash > 0) this._tutTeceDone = true;
        this._tutTeceFallback = (this._tutTeceFallback ?? 0) + dt;
        if (this._tutTeceFallback > 5) this._tutTeceDone = true;
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

    // Fade panel when player body or puck is hidden under it
    const _panelMargin = 28;
    const _underPanel = (sx, sy) =>
      sx > bx - _panelMargin && sx < bx + bw + _panelMargin &&
      sy > by - _panelMargin && sy < by + bh + _panelMargin;
    let fade = 1.0;
    if (cam) {
      const ps = toScreen(this.local.x, this.local.y, cam);
      if (_underPanel(ps.x, ps.y)) fade = 0.18;
      if (!step.hidePuck && fade > 0.18) {
        const pu = toScreen(this.puck.x, this.puck.y, cam);
        if (_underPanel(pu.x, pu.y)) fade = 0.18;
      }
      // Lerp toward target alpha for smooth transition
      this._panelFade = this._panelFade ?? 1.0;
      this._panelFade += (fade - this._panelFade) * 0.18;
      fade = this._panelFade;
    }

    ctx.save();
    ctx.globalAlpha = ea * fade;

    // Glow + box
    ctx.shadowColor = col; ctx.shadowBlur = 30 * fade;
    ctx.fillStyle = '#060b1c'; ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    _rrect(ctx, bx, by, bw, bh, 14); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // Header fill
    ctx.globalAlpha = ea * fade * (done ? 0.32 : 0.22);
    ctx.fillStyle = col;
    _rrect(ctx, bx, by, bw, HEADER_H, [14, 14, 0, 0]); ctx.fill();
    ctx.globalAlpha = ea * fade;

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
