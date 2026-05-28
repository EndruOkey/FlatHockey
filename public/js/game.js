import { PLAYER, RINK } from './constants.js';
import { makePlayer, makePuck, tickPlayer, tickPuck, shoot, pass, lerpAngle } from './physics.js';
import { computeCamera, renderFrame, toScreen, fromScreen } from './render.js';
import { Input } from './input.js';

const CHARGE_RATE = 1.1;
const SEND_HZ = 60;

export class Game {
  constructor(canvas, net, isHost) {
    this.canvas = canvas;
    this.net = net;
    this.isHost = isHost;
    this.input = new Input(canvas);
    this.score = { home: 0, away: 0 };
    this.goalFlash = 0;
    this.goalText = '';

    const localTeam  = isHost ? 'home' : 'away';
    const remoteTeam = isHost ? 'away' : 'home';

    this.local  = makePlayer('local',  localTeam);
    this.remote = makePlayer('remote', remoteTeam);
    this.puck   = makePuck();

    this.remoteTarget = { x: this.remote.x, y: this.remote.y };

    if (net) {
      net.onMessage = msg => this._onMessage(msg);
    }

    this._lastTime = null;
    this._sendAccum = 0;
    this._sendInterval = 1 / SEND_HZ;
  }

  start() {
    requestAnimationFrame(t => this._loop(t));
  }

  _loop(t) {
    if (this._lastTime === null) this._lastTime = t;
    const dt = Math.min((t - this._lastTime) / 1000, 0.05);
    this._lastTime = t;

    this._update(dt);
    this._draw();
    requestAnimationFrame(ts => this._loop(ts));
  }

  _update(dt) {
    const cam = computeCamera(this.canvas);
    const world = fromScreen(this.input.mouseX, this.input.mouseY, cam);
    this.local.aimAngle = Math.atan2(world.y - this.local.y, world.x - this.local.x);

    // Charge
    if (this.input.lmb && this.local.hasPuck) {
      this.local.charge = Math.min(1, this.local.charge + CHARGE_RATE * dt);
    }

    // Shoot on LMB release
    if (this.input.lmbJustReleased) {
      if (this.local.hasPuck) {
        if (this.isHost) {
          shoot(this.local, this.puck, this.local.charge);
        } else {
          this.net?.send({ t: 'shoot', charge: this.local.charge });
          this.local.hasPuck = false;
        }
      }
      this.local.charge = 0;
    }

    // Pass / crosscheck on RMB
    if (this.input.rmbJustPressed) {
      if (this.local.hasPuck) {
        if (this.isHost) {
          pass(this.local, this.puck);
        } else {
          this.net?.send({ t: 'pass' });
          this.local.hasPuck = false;
        }
      }
    }

    this.input.flush();

    tickPlayer(this.local, this.input, dt);

    // Smooth remote player position
    this.remote.x = lerp(this.remote.x, this.remoteTarget.x, Math.min(1, 18 * dt));
    this.remote.y = lerp(this.remote.y, this.remoteTarget.y, Math.min(1, 18 * dt));
    this.remote.bodyAngle = lerpAngle(this.remote.bodyAngle, this.remoteTargetAngle ?? this.remote.bodyAngle, Math.min(1, 14 * dt));
    this.remote.aimAngle  = lerpAngle(this.remote.aimAngle,  this.remoteAimAngle   ?? this.remote.aimAngle,  Math.min(1, 14 * dt));

    if (this.isHost) {
      const result = tickPuck(this.puck, [this.local, this.remote], dt);
      if (result) this._handleGoal(result);
    }

    if (this.goalFlash > 0) this.goalFlash -= dt;

    // Network send
    this._sendAccum += dt;
    if (this._sendAccum >= this._sendInterval && this.net?.connected) {
      this._sendAccum = 0;
      const msg = {
        t: 'state',
        x: this.local.x, y: this.local.y,
        vx: this.local.vx, vy: this.local.vy,
        ba: this.local.bodyAngle,
        aa: this.local.aimAngle,
        hp: this.local.hasPuck ? 1 : 0,
        ch: this.local.charge,
      };
      if (this.isHost) {
        msg.px = this.puck.x;
        msg.py = this.puck.y;
        msg.pvx = this.puck.vx;
        msg.pvy = this.puck.vy;
        msg.sc = this.score;
      }
      this.net.send(msg);
    }
  }

  _draw() {
    const cam = computeCamera(this.canvas);
    const ctx = this.canvas.getContext('2d');
    renderFrame(ctx, { players: [this.local, this.remote], puck: this.puck }, cam, this.score);

    if (this.goalFlash > 0) {
      const alpha = Math.min(1, this.goalFlash) * 0.5;
      ctx.fillStyle = `rgba(255, 220, 60, ${alpha * 0.15})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      ctx.font = 'bold 64px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255, 220, 60, ${Math.min(1, this.goalFlash)})`;
      ctx.fillText(this.goalText, this.canvas.width / 2, this.canvas.height / 2);
    }
  }

  _onMessage(msg) {
    if (msg.t === 'state') {
      this.remoteTarget.x = msg.x;
      this.remoteTarget.y = msg.y;
      this.remote.vx = msg.vx;
      this.remote.vy = msg.vy;
      this.remoteTargetAngle = msg.ba;
      this.remoteAimAngle = msg.aa;
      this.remote.hasPuck = !!msg.hp;
      this.remote.charge = msg.ch ?? 0;

      if (!this.isHost && msg.px !== undefined) {
        this.puck.x = msg.px;
        this.puck.y = msg.py;
        this.puck.vx = msg.pvx;
        this.puck.vy = msg.pvy;
      }
      if (!this.isHost && msg.sc) {
        this.score = msg.sc;
      }
    }

    if (msg.t === 'shoot' && this.isHost) {
      shoot(this.remote, this.puck, msg.charge);
    }

    if (msg.t === 'pass' && this.isHost) {
      pass(this.remote, this.puck);
    }

    if (msg.t === 'goal') {
      this._flashGoal(msg.text);
    }
  }

  _handleGoal(result) {
    let text = '';
    if (result === 'goal-away') {
      this.score.away++;
      text = 'GOAL! 🔴';
    } else {
      this.score.home++;
      text = 'GOAL! 🔵';
    }
    this._flashGoal(text);
    this.net?.send({ t: 'goal', text });

    // Reset players
    setTimeout(() => {
      this.local.x  = this.isHost ? 400 : 1400;
      this.local.y  = RINK.h / 2;
      this.local.vx = this.local.vy = 0;
      this.local.hasPuck = false;
      this.remoteTarget.x = this.isHost ? 1400 : 400;
      this.remoteTarget.y = RINK.h / 2;
    }, 1200);
  }

  _flashGoal(text) {
    this.goalFlash = 2.5;
    this.goalText = text;
  }
}

export class SoloGame extends Game {
  constructor(canvas) {
    super(canvas, null, true);
    // Give control of both players for testing
    this.soloMode = true;
  }

  _update(dt) {
    super._update(dt);
    // Mirror puck state to "remote" for rendering
    this.remoteTarget.x = RINK.w - this.local.x;
    this.remoteTarget.y = this.local.y;
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
