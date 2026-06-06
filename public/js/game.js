import { RINK, PLAYER, PUCK } from './constants.js';
import { lerpAngle, clamp } from './utils.js';
import { Input } from './input.js';
import { Engine, fromScreen } from './engine.js';
import { World } from './world.js';
import { Player, RemotePlayer } from './entities/Player.js';
import { Puck } from './entities/Puck.js';
import { Goalie } from './entities/Goalie.js';
import { Passer } from './entities/Passer.js';
import { Rink } from './entities/Rink.js';

const CHARGE_RATE = 1.8; // rychlejší nabíjení — uvolní místo pro kličky
const SEND_HZ     = 60;

// Myš míří jen hokejku/střelu (turret). Tělo/facing řídí A/D bruslení (_move → bodyAngle).
// Rychlost natáčení škáluje s VZDÁLENOSTÍ kurzoru: daleko = svižné, blízko = pomalé.
// Tím se hokejka neroztočí, když hráč projede blízko/přes pozici kurzoru (helikoptéra).
function _updateAim(player, rawAim, dt) {
  const d = player.aimDist ?? 100;
  const rate = clamp(d / 35, 0.12, 1) * 28;
  player.aimAngle = lerpAngle(player.aimAngle, rawAim, Math.min(1, rate * dt));
}

// Predikce nahrávky do jízdy — míří na HOKEJKU (čepel) příjemce, ne na tělo.
function _leadAim(from, target, speed) {
  // Cíl = čepel příjemce (hráč). U netrénažéru (passer bez hokejky) = jeho pozice.
  let tx = target.x, ty = target.y;
  if (target.isPlayer) {
    const a = target.aimAngle ?? 0;
    tx += Math.cos(a) * PLAYER.stickLen;
    ty += Math.sin(a) * PLAYER.stickLen;
  }
  const dist = Math.hypot(tx - from.x, ty - from.y) || 1;
  const t    = dist / speed;              // doba letu
  const px   = tx + (target.vx || 0) * t; // predikce do jízdy příjemce
  const py   = ty + (target.vy || 0) * t;
  return Math.atan2(py - from.y, px - from.x);
}

export class Game {
  constructor(canvas, net, isHost) {
    this.canvas    = canvas;
    this.net       = net;
    this.isHost    = isHost;
    this.score     = { home: 0, away: 0 };
    this.goalFlash = 0;
    this.goalText  = '';

    this.input  = new Input(canvas);
    this.local  = new Player('local',  isHost ? 'home' : 'away', this.input);
    this.remote = new RemotePlayer('remote', isHost ? 'away' : 'home');
    this.puck   = new Puck();
    this.goalieR = new Goalie('right'); // pravá branka → brání away (červený)
    this.goalieL = new Goalie('left');  // levá branka → brání home (modrý)

    // počáteční otočení čelem k puku (na střed) — hlavně away startuje opačně
    const fa0 = Math.atan2(RINK.h / 2 - this.local.y, RINK.centerX - this.local.x);
    this.local.bodyAngle = this.local.skateAngle = this.local.aimAngle = this.local.carryAngle = fa0;

    this.world = new World([new Rink(), this.local, this.remote, this.goalieL, this.goalieR, this.puck]);
    this.world.authoritative = isHost;
    this.world.onGoal        = result => this._handleGoal(result);

    this.engine = new Engine(canvas);
    this._sendAccum    = 0;
    this._sendInterval = 1 / SEND_HZ;
    this._chargeDecaying   = false;
    this._chargeBlocked    = false;
    this._chargeCancelled  = false;
    this._oneTimer         = false;
    this._seq              = 0;   // pořadové číslo odchozích state paketů
    this._lastSeq          = 0;   // poslední přijaté → zahazuje přeházené/staré (anti-stutter)
    this._grabCool         = 0;   // throttle klientské predikce sebrání puku

    if (net) net.onMessage = msg => this._onMessage(msg);
  }

  start() {
    this.engine.onTick = (dt, cam) => this._tick(dt, cam);
    this.engine.onDraw = (ctx)     => this._drawOverlay(ctx);
    this.engine.run(this.world);
  }

