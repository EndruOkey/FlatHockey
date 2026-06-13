import { RINK, PLAYER, PUCK } from './constants.js';
import { lerpAngle, clamp } from './utils.js';
import { t } from './i18n.js';
import { Input } from './input.js';
import { Engine, fromScreen } from './engine.js';
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
    this._eWas            = false;
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

    // E / MMB — žádost o nahrávku od passeru
    const eDown = !!this.input.keys['KeyE'];
    const reqPass = (eDown && !this._eWas) || this.input.mmbJustPressed;
    if (reqPass) {
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
    this._eWas = eDown;

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

    // Hráč narazí do passera (Tab) — solidní spoluhráč/překážka
    for (const p of players) {
      const dx = p.x - this.passer.x, dy = p.y - this.passer.y;
      const dist = Math.hypot(dx, dy);
      const minD = (p.radius ?? 7) + (this.passer.radius ?? 7);
      if (dist > 0 && dist < minD) {
        const nx = dx / dist, ny = dy / dist, pen = minD - dist;
        const KB = 85;
        const both = !this.passer.isDragging;
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
