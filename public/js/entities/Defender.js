import { PlayerBase } from './Player.js';
import { RINK, PLAYER } from '../constants.js';
import { SFX } from '../sound.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function aDiff(a, b) {
  let d = a - b;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function aLerp(a, b, t) { return a + aDiff(b, a) * Math.min(1, t); }

// Proportional steering — brakes smoothly near target instead of oscillating
function steerTo(ent, tx, ty, dt, maxSpd, K = 3.2) {
  const dx = tx - ent.x, dy = ty - ent.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) { ent.vx *= 0.68; ent.vy *= 0.68; return; }
  const nx = dx / dist, ny = dy / dist;
  // Brake zone: within 18px, reduce target speed to avoid overshoot
  const brakeMul = dist < 18 ? dist / 18 : 1;
  const wantSpd  = Math.min(maxSpd, dist * K) * brakeMul;
  const blend    = Math.min(1, 10 * dt);
  ent.vx += (nx * wantSpd - ent.vx) * blend;
  ent.vy += (ny * wantSpd - ent.vy) * blend;
}

const CREASE_IN  = 52;
const CREASE_BUF = PLAYER.radius + 6;
function clampCrease(ent) {
  const inBand = ent.y > RINK.goalY - CREASE_BUF && ent.y < RINK.goalY + RINK.goalH + CREASE_BUF;
  if (!inBand) return;
  if (ent.x > RINK.goalLineRight - CREASE_IN) { ent.x = RINK.goalLineRight - CREASE_IN; if (ent.vx > 0) ent.vx = 0; }
  if (ent.x < RINK.goalLineLeft  + CREASE_IN) { ent.x = RINK.goalLineLeft  + CREASE_IN; if (ent.vx < 0) ent.vx = 0; }
}

function tipOf(ent) {
  const t = ent.stickTip;
  if (t) return t;
  const a = ent.aimAngle ?? ent.carryAngle ?? 0;
  return { x: ent.x + Math.cos(a) * PLAYER.stickLen, y: ent.y + Math.sin(a) * PLAYER.stickLen };
}

//             gap   K    spd   cd    pokeR  pokeP  home
const PRESET = {
  passive:   { gap: 26, K: 2.2, spd: 0.55, cd: 99,  pokeR: 0,  pokeP: 0,    home: true  },
  zone:      { gap: 20, K: 2.8, spd: 0.82, cd: 0.45, pokeR: 24, pokeP: 0.18, home: true  },
  balanced:  { gap: 16, K: 3.4, spd: 0.93, cd: 0.38, pokeR: 26, pokeP: 0.24, home: false },
  forecheck: { gap: 11, K: 4.2, spd: 1.03, cd: 0.30, pokeR: 28, pokeP: 0.32, home: false },
};

const STYLE_CFG = PRESET;
const ZONE_R    = 160;

// ── Defender ──────────────────────────────────────────────────────────────────
export class Defender extends PlayerBase {
  constructor() {
    super('defender', 'away');
    this.active    = false;
    this.radius    = PLAYER.radius;
    this.homeX     = RINK.goalLineRight - 120;
    this.homeY     = RINK.h / 2;
    this.config    = { preset: 'balanced' };

    this._state    = 'idle';
    this._stateT   = 0;

    this._pokeT        = 0;
    this._bcCoolT      = 0;
    this._showBuild    = false;
    this._chargeHoldT  = 0;
    this._justClearedT = 0;

    this._aimTarget   = 0;
    this._interceptX  = 0;
    this._interceptY  = 0;
    this._stuckT = 0; this._stuckX = 0; this._stuckY = 0;
    this._gapClose  = false;
    this._seekShift = 0;

    // C1: gap noise — slow random drift so bot never plays identically twice
    this._gapNoise  = 0;
    this._gapNoiseT = 0;
    this._passiveT  = 0;

    // C3: wrong read — periodic 0.4s mis-read
    this._wrongReadTimer  = 8 + Math.random() * 4;
    this._wrongReadActive = false;
    this._wrongReadDur    = 0;
    this._wrongReadSide   = 1;
  }