  _tick(dt, cam) {
    const mouse = fromScreen(this.input.mouseX, this.input.mouseY, cam);
    const adx = mouse.x - this.local.x, ady = mouse.y - this.local.y;
    this.local.aimDist = Math.hypot(adx, ady); // dosah hole dle kurzoru
    _updateAim(this.local, Math.atan2(ady, adx), dt); // rychlost natáčení škáluje dle vzdálenosti (viz _updateAim)
    const forehandNow = !this.input.shift;

    if (this.input.lmbJustPressed) { this._chargeCancelled = false; this._oneTimer = !this.local.hasPuck; }
    if (!this.input.lmb) this._chargeBlocked = false;

    // Crosscheck (RMB bez puku) ruší jakékoli rozdělané nabití
    if (this.input.rmb && !this.local.hasPuck && this.local.charge > 0) {
      this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false; this._oneTimer = false;
    }

    // Při crosschecku (RMB bez puku) nelze nabíjet
    if (this.input.lmb && !this._chargeBlocked && !(this.input.rmb && !this.local.hasPuck)) {
      // Charge builds whether or not we hold the puck → enables one-timers
      if (!this._chargeDecaying) {
        // one-timer drží charge pod overcharge i po sebrání puku (manuální výstřel)
        const cap = (this.local.hasPuck && !this._oneTimer) ? 1 : 0.95;
        this.local.charge = Math.min(cap, this.local.charge + CHARGE_RATE * dt);
        if (this.local.charge >= 1 && this.local.hasPuck && !this._oneTimer) { this._chargeDecaying = true; this.local.overcharged = true; }
      } else if (this.local.hasPuck) {
        this.local.charge = Math.max(0, this.local.charge - CHARGE_RATE * 1.8 * dt);
        if (this.local.charge <= 0) {
          // Overcharged — auto-fire weak shot
          if (this.isHost) { this.local.shoot(this.puck, 0.12, forehandNow); }
          else { this.net?.send({ t: 'shoot', charge: 0.12, fh: forehandNow ? 1 : 0 }); this.local.hasPuck = false; }
          this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
        }
      } else {
        this._chargeDecaying = false; this.local.overcharged = false;
      }
    }

    // rmbJustPressed can cause a spurious lmbJustReleased in some browsers — suppress shoot in that case
    const rmbCancelledCharge = this.input.rmbJustPressed && this.local.hasPuck && this.local.charge > 0;

    if (this.input.lmbJustReleased && !rmbCancelledCharge) {
      if (this.local.hasPuck && !this._chargeCancelled) {
        if (this.isHost) {
          this.local.shoot(this.puck, this.local.charge, forehandNow);
        } else {
          this.net?.send({ t: 'shoot', charge: this.local.charge, fh: forehandNow ? 1 : 0 });
          this.local.hasPuck = false;
        }
      }
      this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
      this._chargeCancelled = false; this._oneTimer = false;
    }

    if (this.input.rmbJustPressed && this.local.hasPuck) {
      // Charge cancel only when charge is meaningful (> 0.08) — prevents "need 2 clicks" bug
      if (this.local.charge > 0.08) {
        this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
        this._chargeBlocked = true;
        this._chargeCancelled = true;
      } else {
        // Nahrávka predikovaná do jízdy spoluhráče (lead), hůl se neotáčí
        this.local.charge = 0;
        const lead = this.remote ? _leadAim(this.local.stickTip, this.remote, PUCK.passSpeed) : null;
        if (this.isHost) { this.local.pass(this.puck, lead, forehandNow); }
        else { this.net?.send({ t: 'pass', aim: lead, fh: forehandNow ? 1 : 0 }); this.local.hasPuck = false; this.local._passCooldown = 0.15; }
      }
    }

    // MMB — žádost o nahrávku (vizuální signál + odeslání)
    if (this.input.mmbJustPressed && !this.local.hasPuck) {
      this.local.passReq = 0.9;
      this.net?.send({ t: 'passreq' });
    }

    this.input.flush();

    // Klientská predikce sebrání: host vidí guesta opožděně a jeho čepel na puk
    // netrefí. Vidím-li čepel na puku v reálném čase, požádám hosta a optimisticky
    // puk držím (host potvrdí/zamítne přes `po`).
    if (this._grabCool > 0) this._grabCool -= dt;
    if (!this.isHost && !this.local.hasPuck && this._grabCool <= 0 &&
        this.local.canPickup(this.puck)) {
      this.net?.send({ t: 'grab' });
      this.local._grabPuck();
      this._grabCool = 0.2;
    }

    if (this.goalFlash > 0) this.goalFlash -= dt;

    this._sendAccum += dt;
    if (this._sendAccum >= this._sendInterval && this.net?.connected) {
      this._sendAccum = 0;
      const msg = {
        t: 'state',
        seq: ++this._seq,
        x: this.local.x,  y: this.local.y,
        vx: this.local.vx, vy: this.local.vy,
        ba: this.local.bodyAngle, aa: this.local.aimAngle,
        hp: this.local.hasPuck ? 1 : 0,
        ch: this.local.charge,
        fh: this.local.forehand  ? 1 : 0,
        cc: this.local.crossCheck ? 1 : 0,
        pr: this.local.passReq > 0 ? 1 : 0,
        hd: this.local.handed,
        nm: this.local.name || '',
      };
      if (this.isHost) {
        msg.px = this.puck.x;  msg.py  = this.puck.y;
        msg.pvx = this.puck.vx; msg.pvy = this.puck.vy;
        msg.sc = this.score;
        // vlastník puku: 1 = host (local), 2 = klient (remote), 0 = volný
        msg.po = this.local.hasPuck ? 1 : (this.remote.hasPuck ? 2 : 0);
      }
      this.net.send(msg);
    }
  }

