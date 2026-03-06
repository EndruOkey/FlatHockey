import type { InputMsg, ServerMessage, SnapshotMsg } from '@flathockey/shared';
import { applyMovementStep, type MovementStepConfig, type MovementStepState } from '@flathockey/shared/sim/movementStep';
import { resolvePuckStickTuning } from '@flathockey/shared/tuning/puckStickTuning';
import { WebSocket } from 'ws';

type InputState = {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  sprint: 0 | 1;
  brake: 0 | 1;
  shoot: 0 | 1;
  aimAngleRaw: number;
  aimDistance01: number;
  bodyTurn: number;
};

type BufferedInput = {
  seq: number;
  state: InputState;
};

type PlayerState = {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  moveAngle: number;
  baseBodyAngle: number;
  bodyYawOffset: number;
  aimAngleRaw: number;
  aimAngle: number;
  stickAngVel?: number;
  stamina: number;
  heading?: number;
  prevHasInput?: boolean;
  brakeAssistLeft?: number;
  startLinearActive?: boolean;
  stickSide?: -1 | 1;
  prevShoot: boolean;
  shotCharge: number;
  lastProcessedSeq: number;
  lastInputState: InputState;
  inputBuffer: BufferedInput[];
};

type Vec2 = { x: number; y: number };

type PuckState = {
  state: 'FREE' | 'HELD';
  ownerId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pickupCooldownMs: number;
};

const ZERO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  sprint: 0,
  brake: 0,
  shoot: 0,
  aimAngleRaw: 0,
  aimDistance01: 1,
  bodyTurn: 0
};