  canPickup()  { return false; }
  get isDefender() { return true; }
  get isPassive()  { return (this.config?.preset ?? 'balanced') === 'passive'; }
  tryPickup()  { return false; }
  canSteal()   { return false; }
  tryDeflect() { return false; }

  reset(x, y) {
    this.x = x ?? this.homeX;
    this.y = y ?? this.homeY;
    this.vx = 0; this.vy = 0;
    this.hasPuck = false; this.charge = 0;
    this.bodyAngle = this.aimAngle = this.skateAngle = this.carryAngle = 0;
    this._pokeT = 0; this._bcCoolT = 0;
    this._chargeHoldT = 0; this._justClearedT = 0;
    this._state = 'idle'; this._stateT = 0;
    this._stuckT = 0; this._stuckX = this.x; this._stuckY = this.y;
    this._gapClose = false; this._seekShift = 0;
    this._interceptX = 0; this._interceptY = 0;
    this._gapNoise = 0; this._gapNoiseT = 0; this._passiveT = 0;
    this._wrongReadTimer = 8 + Math.random() * 4;
    this._wrongReadActive = false; this._wrongReadDur = 0;
  }

  // ── main update ───────────────────────────────────────────────────────────
  update(dt, world) {
    if (!this.active) return;
    if (this._pokeT        > 0) this._pokeT        -= dt;
    if (this._bcCoolT      > 0) this._bcCoolT      -= dt;
    if (this._justClearedT > 0) this._justClearedT -= dt;
    if (this._pokeSweepT   > 0) this._pokeSweepT   -= dt;
    this._stateT += dt;

    const target = world?.players?.find(p => p._isLocal);
    if (!target) return;

    const puck  = world?.puck;
    const cfg   = this.config;
    const preset = cfg.preset ?? cfg.style ?? 'balanced';
    const sc    = PRESET[preset] ?? PRESET.balanced;
    const maxSpd = PLAYER.speed * sc.spd;
    const goalX  = RINK.goalLineRight;


    // Set full stick reach for AI — _dispReach drives stickTip geometry
    this.aimDist = 80;

    // C1: gap noise — slow random walk, resets each drag
    this._gapNoiseT += dt;
    if (this._gapNoiseT > 0.3) {
      this._gapNoise += (Math.random() - 0.5) * 2.5;
      this._gapNoise  = Math.max(-5, Math.min(5, this._gapNoise)) * 0.88;
      this._gapNoiseT = 0;
    }

    // C3: wrong read timer
    this._wrongReadTimer -= dt;
    if (this._wrongReadTimer <= 0) {
      if (Math.random() < 0.15) {
        this._wrongReadActive = true;
        this._wrongReadDur    = 0.4;
        this._wrongReadSide   = Math.random() > 0.5 ? 1 : -1;
      }
      this._wrongReadTimer = 8 + Math.random() * 4;
    }
    if (this._wrongReadActive) {
      this._wrongReadDur -= dt;
      if (this._wrongReadDur <= 0) this._wrongReadActive = false;
    }

    // ── Situational signals ────────────────────────────────────────────────
    const playerSpd = Math.hypot(target.vx, target.vy);
    const playerDir = playerSpd > 12 ? Math.atan2(target.vy, target.vx) : this._aimTarget;

    const nearPostY = Math.max(RINK.goalY, Math.min(RINK.goalY + RINK.goalH, target.y));
    const toGoalDir = Math.atan2(nearPostY - target.y, goalX - target.x);
    const dotToGoal = Math.cos(aDiff(playerDir, toGoalDir));

    // Fix #6: rushing threshold 130px/s (was 80 = walking pace)
    const isRushing   = target.hasPuck && playerSpd > 130 && dotToGoal > 0.35;
    const isLateral   = target.hasPuck && playerSpd > 45  && Math.abs(Math.sin(aDiff(playerDir, toGoalDir))) > 0.55;
    const isWindingUp = target.hasPuck && (target.charge ?? 0) > 0.06;

    const puckSpd = puck ? Math.hypot(puck.vx, puck.vy) : 0;

    const chaseX    = target.hasPuck ? target.x : (puck?.x ?? target.x);
    const chaseY    = target.hasPuck ? target.y : (puck?.y ?? target.y);
    const dChase    = Math.hypot(chaseX - this.x, chaseY - this.y);
    const dHome     = Math.hypot(this.x - this.homeX, this.y - this.homeY);

    const playerNearHome = Math.hypot(target.x - this.homeX, target.y - this.homeY) < ZONE_R;
    const puckNearHome   = puck && Math.hypot(puck.x - this.homeX, puck.y - this.homeY) < ZONE_R;
    const isLoosePuck    = !target.hasPuck && puckSpd > 25 && puck && puck.z < 3
                         && puckNearHome && this._justClearedT <= 0;

    // ── Dynamic gap (C5) ──────────────────────────────────────────────────
    const minGap = PLAYER.radius * 2 + 3;  // 17px — prevent body overlap
    let desiredGap;
    if (isRushing)           desiredGap = sc.gap + 5;
    else if (playerSpd < 22) desiredGap = Math.max(minGap, sc.gap - 3);
    else if (isLateral)      desiredGap = sc.gap + 3;   // player jde bokem — víc místa
    else                     desiredGap = sc.gap;
    desiredGap = Math.max(minGap, desiredGap + this._gapNoise); // C1: noise
    // Při nábíjení šotu: defender drží svůj gap, netlačí se dovnitř

    // Poke-range flag (visual + aim)
    const pokeR = sc.pokeR ?? 28;
    // Use actual puck position for range check, not player center
    const puckPos     = puck && target.hasPuck ? { x: puck.x, y: puck.y } : null;
    const myTipNow    = this.stickTip ?? tipOf(this);
    const dToPuck     = puckPos ? Math.hypot(puckPos.x - myTipNow.x, puckPos.y - myTipNow.y) : 999;
    this._pokeActive  = target.hasPuck && dToPuck < pokeR;

    // ── State transitions ──────────────────────────────────────────────────
    const prev = this._state;

    switch (this._state) {

      case 'idle':
        if (target.hasPuck && playerNearHome)  this._setState('gap');
        else if (isLoosePuck)                  this._setState('intercept');
        break;

      case 'gap': {
        if (isWindingUp) {
          this._chargeHoldT += dt;
          if (this._chargeHoldT > 0.10) { this._setState('block'); break; }
        } else {
          this._chargeHoldT = 0;
        }
        if (isLoosePuck) { this._setState('intercept'); break; }
        if (sc.home && !playerNearHome && dChase > 120) { this._setState('idle'); break; }
        // Player beat defender while rushing — drop back
        if (isRushing && target.x > this.x + 80 && this.x < goalX - 40) {
          this._setState('recover'); break;
        }
        // Player left zone, debounce 0.4s to avoid flip-flop on pass
        if (!target.hasPuck && !isLoosePuck && this._stateT > 0.4) {
          this._setState('idle'); break;
        }
        break;
      }

      case 'block':
        // Fix #17: BLOCK timeout 1.4s prevents getting stuck on charge fake
        if (((target.charge ?? 0) < 0.02 && this._stateT > 0.20) || this._stateT > 1.4) {
          this._chargeHoldT = 0;
          this._setState('gap');
        }
        break;

      case 'recover':
        if (dHome < 24 && target.hasPuck && playerNearHome) { this._setState('gap'); break; }
        if (dHome < 24 && !target.hasPuck && !isLoosePuck)  { this._setState('idle'); break; }
        // If player attacks while we're still recovering — re-engage if close enough
        if (target.hasPuck && dChase < desiredGap * 2.5)    { this._setState('gap'); break; }
        break;

      case 'intercept':
        if (target.hasPuck)                    { this._setState('gap');  break; }
        if (puckSpd < 20 || !puckNearHome)     { this._setState('idle'); break; }
        break;
    }
    if (this._state !== prev) this._stateT = 0;

    // ── Behaviour per state ────────────────────────────────────────────────
    let wantAim = Math.atan2(chaseY - this.y, chaseX - this.x);

    switch (this._state) {

      case 'idle': {
        steerTo(this, this.homeX, this.homeY, dt, maxSpd * 0.50, 2.2);
        wantAim = Math.atan2(target.y - this.y, target.x - this.x);
        break;
      }

      case 'gap': {
        if (preset === 'forecheck') {
          // Forecheck: predictive cut-off
          const predT = Math.min(0.20, dChase / Math.max(maxSpd, 1));
          const px    = chaseX + (target.vx ?? 0) * predT;
          const py    = chaseY + (target.vy ?? 0) * predT;
          steerTo(this, px, py, dt, maxSpd, sc.K);
          wantAim = Math.atan2(chaseY - this.y, chaseX - this.x);
          // Anti-stuck
          this._stuckT += dt;
          if (this._stuckT > 1.0) {
            const moved = Math.hypot(this.x - this._stuckX, this.y - this._stuckY);
            if (moved < 8) {
              const escDir = Math.atan2(RINK.h / 2 - this.y, chaseX - this.x)
                           + (Math.random() > 0.5 ? Math.PI / 3 : -Math.PI / 3);
              this.vx += Math.cos(escDir) * 55; this.vy += Math.sin(escDir) * 55;
            }
            this._stuckT = 0; this._stuckX = this.x; this._stuckY = this.y;
          }
          break;
        }

        // Zone/Balanced: gap hold toward near post + lateral channel toward boards
        const gNX = Math.cos(toGoalDir), gNY = Math.sin(toGoalDir);
        // Perpendicular to goal direction (lateral axis)
        const perpX = -gNY, perpY = gNX;
        // Channel player toward nearest board (away from center)
        const toCenterSign = (target.y < RINK.h / 2) ? 1 : -1;
        const channelOff   = 10 * toCenterSign;  // offset defender sideways = forces player toward board

        let tx = target.x + gNX * desiredGap + perpX * channelOff;
        let ty = target.y + gNY * desiredGap + perpY * channelOff;

        if (isLateral) {
          const lateralSin = Math.sin(aDiff(playerDir, toGoalDir));
          ty += Math.sign(lateralSin) * 20;
        }

        // C3: wrong read — jde špatným směrem laterálně po krátkou dobu
        if (this._wrongReadActive) ty += this._wrongReadSide * 38;

        // Clamp out of crease area
        if (ty > RINK.goalY - CREASE_BUF && ty < RINK.goalY + RINK.goalH + CREASE_BUF)
          tx = Math.min(tx, RINK.goalLineRight - CREASE_IN);

        // Stand-ground with hysteresis — prevents flip-flop jitter at threshold boundary
        if (dChase < desiredGap * 1.10) this._gapClose = true;
        if (dChase > desiredGap * 1.45) this._gapClose = false;
        const gapSpd = this._gapClose
          ? maxSpd * 0.18                                   // near-stationary hold
          : maxSpd * (isRushing ? 0.93 : 0.85);
        const K = isRushing ? sc.K * 0.85 : sc.K;
        steerTo(this, tx, ty, dt, gapSpd, K);

        // Stick placement
        if (isWindingUp) {
          // Block shot line
          wantAim = target.aimAngle;
        } else if (this._pokeActive && puck) {
          // Aim at actual puck position
          wantAim = Math.atan2(puck.y - this.y, puck.x - this.x);

          // C — lateral search: if target body is between us and the puck,
          // gradually shift aim to "find space" around the body
          const toTargetX = target.x - this.x, toTargetY = target.y - this.y;
          const dToTarget = Math.hypot(toTargetX, toTargetY) || 1;
          const dotBody   = (toTargetX / dToTarget) * Math.cos(wantAim)
                          + (toTargetY / dToTarget) * Math.sin(wantAim);
          if (dotBody > 0.70 && dToTarget < PLAYER.stickLen + PLAYER.radius * 2) {
            // Body roughly in stick direction — start shifting laterally
            const cross = Math.cos(wantAim) * toTargetY - Math.sin(wantAim) * toTargetX;
            const shiftDir = cross > 0 ? -1 : 1;   // swing around the nearer side
            this._seekShift = (this._seekShift ?? 0) + shiftDir * 1.8 * dt;
            this._seekShift = Math.max(-0.38, Math.min(0.38, this._seekShift));
          } else {
            // Clear path — decay shift back to zero
            this._seekShift = (this._seekShift ?? 0) * Math.max(0, 1 - 5 * dt);
          }
          wantAim += this._seekShift;
        } else if (isRushing) {
          const toPlayer = Math.atan2(target.y - this.y, target.x - this.x);
          const rushDir  = Math.atan2(target.vy, target.vx);
          wantAim = aLerp(toPlayer, rushDir + Math.PI, 0.30);
        } else if (target.hasPuck && playerSpd > 35) {
          // Skating with puck: stick angled to block pass lane + near post
          const toPlayer = Math.atan2(target.y - this.y, target.x - this.x);
          const toPost   = Math.atan2(nearPostY - this.y, goalX - this.x);
          wantAim = aLerp(toPlayer, toPost, 0.25);
        } else if (target.hasPuck) {
          // Standing: more aggressive toward post — forces a decision
          const toPlayer = Math.atan2(target.y - this.y, target.x - this.x);
          const toPost   = Math.atan2(nearPostY - this.y, goalX - this.x);
          wantAim = aLerp(toPlayer, toPost, 0.55);
        } else if (isLoosePuck && puck) {
          wantAim = Math.atan2(puck.y + puck.vy * 0.15 - this.y, puck.x + puck.vx * 0.15 - this.x);
        } else {
          wantAim = Math.atan2(target.y - this.y, target.x - this.x);
        }
        break;
      }

      case 'block': {
        // Drž gap, neuskoč dovnitř — stačí natočit hole do střelecké linie
        // Pohyb jen laterálně (blokovat střelu), ne vpřed na hráče
        const shotAng = target.aimAngle;
        const tipT    = tipOf(target);
        const bx = tipT.x + Math.cos(shotAng) * (desiredGap * 0.6);
        const by = tipT.y + Math.sin(shotAng) * (desiredGap * 0.6);
        steerTo(this, bx, by, dt, maxSpd * 0.80, 3.5);
        wantAim = Math.atan2(tipT.y - this.y, tipT.x - this.x);
        break;
      }

      case 'recover': {
        // Arc recovery: intermediate waypoint offset laterally so path curves naturally
        const dxHome = this.homeX - this.x, dyHome = this.homeY - this.y;
        const distHome = Math.hypot(dxHome, dyHome);
        let rx = this.homeX, ry = this.homeY;
        if (distHome > 40) {
          // Midpoint offset perpendicular to direct path — curves toward center ice
          const midX = (this.x + this.homeX) * 0.5;
          const midY = (this.y + this.homeY) * 0.5;
          const perpX = -dyHome / distHome, perpY = dxHome / distHome;
          const arcAmt = Math.min(distHome * 0.28, 38) * (midY < RINK.h / 2 ? 1 : -1);
          const wpX = midX + perpX * arcAmt;
          const wpY = midY + perpY * arcAmt;
          // Use waypoint while still far from home
          const toWpDist = Math.hypot(wpX - this.x, wpY - this.y);
          if (toWpDist > 20) { rx = wpX; ry = wpY; }
        }
        steerTo(this, rx, ry, dt, maxSpd * 1.12, 4.2);
        const mv = Math.hypot(this.vx, this.vy);
        if (mv > 12) wantAim = Math.atan2(this.vy, this.vx);
        break;
      }

      case 'intercept': {
        if (puck) {
          const ttr   = dChase / Math.max(maxSpd * 0.85, 1);
          const predT = Math.min(0.45, ttr * 0.55);
          const ix    = Math.max(PLAYER.radius + 5, Math.min(RINK.w - PLAYER.radius - 5, puck.x + puck.vx * predT));
          const iy    = Math.max(PLAYER.radius + 5, Math.min(RINK.h - PLAYER.radius - 5, puck.y + puck.vy * predT));
          this._interceptX = ix; this._interceptY = iy;
          steerTo(this, ix, iy, dt, maxSpd * 1.08, 4.0);
          wantAim = Math.atan2(puck.y - this.y, puck.x - this.x);
        }
        break;
      }
    }

    // ── Finalize movement ─────────────────────────────────────────────────
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x  = Math.max(PLAYER.radius, Math.min(RINK.w - PLAYER.radius, this.x));
    this.y  = Math.max(PLAYER.radius, Math.min(RINK.h - PLAYER.radius, this.y));
    clampCrease(this);

    const spd = Math.hypot(this.vx, this.vy);
    if (this._state === 'idle' || this._state === 'recover') {
      if (spd > 8) this.bodyAngle = Math.atan2(this.vy, this.vx);
    } else {
      // Fix #13: faster body rotation (8× was 6×) — less rigid look
      this.bodyAngle = aLerp(this.bodyAngle, Math.atan2(chaseY - this.y, chaseX - this.x), Math.min(1, 8 * dt));
    }

    this._aimTarget = wantAim;
    this.aimAngle   = aLerp(this.aimAngle,   wantAim,       Math.min(1, 8 * dt));
    this.carryAngle = aLerp(this.carryAngle ?? this.aimAngle, this.aimAngle, Math.min(1, 10 * dt));
    this._updateStickDisplay(dt);

    this._skatePhase = (this._skatePhase ?? 0) + dt * Math.max(3, spd * 0.12);

    this._tryPoke(target, puck, sc);
  }