  _drawOverlay(ctx) {
    _renderHUD(ctx, this.score);

    if (this.goalFlash > 0) {
      const alpha = Math.min(1, this.goalFlash);
      ctx.fillStyle = `rgba(255, 220, 60, ${alpha * 0.15})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.font = 'bold 64px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255, 220, 60, ${alpha})`;
      ctx.fillText(this.goalText, ctx.canvas.width / 2, ctx.canvas.height / 2);
    }

    // DEBUG (dočasné) — stav vlastnictví/pickupu na obou klientech
    try {
      const cp = this.local.canPickup(this.puck) ? 1 : 0;
      const tip = this.local.stickTip;
      const d = Math.round(Math.min(
        Math.hypot(this.puck.x - tip.x, this.puck.y - tip.y),
        Math.hypot(this.puck.x - this.local.x, this.puck.y - this.local.y)));
      ctx.font = '13px monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = '#33ff66';
      ctx.fillText(
        `${this.isHost ? 'HOST' : 'GUEST'} v9  lp:${this.local.hasPuck ? 1 : 0} rp:${this.remote?.hasPuck ? 1 : 0} ` +
        `po:${this._dbgPo ?? '-'} canPickup:${cp} dist:${d} z:${Math.round(this.puck.z)} shootCD:${this.local._shootCooldown.toFixed(2)}`,
        12, ctx.canvas.height - 14);
    } catch (e) {
      ctx.fillStyle = '#ff5555'; ctx.font = '13px monospace'; ctx.textAlign = 'left';
      ctx.fillText('DBG ERR: ' + e.message, 12, ctx.canvas.height - 14);
    }
  }