const RINK = {
  left: -560,
  right: 560,
  top: -320,
  bottom: 320
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(a: number, b: number, t: number): number {
  return normalizeAngle(a + normalizeAngle(b - a) * t);
}

export class Room {
  readonly id: string;
  readonly players = new Map<string, PlayerState>();
  readonly sockets = new Map<string, WebSocket>();
  serverTick = 0;
  movementTuning: Partial<MovementStepConfig> = {};
  puck: PuckState = {
    state: 'FREE',
    ownerId: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    pickupCooldownMs: 0
  };

  constructor(id: string) {
    this.id = id;
  }

  setMovementTuning(patch: Partial<MovementStepConfig>) {
    if (!patch || typeof patch !== 'object') return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      (this.movementTuning as any)[k] = v;
    }
    try {
      console.log('[TUNING_APPLIED]', {
        headingModeEnabled: this.movementTuning.headingModeEnabled,
        regimesEnabled: this.movementTuning.regimesEnabled,
        maxSpeed: this.movementTuning.maxSpeed ?? this.movementTuning.maxSpeedNoPuck,
        accel: this.movementTuning.accel,
        speedSplit: this.movementTuning.speedSplit
      });
    } catch {}
  }

  addClient(clientId: string, ws: WebSocket, name = 'Player') {
    const offset = this.players.size * 64;
    this.players.set(clientId, {
      id: clientId,
      name,
      x: -220 + offset,
      y: -120 + offset * 0.35,
      vx: 0,
      vy: 0,
      angle: 0,
      moveAngle: 0,
      baseBodyAngle: 0,
      bodyYawOffset: 0,
      aimAngleRaw: 0,
      aimAngle: 0,
      stickAngVel: 0,
      stamina: 1,
      heading: 0,
      prevHasInput: false,
      brakeAssistLeft: 0,
      startLinearActive: false,
      stickSide: 1,
      prevShoot: false,
      shotCharge: 0,
      lastProcessedSeq: 0,
      lastInputState: { ...ZERO_INPUT },
      inputBuffer: []
    });
    this.sockets.set(clientId, ws);
  }

  removeClient(clientId: string) {
    this.players.delete(clientId);
    this.sockets.delete(clientId);
  }

  enqueueInput(clientId: string, input: InputMsg) {
    const player = this.players.get(clientId);
    if (!player) return;
    if (input.clientId !== clientId) return;
    if (input.seq <= player.lastProcessedSeq) return;

    const buffered: BufferedInput = {
      seq: input.seq,
      state: {
        moveX: input.moveX < 0 ? -1 : input.moveX > 0 ? 1 : 0,
        moveY: input.moveY < 0 ? -1 : input.moveY > 0 ? 1 : 0,
        sprint: input.sprint ? 1 : 0,
        brake: input.brake ? 1 : 0,
        shoot: input.shoot ? 1 : 0,
        aimAngleRaw: typeof input.aimAngleRaw === 'number'
          ? input.aimAngleRaw
          : (typeof input.aimAngle === 'number' ? input.aimAngle : player.aimAngleRaw ?? player.aimAngle),
        aimDistance01: typeof input.aimDistance01 === 'number'
          ? clamp(input.aimDistance01, 0, 1)
          : 1,
        bodyTurn: typeof input.bodyTurn === 'number'
          ? clamp(input.bodyTurn, -1, 1)
          : 0
      }
    };

    player.inputBuffer.push(buffered);
    player.inputBuffer.sort((a, b) => a.seq - b.seq);
    if (player.inputBuffer.length > 256) {
      player.inputBuffer.splice(0, player.inputBuffer.length - 256);
    }
  }

  step(dt: number) {
    this.serverTick += 1;

    for (const player of this.players.values()) {
      const next = this.consumeNextInput(player);
      if (next) {
        player.lastInputState = next.state;
        player.lastProcessedSeq = next.seq;
      }

      const state: MovementStepState = {
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        stamina: player.stamina,
        aimAngle: player.aimAngle,
        aimAngleRaw: player.aimAngleRaw,
        stickAngVel: player.stickAngVel,
        moveAngle: player.moveAngle,
        baseBodyAngle: player.baseBodyAngle,
        bodyYawOffset: player.bodyYawOffset,
        bodyAngle: player.angle,
        heading: player.heading,
        prevHasInput: player.prevHasInput,
        brakeAssistLeft: player.brakeAssistLeft,
        startLinearActive: player.startLinearActive,
        stickSide: player.stickSide
      };

      applyMovementStep(
        state,
        {
          moveX: player.lastInputState.moveX,
          moveY: player.lastInputState.moveY,
          aimAngleRaw: player.lastInputState.aimAngleRaw,
          aimDistance01: player.lastInputState.aimDistance01,
          bodyTurn: player.lastInputState.bodyTurn,
          buttons: {
            sprint: !!player.lastInputState.sprint,
            brake: !!player.lastInputState.brake
          }
        },
        dt,
        this.movementTuning
      );

      player.x = state.x;
      player.y = state.y;
      player.vx = state.vx;
      player.vy = state.vy;
      player.stamina = state.stamina;
      player.heading = state.heading;
      player.moveAngle = Number.isFinite(state.moveAngle) ? state.moveAngle! : (Number.isFinite(player.heading) ? player.heading! : player.moveAngle);
      player.baseBodyAngle = Number.isFinite(state.baseBodyAngle) ? state.baseBodyAngle! : player.baseBodyAngle;
      player.bodyYawOffset = Number.isFinite(state.bodyYawOffset) ? state.bodyYawOffset! : player.bodyYawOffset;
      player.aimAngleRaw = Number.isFinite(state.aimAngleRaw) ? state.aimAngleRaw! : player.aimAngleRaw;
      player.aimAngle = Number.isFinite(state.aimAngle) ? state.aimAngle : player.aimAngleRaw;
      player.stickAngVel = state.stickAngVel;
      player.prevHasInput = state.prevHasInput;
      player.brakeAssistLeft = state.brakeAssistLeft;
      player.startLinearActive = state.startLinearActive;
      player.stickSide = state.stickSide;
      if (Number.isFinite(state.bodyAngle)) {
        player.angle = state.bodyAngle!;
      } else {
        const mode = this.movementTuning.bodyFacingMode ?? 'MOVE_LAST';
        if (mode === 'AIM_WHEN_IDLE') {
          const hasInput = Math.hypot(player.lastInputState.moveX, player.lastInputState.moveY) > 0.0001;
          player.angle = hasInput ? player.moveAngle : player.aimAngle;
        } else if (mode === 'BLEND') {
          const maxSpeed = Math.max(1, this.movementTuning.maxSpeed ?? this.movementTuning.maxSpeedNoPuck ?? 1);
          const speedNorm = clamp(Math.hypot(player.vx, player.vy) / maxSpeed, 0, 1);
          player.angle = lerpAngle(player.aimAngle, player.moveAngle, speedNorm);
        } else {
          player.angle = player.moveAngle;
        }
      }
    }

    this.updatePuck(dt);
  }

  broadcastSnapshot() {
    const ack: Record<string, number> = {};
    for (const p of this.players.values()) ack[p.id] = p.lastProcessedSeq;

    const msg: SnapshotMsg = {
      type: 'snapshot',
      tick: this.serverTick,
      serverTick: this.serverTick,
      ack,
      puck: {
        state: this.puck.state,
        ownerId: this.puck.ownerId,
        x: this.puck.x,
        y: this.puck.y,
        vx: this.puck.vx,
        vy: this.puck.vy
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        angle: p.angle,
        moveAngle: p.moveAngle,
        baseBodyAngle: p.baseBodyAngle,
        bodyYawOffset: p.bodyYawOffset,
        aimAngleRaw: p.aimAngleRaw,
        aimAngle: p.aimAngle
      }))
    };

    this.broadcast(msg);
  }

  private stickTarget(player: PlayerState): Vec2 {
    const puckStick = resolvePuckStickTuning(this.movementTuning);
    const ang = player.aimAngle;
    const offsetX = puckStick.stickOffsetX;
    const offsetY = puckStick.stickOffsetY;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    return {
      x: player.x + offsetX * cos - offsetY * sin,
      y: player.y + offsetX * sin + offsetY * cos
    };
  }

  private updatePuck(dt: number) {
    const puckStick = resolvePuckStickTuning(this.movementTuning);
    const pickupRadius = puckStick.pickupRadius;
    const pickupMaxSpeed = puckStick.pickupMaxPuckSpeed;
    const pickupMaxRelativeSpeed = puckStick.pickupMaxRelativeSpeed;
    const magnetRadius = puckStick.magnetRadius;
    const magnetStrength = puckStick.magnetStrength;
    const magnetMaxForce = puckStick.magnetMaxForce;
    const holdSpringK = puckStick.holdSpringK;
    const holdDampingC = puckStick.holdDampingC;
    const holdMaxError = puckStick.holdMaxError;
    const pickupCooldownMs = puckStick.pickupCooldownMs;
    const shotBaseImpulse = puckStick.shotBaseImpulse;
    const shotChargeRate = puckStick.shotChargeRate;
    const shotChargeMult = puckStick.shotChargeMult;
    const shotMaxImpulse = puckStick.shotMaxImpulse;
    const shotMinHoldMs = puckStick.shotMinHoldMs;
    const maxSpeed = puckStick.maxSpeed;
    const linearDamping = puckStick.linearDamping;
    const restitution = puckStick.restitution;
    const surfaceDrag = puckStick.surfaceDrag;

    this.puck.pickupCooldownMs = Math.max(0, this.puck.pickupCooldownMs - dt * 1000);

    if (this.puck.state === 'HELD' && this.puck.ownerId) {
      const owner = this.players.get(this.puck.ownerId);
      if (!owner) {
        this.puck.state = 'FREE';
        this.puck.ownerId = null;
      } else {
        const shooting = !!owner.lastInputState.shoot;
        const justPressedShoot = shooting && !owner.prevShoot;
        const justReleasedShoot = !shooting && owner.prevShoot;

        if (justPressedShoot) owner.shotCharge = 0;
        if (shooting) owner.shotCharge = clamp(owner.shotCharge + shotChargeRate * dt, 0, 1);

        const target = this.stickTarget(owner);
        const dx = target.x - this.puck.x;
        const dy = target.y - this.puck.y;
        const fx = dx * holdSpringK - this.puck.vx * holdDampingC;
        const fy = dy * holdSpringK - this.puck.vy * holdDampingC;
        this.puck.vx += fx * dt;
        this.puck.vy += fy * dt;
        this.puck.x += this.puck.vx * dt;
        this.puck.y += this.puck.vy * dt;

        const err = Math.hypot(dx, dy);
        if (err > holdMaxError) {
          this.puck.state = 'FREE';
          this.puck.ownerId = null;
          this.puck.pickupCooldownMs = Math.max(this.puck.pickupCooldownMs, 80);
        }

        if (justReleasedShoot && owner.shotCharge * 1000 >= shotMinHoldMs) {
          const ang = owner.aimAngle;
          const impulse = clamp(shotBaseImpulse + owner.shotCharge * shotChargeMult, 0, shotMaxImpulse);
          this.puck.vx += Math.cos(ang) * impulse;
          this.puck.vy += Math.sin(ang) * impulse;
          this.puck.state = 'FREE';
          this.puck.ownerId = null;
          this.puck.pickupCooldownMs = pickupCooldownMs;
          owner.shotCharge = 0;
        }

        owner.prevShoot = shooting;
      }
    }

    if (this.puck.state === 'FREE') {
      if (this.puck.pickupCooldownMs <= 0 && magnetRadius > 0 && magnetStrength > 0) {
        let bestTarget: Vec2 | null = null;
        let bestDist = Infinity;
        for (const player of this.players.values()) {
          const t = this.stickTarget(player);
          const d = Math.hypot(this.puck.x - t.x, this.puck.y - t.y);
          if (d < magnetRadius && d < bestDist) {
            bestDist = d;
            bestTarget = t;
          }
        }
        if (bestTarget) {
          const dx = bestTarget.x - this.puck.x;
          const dy = bestTarget.y - this.puck.y;
          const dist = Math.max(0.0001, Math.hypot(dx, dy));
          const falloff = 1 - clamp(dist / magnetRadius, 0, 1);
          const force = Math.min(magnetMaxForce, magnetStrength * falloff);
          this.puck.vx += (dx / dist) * force * dt;
          this.puck.vy += (dy / dist) * force * dt;
        }
      }

      const damp = Math.exp(-linearDamping * dt);
      this.puck.vx *= damp;
      this.puck.vy *= damp;
      this.puck.vx *= 1 - clamp(surfaceDrag, 0, 0.95) * dt * 60;
      this.puck.vy *= 1 - clamp(surfaceDrag, 0, 0.95) * dt * 60;

      const speed = Math.hypot(this.puck.vx, this.puck.vy);
      if (speed > maxSpeed) {
        const k = maxSpeed / Math.max(1, speed);
        this.puck.vx *= k;
        this.puck.vy *= k;
      }

      this.puck.x += this.puck.vx * dt;
      this.puck.y += this.puck.vy * dt;

      if (this.puck.x < RINK.left) {
        this.puck.x = RINK.left;
        this.puck.vx = Math.abs(this.puck.vx) * restitution;
      } else if (this.puck.x > RINK.right) {
        this.puck.x = RINK.right;
        this.puck.vx = -Math.abs(this.puck.vx) * restitution;
      }
      if (this.puck.y < RINK.top) {
        this.puck.y = RINK.top;
        this.puck.vy = Math.abs(this.puck.vy) * restitution;
      } else if (this.puck.y > RINK.bottom) {
        this.puck.y = RINK.bottom;
        this.puck.vy = -Math.abs(this.puck.vy) * restitution;
      }

      if (this.puck.pickupCooldownMs <= 0) {
        let bestId: string | null = null;
        let bestDist = Infinity;
        for (const player of this.players.values()) {
          const t = this.stickTarget(player);
          const d = Math.hypot(this.puck.x - t.x, this.puck.y - t.y);
          const relSpeed = Math.hypot(this.puck.vx - player.vx, this.puck.vy - player.vy);
          const canCapture = relSpeed <= pickupMaxRelativeSpeed || speed <= pickupMaxSpeed;
          if (d < pickupRadius && canCapture && d < bestDist) {
            bestDist = d;
            bestId = player.id;
          }
        }
        if (bestId) {
          this.puck.state = 'HELD';
          this.puck.ownerId = bestId;
          const owner = this.players.get(bestId);
          if (owner) {
            owner.shotCharge = 0;
            owner.prevShoot = !!owner.lastInputState.shoot;
          }
        }
      }
    }
  }

  private consumeNextInput(player: PlayerState): BufferedInput | null {
    if (player.inputBuffer.length === 0) return null;

    while (player.inputBuffer.length > 0 && player.inputBuffer[0].seq <= player.lastProcessedSeq) {
      player.inputBuffer.shift();
    }
    if (player.inputBuffer.length === 0) return null;

    if (player.inputBuffer[0].seq === player.lastProcessedSeq + 1) {
      return player.inputBuffer.shift() ?? null;
    }

    return null;
  }

  private broadcast(message: ServerMessage) {
    const raw = JSON.stringify(message);
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    }
  }
}