  _setState(s) {
    if (s !== 'intercept') { this._interceptX = 0; this._interceptY = 0; }
    this._state  = s;
    this._stateT = 0;
  }

  // ── poke check ───────────────────────────────────────────────────────────
  _tryPoke(target, puck, sc) {
    if (this.isPassive) return;   // passive: žádný poke ani loose puck kick
    if (this._pokeT > 0) return;

    const myTip = this.stickTip ?? tipOf(this);

    // Loose puck touch — kick to center ice, immune window check
    if (!target.hasPuck && puck && this._justClearedT <= 0) {
      const dPuck = Math.hypot(puck.x - myTip.x, puck.y - myTip.y);
      if (dPuck < 14) {
        puck.x = myTip.x; puck.y = myTip.y; puck.z = 0; puck.vz = 0;
        // Loose battle: kick in defender's aim direction ±35° at moderate speed — not a clean clear
        const ang = this.aimAngle + (Math.random() - 0.5) * 1.2;
        puck.vx = Math.cos(ang) * 130;
        puck.vy = Math.sin(ang) * 130;
        SFX.poke(false);
        this._pokeSweepT       = 0.28;
        this._pokeSweepAngle   = this.aimAngle;
        this._pokeSweepSuccess = false;
        this._pokeT        = sc.cd ?? 0.18;
        this._justClearedT = 3.0;   // immune — nezačínat znovu pronásledovat puk co jsem odkopl
        this._setState('recover');   // vrátit se domů, ne dál sledovat puk
        return;
      }
    }

    if (!target.hasPuck || !puck) return;

    // Fix #2/#24: measure from MY stickTip to ACTUAL PUCK position (not player center)
    const dPuck = Math.hypot(puck.x - myTip.x, puck.y - myTip.y);
    const pokeR = sc.pokeR ?? 28;
    if (dPuck > pokeR) return;

    // Fix #26: bonus for stationary target (easier to strip)
    const targetSpd    = Math.hypot(target.vx, target.vy);
    const standBonus   = Math.min(1.4, 1 + Math.max(0, 60 - targetSpd) / 120);

    const closingSpd   = Math.max(0, -(
      (this.vx - target.vx) * (target.x - this.x) +
      (this.vy - target.vy) * (target.y - this.y)
    ) / (Math.hypot(target.x - this.x, target.y - this.y) || 1));
    const speedMul     = Math.min(1.5, 1 + closingSpd / 100) * standBonus;

    // Body occlusion: is the puck on the defender-facing side of the player?
    // Dot product of (puck - player_center) vs (defender - player_center).
    // > 0: puck exposed toward defender; < 0: puck hidden behind body.
    const toPuckX  = puck.x - target.x, toPuckY = puck.y - target.y;
    const toDefX   = this.x  - target.x, toDefY  = this.y - target.y;
    const puckLen  = Math.hypot(toPuckX, toPuckY) || 1;
    const defLen   = Math.hypot(toDefX,  toDefY)  || 1;
    const exposed  = (toPuckX * toDefX + toPuckY * toDefY) / (puckLen * defLen);
    if (exposed < -0.10) return;  // body physically blocks the stick — hard stop

    // Soft penalty for oblique angles (puck partially shielded)
    const shieldMul = exposed < 0.25 ? 0.60 : 1.0;

    // Fix #3: higher base chance (55% was 30%), scales with proximity
    const distFactor   = Math.max(0.5, 1 - dPuck / pokeR);  // closer = easier
    const baseChance   = (sc.pokeP ?? 0.55) * speedMul * shieldMul * distFactor;

    if (Math.random() < baseChance) {
      // Fix #4 (poke success): full reset of player puck state
      target.hasPuck         = false;
      target._shootCooldown  = 0.50;
      target.charge          = 0;
      target._chargeDecaying = false;
      target.overcharged     = false;
      target._oneTimer       = false;

      // Puk se uvolní — zrcadlí stealFrom() z multiplayeru:
      // náhodný směr dle carryAngle hráče, nízká rychlost → souboj o volný puk
      const tip = tipOf(target);
      puck.x  = tip.x; puck.y = tip.y;
      puck.z  = 0;     puck.vz = 0;
      const kickDir = (target.carryAngle ?? target.aimAngle ?? 0) + (Math.random() - 0.5) * 1.1;
      const kickSpd = 75 + Math.random() * 45;   // 75–120 px/s — loose battle, ne clear
      puck.vx = Math.cos(kickDir) * kickSpd;
      puck.vy = Math.sin(kickDir) * kickSpd;
      SFX.poke(true);
      this._pokeSweepT       = 0.35;
      this._pokeSweepAngle   = this.aimAngle;
      this._pokeSweepSuccess = true;
      target._pokedAt = performance.now();

      this._justClearedT = 1.8;   // kratší imunita — defender může re-engagovat jak puk dosadí
      this._setState('recover');
    }
    this._pokeT = sc.cd ?? 0.18;
  }