  _onMessage(msg) {
    if (msg.t === 'state') {
      // Zahoď přeházený/starý paket (datachannel je unordered) → konec gumování
      if (msg.seq !== undefined) {
        if (msg.seq <= this._lastSeq) return;
        this._lastSeq = msg.seq;
      }
      this.remote.applyState(msg);
      // Vlastnictví puku je host-authoritative:
      //  • klient věří hostovu hp (drží-li puk hostův hráč = můj remote)
      //  • host guestovo hp IGNORUJE (vlastnictví remote řídí jeho simulace) — jinak
      //    by guestovo opožděné hp=0 hned přepsalo sebrání → puk by se „nebral".
      if (!this.isHost) this.remote.hasPuck = !!msg.hp;
      if (!this.isHost && msg.px !== undefined) {
        // Puk se neteleportuje — host pošle cíl, klient k němu plynule interpoluje (Puck.update)
        this.puck._netX = msg.px;  this.puck._netY = msg.py;
        this.puck.vx    = msg.pvx; this.puck.vy    = msg.pvy;
      }
      // Vlastnictví puku je host-authoritative: po===2 → můj (klientův) hráč drží puk
      if (!this.isHost && msg.po !== undefined) { this.local.hasPuck = (msg.po === 2); this._dbgPo = msg.po; }
      if (!this.isHost && msg.sc) this.score = msg.sc;
      return;
    }
    if (msg.t === 'shoot'   && this.isHost) this.remote.shoot(this.puck, msg.charge, msg.fh !== 0);
    if (msg.t === 'pass'    && this.isHost) this.remote.pass(this.puck, msg.aim, msg.fh !== 0);
    if (msg.t === 'grab'    && this.isHost) {
      // Klient hlásí sebrání (ověřil čepel v reálném čase). Host potvrdí, je-li puk
      // volný a klient je u puku (sanity proti teleportu).
      const free = !this.local.hasPuck && !this.remote.hasPuck &&
                   !this.goalieL.isHolding && !this.goalieR.isHolding && !this.world._goalLock;
      const near = Math.hypot(this.puck.x - this.remote.x, this.puck.y - this.remote.y) < 40;
      if (free && near && this.puck.z < 6) this.remote._grabPuck();
    }
    if (msg.t === 'goal')   this._flashGoal(msg.text);
    if (msg.t === 'passreq') this.remote.passReq = 0.9;
    if (msg.t === 'faceoff') {
      // Buly: host řekl, kam si mám postavit hráče → snap (jinak pozice rozjeté)
      this.local.x = msg.rx; this.local.y = msg.ry;
      this.local.vx = this.local.vy = 0;
      this.local.hasPuck = false; this.local.charge = 0;
      this._chargeDecaying = false; this._oneTimer = false;
      // čelem k puku (na střed)
      const fa = Math.atan2(RINK.h / 2 - this.local.y, RINK.centerX - this.local.x);
      this.local.bodyAngle = this.local.skateAngle = this.local.aimAngle = this.local.carryAngle = fa;
    }
  }

  _handleGoal(result) {
    const text = result === 'goal-away' ? 'GOAL! 🔴' : 'GOAL! 🔵';
    if (result === 'goal-away') this.score.away++;
    else this.score.home++;
    this._flashGoal(text);
    this.net?.send({ t: 'goal', text });
    setTimeout(() => {
      // Buly na středu — oba hráči kousek od puku, závod o získání
      this.local.x  = this.isHost ? RINK.centerX - 70 : RINK.centerX + 70;
      this.local.y  = RINK.h / 2;
      this.local.vx = this.local.vy = 0;
      this.local.hasPuck = false;
      // čelem k puku (na střed)
      const fa = Math.atan2(RINK.h / 2 - this.local.y, RINK.centerX - this.local.x);
      this.local.bodyAngle = this.local.skateAngle = this.local.aimAngle = this.local.carryAngle = fa;
      this.remote._tx = this.isHost ? RINK.centerX + 70 : RINK.centerX - 70;
      this.remote._ty = RINK.h / 2;
      this.puck.reset(); // puk na středu, živý → kdo dřív
      this.world._goalLock = false;
      // Klient sám gól nereaguje (host-authoritative) → pošli mu jeho buly pozici
      this.net?.send({ t: 'faceoff', rx: this.remote._tx, ry: this.remote._ty });
    }, 1200);
  }

  _flashGoal(text) {
    this.goalFlash = 2.5;
    this.goalText  = text;
  }
}

export class SandboxGame {
  constructor(canvas) {
    this.canvas    = canvas;
    this.score     = { home: 0, away: 0 };
    this.goalFlash = 0;
    this.goalText  = '';

    this.input  = new Input(canvas);
    this.local  = new Player('local', 'home', this.input);
    this.puck   = new Puck();
    this.goalie = new Goalie();
    this.passer = new Passer();

    this.world = new World([new Rink(), this.local, this.goalie, this.passer, this.puck]);
    this.world.onGoal                 = result => this._handleGoal(result);
    this.world.onResolveInteractions  = world  => this._resolveInteractions(world);

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
    this.engine.onTick = (dt, cam) => this._tick(dt, cam);
    this.engine.onDraw = (ctx)     => this._drawOverlay(ctx);
    this.engine.run(this.world);
  }

