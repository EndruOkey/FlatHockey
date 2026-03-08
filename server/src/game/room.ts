import type { InputMsg, ServerMessage, SnapshotMsg } from '@flathockey/shared';
import { applyMovementStep, type MovementStepConfig, type MovementStepState } from '@flathockey/shared/sim/movementStep';
import { WebSocket } from 'ws';
import { dropPuckFrom, resolveBoardHits, resolvePlayerContacts, stickTarget, updatePuck } from './roomSystems';
import { clamp, lerpAngle } from './roomMath';

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
  headingOmega: number;
  desiredHeadingAngle: number;
  movementModelActive: 'LEGACY' | 'V3' | 'V4' | 'SKATE_STEERING' | 'DESIRED_HEADING_TRACTION';
  inputAngle: number;
  desiredDirX: number;
  desiredDirY: number;
  committedDirX: number;
  committedDirY: number;
  distanceSinceCommit: number;
  reverseDriveState: 'NORMAL' | 'TRANSITION_TO_REVERSE' | 'REVERSE_READY';
  commitNoInputTimer: number;
  reverseTransitionActive: boolean;
  reverseTransitionTimer: number;
  pendingDirX: number;
  pendingDirY: number;
  directionCommitTimer: number;
  oppositeHoldTimer: number;
  carveLockTimer: number;
  carveSwitchCooldownTimer: number;
  carveSide: -1 | 0 | 1;
  movementPhase: 'GLIDE' | 'CARVE_LEFT' | 'CARVE_RIGHT' | 'BRAKE';
  startCommitTimer: number;
  startNoInputTimer: number;
  startupOppositeLockTimer: number;
  startupLatchActive: boolean;
  startupReleaseTimer: number;
  startDirX: number;
  startDirY: number;
  lastStableTravelAngle: number;
  lastRawInputAngle: number;
  antiFlipTimer: number;
  baseBodyAngle: number;
  bodyYawOffset: number;
  bodyTargetAngle: number;
  aimAngleRaw: number;
  aimAngle: number;
  stickAngVel?: number;
  stickLocalAngle?: number;
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
  inputGapTicks: number;
  chargeActive: boolean;
  hitCooldownLeft: number;
  stunLeft: number;
};

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
      headingOmega: 0,
      desiredHeadingAngle: 0,
      movementModelActive: 'DESIRED_HEADING_TRACTION',
      inputAngle: 0,
      desiredDirX: 1,
      desiredDirY: 0,
      committedDirX: 1,
      committedDirY: 0,
      distanceSinceCommit: 0,
      reverseDriveState: 'NORMAL',
      commitNoInputTimer: 0,
      reverseTransitionActive: false,
      reverseTransitionTimer: 0,
      pendingDirX: 1,
      pendingDirY: 0,
      directionCommitTimer: 0,
      oppositeHoldTimer: 0,
      carveLockTimer: 0,
      carveSwitchCooldownTimer: 0,
      carveSide: 0,
      movementPhase: 'GLIDE',
      startCommitTimer: 0,
      startNoInputTimer: 0,
      startupOppositeLockTimer: 0,
      startupLatchActive: false,
      startupReleaseTimer: 0,
      startDirX: 1,
      startDirY: 0,
      lastStableTravelAngle: 0,
      lastRawInputAngle: 0,
      antiFlipTimer: 0,
      baseBodyAngle: 0,
      bodyYawOffset: 0,
      bodyTargetAngle: 0,
      aimAngleRaw: 0,
      aimAngle: 0,
      stickAngVel: 0,
      stickLocalAngle: 0,
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
      inputBuffer: [],
      inputGapTicks: 0,
      chargeActive: false,
      hitCooldownLeft: 0,
      stunLeft: 0
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
        bodyTurn: 0
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
      player.hitCooldownLeft = Math.max(0, player.hitCooldownLeft - dt);
      player.stunLeft = Math.max(0, player.stunLeft - dt);
      const next = this.consumeNextInput(player);
      if (next) {
        player.lastInputState = next.state;
        player.lastProcessedSeq = next.seq;
        player.inputGapTicks = 0;
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
        headingOmega: player.headingOmega,
        desiredHeadingAngle: player.desiredHeadingAngle,
        movementModelActive: player.movementModelActive,
        inputAngle: player.inputAngle,
        desiredDirX: player.desiredDirX,
        desiredDirY: player.desiredDirY,
        committedDirX: player.committedDirX,
        committedDirY: player.committedDirY,
        distanceSinceCommit: player.distanceSinceCommit,
        reverseDriveState: player.reverseDriveState,
        commitNoInputTimer: player.commitNoInputTimer,
        reverseTransitionActive: player.reverseTransitionActive,
        reverseTransitionTimer: player.reverseTransitionTimer,
        pendingDirX: player.pendingDirX,
        pendingDirY: player.pendingDirY,
        directionCommitTimer: player.directionCommitTimer,
        oppositeHoldTimer: player.oppositeHoldTimer,
        carveLockTimer: player.carveLockTimer,
        carveSwitchCooldownTimer: player.carveSwitchCooldownTimer,
        carveSide: player.carveSide,
        movementPhase: player.movementPhase,
        startCommitTimer: player.startCommitTimer,
        startNoInputTimer: player.startNoInputTimer,
        startupOppositeLockTimer: player.startupOppositeLockTimer,
        startupLatchActive: player.startupLatchActive,
        startupReleaseTimer: player.startupReleaseTimer,
        startDirX: player.startDirX,
        startDirY: player.startDirY,
        lastStableTravelAngle: player.lastStableTravelAngle,
        lastRawInputAngle: player.lastRawInputAngle,
        antiFlipTimer: player.antiFlipTimer,
        baseBodyAngle: player.baseBodyAngle,
        bodyYawOffset: player.bodyYawOffset,
        bodyTargetAngle: player.bodyTargetAngle,
        bodyAngle: player.angle,
        heading: player.heading,
        prevHasInput: player.prevHasInput,
        brakeAssistLeft: player.brakeAssistLeft,
        startLinearActive: player.startLinearActive,
        stickSide: player.stickSide,
        stickLocalAngle: player.stickLocalAngle
      };

      const playerHasPuck = this.puck.state === 'HELD' && this.puck.ownerId === player.id;
      const chargeInputActive = !!player.lastInputState.sprint && !playerHasPuck && player.stunLeft <= 0;
      const movementInputX = player.stunLeft > 0 ? 0 : player.lastInputState.moveX;
      const movementInputY = player.stunLeft > 0 ? 0 : player.lastInputState.moveY;
      applyMovementStep(
        state,
        {
          moveX: movementInputX,
          moveY: movementInputY,
          aimAngleRaw: player.lastInputState.aimAngleRaw,
          aimDistance01: player.lastInputState.aimDistance01,
          bodyTurn: 0,
          buttons: {
            sprint: chargeInputActive,
            brake: !!player.lastInputState.brake
          }
        },
        dt,
        {
          ...this.movementTuning,
          hasPuck: playerHasPuck
        }
      );

      player.x = state.x;
      player.y = state.y;
      player.vx = state.vx;
      player.vy = state.vy;
      player.stamina = state.stamina;
      player.heading = state.heading;
      player.headingOmega = Number.isFinite(state.headingOmega) ? state.headingOmega! : player.headingOmega;
      player.desiredHeadingAngle = Number.isFinite(state.desiredHeadingAngle) ? state.desiredHeadingAngle! : player.desiredHeadingAngle;
      player.movementModelActive = state.movementModelActive === 'LEGACY' || state.movementModelActive === 'V3' || state.movementModelActive === 'V4' || state.movementModelActive === 'SKATE_STEERING'
        ? state.movementModelActive
        : 'DESIRED_HEADING_TRACTION';
      player.moveAngle = Number.isFinite(state.moveAngle) ? state.moveAngle! : (Number.isFinite(player.heading) ? player.heading! : player.moveAngle);
      player.inputAngle = Number.isFinite(state.inputAngle) ? state.inputAngle! : player.inputAngle;
      player.desiredDirX = Number.isFinite(state.desiredDirX) ? state.desiredDirX! : player.desiredDirX;
      player.desiredDirY = Number.isFinite(state.desiredDirY) ? state.desiredDirY! : player.desiredDirY;
      player.committedDirX = Number.isFinite(state.committedDirX) ? state.committedDirX! : player.committedDirX;
      player.committedDirY = Number.isFinite(state.committedDirY) ? state.committedDirY! : player.committedDirY;
      player.distanceSinceCommit = Number.isFinite(state.distanceSinceCommit) ? state.distanceSinceCommit! : player.distanceSinceCommit;
      player.reverseDriveState = state.reverseDriveState === 'TRANSITION_TO_REVERSE' || state.reverseDriveState === 'REVERSE_READY'
        ? state.reverseDriveState
        : 'NORMAL';
      player.commitNoInputTimer = Number.isFinite(state.commitNoInputTimer) ? state.commitNoInputTimer! : player.commitNoInputTimer;
      player.reverseTransitionActive = !!state.reverseTransitionActive;
      player.reverseTransitionTimer = Number.isFinite(state.reverseTransitionTimer) ? state.reverseTransitionTimer! : player.reverseTransitionTimer;
      player.pendingDirX = Number.isFinite(state.pendingDirX) ? state.pendingDirX! : player.pendingDirX;
      player.pendingDirY = Number.isFinite(state.pendingDirY) ? state.pendingDirY! : player.pendingDirY;
      player.directionCommitTimer = Number.isFinite(state.directionCommitTimer) ? state.directionCommitTimer! : player.directionCommitTimer;
      player.oppositeHoldTimer = Number.isFinite(state.oppositeHoldTimer) ? state.oppositeHoldTimer! : player.oppositeHoldTimer;
      player.carveLockTimer = Number.isFinite(state.carveLockTimer) ? state.carveLockTimer! : player.carveLockTimer;
      player.carveSwitchCooldownTimer = Number.isFinite(state.carveSwitchCooldownTimer) ? state.carveSwitchCooldownTimer! : player.carveSwitchCooldownTimer;
      player.carveSide = state.carveSide === -1 || state.carveSide === 1 ? state.carveSide : 0;
      player.movementPhase = state.movementPhase ?? player.movementPhase;
      player.startCommitTimer = Number.isFinite(state.startCommitTimer) ? state.startCommitTimer! : player.startCommitTimer;
      player.startNoInputTimer = Number.isFinite(state.startNoInputTimer) ? state.startNoInputTimer! : player.startNoInputTimer;
      player.startupOppositeLockTimer = Number.isFinite(state.startupOppositeLockTimer) ? state.startupOppositeLockTimer! : player.startupOppositeLockTimer;
      player.startupLatchActive = !!state.startupLatchActive;
      player.startupReleaseTimer = Number.isFinite(state.startupReleaseTimer) ? state.startupReleaseTimer! : player.startupReleaseTimer;
      player.startDirX = Number.isFinite(state.startDirX) ? state.startDirX! : player.startDirX;
      player.startDirY = Number.isFinite(state.startDirY) ? state.startDirY! : player.startDirY;
      player.lastStableTravelAngle = Number.isFinite(state.lastStableTravelAngle) ? state.lastStableTravelAngle! : player.lastStableTravelAngle;
      player.lastRawInputAngle = Number.isFinite(state.lastRawInputAngle) ? state.lastRawInputAngle! : player.lastRawInputAngle;
      player.antiFlipTimer = Number.isFinite(state.antiFlipTimer) ? state.antiFlipTimer! : player.antiFlipTimer;
      player.baseBodyAngle = Number.isFinite(state.baseBodyAngle) ? state.baseBodyAngle! : player.baseBodyAngle;
      player.bodyYawOffset = Number.isFinite(state.bodyYawOffset) ? state.bodyYawOffset! : player.bodyYawOffset;
      player.bodyTargetAngle = Number.isFinite(state.bodyTargetAngle) ? state.bodyTargetAngle! : player.bodyTargetAngle;
      player.aimAngleRaw = Number.isFinite(state.aimAngleRaw) ? state.aimAngleRaw! : player.aimAngleRaw;
      player.aimAngle = Number.isFinite(state.aimAngle) ? state.aimAngle : player.aimAngleRaw;
      player.stickAngVel = state.stickAngVel;
      player.stickLocalAngle = Number.isFinite(state.stickLocalAngle) ? state.stickLocalAngle! : player.stickLocalAngle;
      player.prevHasInput = state.prevHasInput;
      player.brakeAssistLeft = state.brakeAssistLeft;
      player.startLinearActive = state.startLinearActive;
      player.stickSide = state.stickSide;
      player.chargeActive = !!state.debugChargeActive && player.stunLeft <= 0;
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

    this.resolvePlayerContacts();
    this.resolveBoardHits();
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
        heading: p.heading,
        headingOmega: p.headingOmega,
        desiredHeadingAngle: p.desiredHeadingAngle,
        movementModelActive: p.movementModelActive,
        inputAngle: p.inputAngle,
        desiredDirX: p.desiredDirX,
        desiredDirY: p.desiredDirY,
        committedDirX: p.committedDirX,
        committedDirY: p.committedDirY,
        distanceSinceCommit: p.distanceSinceCommit,
        reverseDriveState: p.reverseDriveState,
        reverseTransitionActive: p.reverseTransitionActive,
        reverseTransitionTimer: p.reverseTransitionTimer,
        pendingDirX: p.pendingDirX,
        pendingDirY: p.pendingDirY,
        directionCommitTimer: p.directionCommitTimer,
        oppositeHoldTimer: p.oppositeHoldTimer,
        carveLockTimer: p.carveLockTimer,
        carveSwitchCooldownTimer: p.carveSwitchCooldownTimer,
        carveSide: p.carveSide,
        movementPhase: p.movementPhase,
        startCommitTimer: p.startCommitTimer,
        startupOppositeLockTimer: p.startupOppositeLockTimer,
        startupLatchActive: p.startupLatchActive,
        startupReleaseTimer: p.startupReleaseTimer,
        startDirX: p.startDirX,
        startDirY: p.startDirY,
        lastStableTravelAngle: p.lastStableTravelAngle,
        lastRawInputAngle: p.lastRawInputAngle,
        antiFlipTimer: p.antiFlipTimer,
        baseBodyAngle: p.baseBodyAngle,
        bodyTargetAngle: p.bodyTargetAngle,
        bodyYawOffset: p.bodyYawOffset,
        aimAngleRaw: p.aimAngleRaw,
        aimAngle: p.aimAngle,
        chargeActive: p.chargeActive,
        stunLeft: p.stunLeft
      }))
    };

    this.broadcast(msg);
  }

  private stickTarget(player: PlayerState) {
    return stickTarget(this, player);
  }

  private updatePuck(dt: number) {
    updatePuck(this, dt);
  }

  private dropPuckFrom(playerId: string | null) {
    dropPuckFrom(this, playerId);
  }

  private resolvePlayerContacts() {
    resolvePlayerContacts(this);
  }

  private resolveBoardHits() {
    resolveBoardHits(this);
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

    // Recover from reconnect/session resets or any stale gap instead of deadlocking ack forever.
    if (player.lastProcessedSeq === 0) {
      return player.inputBuffer.shift() ?? null;
    }
    player.inputGapTicks += 1;
    if (player.inputGapTicks >= 10) {
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