  // ── bodycheck ────────────────────────────────────────────────────────────
  tryBodycheck(player, dt) {
    if (!this.active) return false;
    const cfg = this.config;
    // Fix #39: map preset to physics tier instead of missing cfg.physics key
    const preset    = cfg.preset ?? cfg.style ?? 'balanced';
    if (preset === 'zone' || preset === 'passive') return false;
    if (this._bcCoolT > 0) return false;

    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minD = this.radius + (player.radius ?? 7);
    if (dist < minD) {
      const nx = dx / dist, ny = dy / dist;
      const relVx = this.vx - player.vx, relVy = this.vy - player.vy;
      const closingSpd = -(relVx * nx + relVy * ny);
      const threshold  = preset === 'forecheck' ? 45 : 70;
      if (closingSpd > threshold) {
        const impulse = preset === 'forecheck' ? 210 : 165;
        player.vx += nx * impulse; player.vy += ny * impulse;
        player._knockT = 0.32;
        this.vx -= nx * 55;  this.vy -= ny * 55;
        if (preset === 'forecheck' && player.hasPuck) {
          player.hasPuck = false;
          player._shootCooldown = 0.5;
        }
        this._bcCoolT = 1.8;
        return true;
      }
    }
    return false;
  }

  // ── draw ─────────────────────────────────────────────────────────────────
  draw(ctx, cam) {
    if (!this.active) return;
    super.draw(ctx, cam);

    const s   = cam.scale;
    const sx  = cam.ox + this.x * s;
    const sy  = cam.oy + this.y * s;

    // Poke sweep flash — visible lunge to show WHY puck was lost
    if (this._pokeSweepT > 0) {
      const SWEEP_DUR = this._pokeSweepSuccess ? 0.35 : 0.28;
      const prog = this._pokeSweepT / SWEEP_DUR;         // 1→0
      const tip  = this.stickTip ?? tipOf(this);
      const tx   = cam.ox + tip.x * s;
      const ty   = cam.oy + tip.y * s;
      const lunge = (this._pokeSweepSuccess ? 22 : 14) * s * Math.pow(prog, 0.4);
      const ang  = this._pokeSweepAngle;
      const ex   = tx + Math.cos(ang) * lunge;
      const ey   = ty + Math.sin(ang) * lunge;
      ctx.save();
      ctx.lineCap = 'round';
      // stick extension line
      ctx.globalAlpha = prog * (this._pokeSweepSuccess ? 0.90 : 0.70);
      ctx.strokeStyle = this._pokeSweepSuccess ? '#ffe066' : '#ff7777';
      ctx.lineWidth   = (this._pokeSweepSuccess ? 3 : 2.5) * s;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(ex, ey); ctx.stroke();
      // flash ring at lunge tip
      ctx.globalAlpha = prog * 0.80;
      ctx.strokeStyle = this._pokeSweepSuccess ? '#fff0a0' : '#ff5555';
      ctx.lineWidth   = 1.5 * s;
      ctx.beginPath(); ctx.arc(ex, ey, (this._pokeSweepSuccess ? 5 : 4) * s * prog, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const r   = PLAYER.radius * s;
    const cfg = this.config;
    const preset = cfg.preset ?? cfg.style ?? 'balanced';

    ctx.save();

    if (this._showBuild) {
      if (preset === 'zone') {
        const hx = cam.ox + this.homeX * s, hy = cam.oy + this.homeY * s;
        ctx.setLineDash([6 * s, 5 * s]);
        ctx.strokeStyle = 'rgba(255,60,60,0.28)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(hx, hy, ZONE_R * s, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,60,60,0.35)';
        ctx.beginPath(); ctx.arc(hx, hy, 4 * s, 0, Math.PI * 2); ctx.fill();
      }
      if (preset === 'balanced') {
        const gx = cam.ox + RINK.goalLineRight * s, gy = cam.oy + RINK.h / 2 * s;
        const hx = cam.ox + this.homeX * s,         hy = cam.oy + this.homeY * s;
        ctx.setLineDash([4 * s, 5 * s]);
        ctx.strokeStyle = 'rgba(255,180,50,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (preset === 'forecheck' && this._interceptX) {
        const ix = cam.ox + this._interceptX * s, iy = cam.oy + this._interceptY * s;
        ctx.setLineDash([3 * s, 3 * s]);
        ctx.strokeStyle = 'rgba(255,100,50,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ix, iy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,100,50,0.50)';
        ctx.beginPath(); ctx.arc(ix, iy, 4 * s, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
}