  _tick(dt, cam) {
    const mouse = fromScreen(this.input.mouseX, this.input.mouseY, cam);
    const adx = mouse.x - this.local.x, ady = mouse.y - this.local.y;
    this.local.aimDist = Math.hypot(adx, ady); // dosah hole dle kurzoru
    _updateAim(this.local, Math.atan2(ady, adx), dt); // rychlost natáčení škáluje dle vzdálenosti (viz _updateAim)
    const forehandNow = !this.input.shift;

    if (this.input.lmbJustPressed) { this._chargeCancelled = false; this._oneTimer = !this.local.hasPuck; }
    if (!this.input.lmb) this._chargeBlocked = false;

    // Crosscheck (RMB bez puku) ruší jakékoli rozdělané nabití
    if (this.input.rmb && !this.local.hasPuck && this.local.charge > 0) {
      this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false; this._oneTimer = false;
    }

    // Při crosschecku (RMB bez puku) nelze nabíjet
    if (this.input.lmb && !this._chargeBlocked && !(this.input.rmb && !this.local.hasPuck)) {
      // Charge builds bez puku → one-timery
      if (!this._chargeDecaying) {
        const cap = (this.local.hasPuck && !this._oneTimer) ? 1 : 0.95;
        this.local.charge = Math.min(cap, this.local.charge + CHARGE_RATE * dt);
        if (this.local.charge >= 1 && this.local.hasPuck && !this._oneTimer) { this._chargeDecaying = true; this.local.overcharged = true; }
      } else if (this.local.hasPuck) {
        this.local.charge = Math.max(0, this.local.charge - CHARGE_RATE * 1.8 * dt);
        if (this.local.charge <= 0) {
          this.local.shoot(this.puck, 0.12, forehandNow);
          this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
        }
      } else {
        this._chargeDecaying = false; this.local.overcharged = false;
      }
    }
    const rmbCancelledCharge = this.input.rmbJustPressed && this.local.hasPuck && this.local.charge > 0;
    if (this.input.lmbJustReleased && !rmbCancelledCharge) {
      if (this.local.hasPuck && !this._chargeCancelled) this.local.shoot(this.puck, this.local.charge, forehandNow);
      this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
      this._chargeCancelled = false; this._oneTimer = false;
    }
    if (this.input.rmbJustPressed && this.local.hasPuck) {
      if (this.local.charge > 0.08) {
        this.local.charge = 0; this._chargeDecaying = false; this.local.overcharged = false;
        this._chargeBlocked = true;
        this._chargeCancelled = true;
      } else {
        // Nahrávka predikovaná k passeru (lead), hůl se neotáčí
        this.local.charge = 0;
        const lead = _leadAim(this.local.stickTip, this.passer, PUCK.passSpeed);
        this.local.pass(this.puck, lead, forehandNow);
      }
    }

    const rDown = !!this.input.keys['KeyR'];
    if (rDown && !this._rWas) this._reset();
    this._rWas = rDown;

    // E / MMB — žádost o nahrávku od passeru
    const eDown = !!this.input.keys['KeyE'];
    const reqPass = (eDown && !this._eWas) || this.input.mmbJustPressed;
    if (reqPass) {
      this.local.passReq = 0.9; // vizuální signál
      if (this.passer.hasPuck) {
        this.passer.forceReturn();       // passer má puk → vrátit
      } else if (!this.local.hasPuck) {
        // passer nemá puk → odeslat z jeho pozice na HOKEJKU hráče (predikce do jízdy)
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

    if (this.goalFlash > 0) this.goalFlash -= dt;
  }

  _resolveInteractions(world) {
    const { puck, players } = world;
    if (!puck) return;

    // Během oslavy gólu necháme puk dojet do sítě, žádné interakce ani re-detekce
    if (this._goalLock) return;

    // Passer holding puck — keep it frozen at passer, fire return when ready
    if (this.passer.hasPuck) {
      puck.x = this.passer.x;  puck.y  = this.passer.y;
      puck.vx = 0;             puck.vy  = 0;
      puck.z  = 0;             puck.vz  = 0;
      if (this.passer._wantsToReturn) {
        this.passer._wantsToReturn    = false;
        this.passer.hasPuck           = false;
        this.passer._receiveCooldown  = 0.55; // prevent immediate re-catch
        // rozehrávka na HOKEJKU hráče (predikce do jízdy), ne na tělo
        const ang = _leadAim(this.passer, this.local, PUCK.passSpeed + 40);
        puck.vx = Math.cos(ang) * (PUCK.passSpeed + 40);
        puck.vy = Math.sin(ang) * (PUCK.passSpeed + 40);
      }
      return;
    }

    const anyoneHasPuck = players.some(p => p.hasPuck);

    for (const p of world.players) this.goalie.blockPlayer(p);
    for (const p of players) this.goalie.pokeCheck(p, puck);

    // Hráč narazí do passera (Tab) — solidní spoluhráč/překážka (passer zůstává)
    for (const p of players) {
      const dx = p.x - this.passer.x, dy = p.y - this.passer.y;
      const dist = Math.hypot(dx, dy);
      const minD = (p.radius ?? 7) + (this.passer.radius ?? 7);
      if (dist > 0 && dist < minD) {
        const nx = dx / dist, ny = dy / dist, pen = minD - dist;
        const KB = 85;
        const both = !this.passer.isDragging; // při tažení Tabem passer drží kurzor
        if (both) {
          // symetrické rozdělení — odrazí se oba
          p.x += nx * pen * 0.5; p.y += ny * pen * 0.5;
          this.passer.x -= nx * pen * 0.5; this.passer.y -= ny * pen * 0.5;
          this.passer.vx -= nx * KB; this.passer.vy -= ny * KB;
        } else {
          p.x += nx * pen; p.y += ny * pen;
        }
        const dot = p.vx * nx + p.vy * ny;
        if (dot < 0) { p.vx -= dot * nx; p.vy -= dot * ny; }
        p.vx += nx * KB; p.vy += ny * KB; p._knockT = 0.2; // lehký knockback (bumpnutí)
      }
    }

    for (let i = 0; i < players.length; i++)
      for (let j = 0; j < players.length; j++)
        if (i !== j) players[i].tryCrossCheck(players[j]);

    if (!anyoneHasPuck) {
      const saved = this.goalie.blockPuck(puck);
      if (saved) puck.x = Math.min(puck.x, RINK.goalLineRight - 1);
      // Tečování letícího puku hokejkou (dorážky/teče)
      for (const p of players) if (p.tryDeflect(puck)) break;
      // Goalie covers a slow loose puck in the crease (no need to skate into it)
      this.goalie.controlLoosePuck(puck);

      if (!this.goalie.isHolding) {
        let pickedUp = false;
        for (const p of players) {
          if (p.tryPickup(puck)) { pickedUp = true; break; }
        }
        // Passer intercepts loose puck near its position
        if (!pickedUp) this.passer.tryReceive(puck);
      }
    }

    // Gól vyhodnocuje fyzika puku (puck.goalScored); puk zůstává v síti, reset po oslavě.
    // _goalLock brání opakovanému počítání, dokud puk leží v bráně (91:0 bug).
    if (puck.goalScored) {
      this._goalLock = true;
      world.onGoal?.(puck.goalScored);
    }
  }

  _drawOverlay(ctx) {
    _renderHUD(ctx, this.score);

    if (this.goalFlash > 0) {
      const alpha = Math.min(1, this.goalFlash);
      ctx.fillStyle = `rgba(255, 220, 60, ${alpha * 0.08})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.font = 'bold 64px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255, 220, 60, ${alpha})`;
      ctx.fillText(this.goalText, ctx.canvas.width / 2, ctx.canvas.height / 2);
    }
  }

  _handleGoal(result) {
    if (result === 'goal-home') {
      this.score.home++;
      this.goalText  = 'GOAL!';
      this.goalFlash = 2.5;
    }
    setTimeout(() => this._reset(), result === 'goal-home' ? 1200 : 400);
  }

  _reset() {
    this.local.x  = 200;
    this.local.y  = RINK.h / 2;
    this.local.vx = this.local.vy = 0;
    this.local.hasPuck = false;
    this.puck.reset();
    this._goalLock = false;
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
