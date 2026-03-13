export type StickState =
  | 'neutral'
  | 'control'
  | 'turning'
  | 'poke'
  | 'pass'
  | 'charge'
  | 'release';

export type SemiPhysicalStickPose = {
  state: StickState;
  gripX: number;
  gripY: number;
  bladeBaseX: number;
  bladeBaseY: number;
  bladeCenterX: number;
  bladeCenterY: number;
  bladeTipX: number;
  bladeTipY: number;
  assistX: number;
  assistY: number;
  bodyX: number;
  bodyY: number;
  bladeForwardX: number;
  bladeForwardY: number;
  bladeZoneRadius: number;
  assistZoneRadius: number;
  bodyZoneRadius: number;
  controlStability: number;
};

export const SEMI_PHYSICAL_STICK_CONFIG = {
  gripForwardOffset: 6,
  shaftLength: 14,
  bladeLength: 12,
  bladeCenterOffset: 6,
  assistBackOffset: 3.5,
  bladeZoneRadius: 10,
  assistZoneRadius: 17,
  bodyZoneRadiusScale: 0.82,
  turningPenaltyAngularSpeed: 4.2,
  turningPenaltyRange: 5.6,
  maxTurningPenalty: 0.18,
  chargeRetractDistance: 4.5,
  chargePuckLeadDistance: 3.5,
  chargeStabilityPenalty: 0.16,
  passForwardBoost: 2.5,
  releaseForwardBoost: 3,
  pokeExtendDistance: 10,
  pokeExtraBladeLength: 4,
  pokeDurationSec: 0.12,
  pokeRecoverySec: 0.16,
  releaseDurationSec: 0.08,
  passDurationSec: 0.06,
  passImpulse: 220,
  pokeImpulse: 180
} as const;

export function computeSemiPhysicalStickPose(input: {
  playerX: number;
  playerY: number;
  bodyAngle: number;
  aimAngle: number;
  playerRadius: number;
  state?: StickState;
  shotCharge?: number;
  stateTimerSec?: number;
  angularVelocity?: number;
}): SemiPhysicalStickPose {
  const bodyAngle = finiteOr(input.bodyAngle, 0);
  const aimAngle = finiteOr(input.aimAngle, bodyAngle);
  const playerRadius = Math.max(8, finiteOr(input.playerRadius, 18));
  const state = input.state ?? 'neutral';
  const shotCharge = clamp(finiteOr(input.shotCharge, 0), 0, 1);
  const stateTimerSec = Math.max(0, finiteOr(input.stateTimerSec, 0));
  const angularVelocity = Math.abs(finiteOr(input.angularVelocity, 0));
  const bodyForward = unitFromAngle(bodyAngle);
  const bladeForward = unitFromAngle(aimAngle);
  let shaftLength = SEMI_PHYSICAL_STICK_CONFIG.shaftLength;
  let bladeLength = SEMI_PHYSICAL_STICK_CONFIG.bladeLength;
  let bladeCenterOffset = SEMI_PHYSICAL_STICK_CONFIG.bladeCenterOffset;
  let forwardBoost = 0;
  let controlStability = 1;

  if (state === 'turning' || angularVelocity > SEMI_PHYSICAL_STICK_CONFIG.turningPenaltyAngularSpeed) {
    controlStability -= turningPenaltyFromAngularVelocity(angularVelocity);
  }

  switch (state) {
    case 'charge':
      shaftLength -= SEMI_PHYSICAL_STICK_CONFIG.chargeRetractDistance * shotCharge;
      // Keep the shaft visually retracting while the puck target still creeps forward on the blade.
      bladeCenterOffset +=
        (SEMI_PHYSICAL_STICK_CONFIG.chargeRetractDistance + SEMI_PHYSICAL_STICK_CONFIG.chargePuckLeadDistance) *
        shotCharge;
      controlStability -= SEMI_PHYSICAL_STICK_CONFIG.chargeStabilityPenalty * shotCharge;
      break;
    case 'pass':
      forwardBoost += SEMI_PHYSICAL_STICK_CONFIG.passForwardBoost;
      bladeCenterOffset += 1.5;
      controlStability -= 0.08;
      break;
    case 'release':
      forwardBoost +=
        SEMI_PHYSICAL_STICK_CONFIG.releaseForwardBoost *
        clamp(stateTimerSec / SEMI_PHYSICAL_STICK_CONFIG.releaseDurationSec, 0, 1);
      controlStability -= 0.1;
      break;
    case 'poke': {
      const pokeFactor = clamp(stateTimerSec / SEMI_PHYSICAL_STICK_CONFIG.pokeDurationSec, 0, 1);
      shaftLength += SEMI_PHYSICAL_STICK_CONFIG.pokeExtendDistance * pokeFactor;
      bladeLength += SEMI_PHYSICAL_STICK_CONFIG.pokeExtraBladeLength * pokeFactor;
      bladeCenterOffset += 2 * pokeFactor;
      controlStability -= 0.12;
      break;
    }
    default:
      break;
  }

  controlStability = clamp(controlStability, 0.58, 1);

  const gripForward = playerRadius * 0.35 + SEMI_PHYSICAL_STICK_CONFIG.gripForwardOffset;
  const gripX = input.playerX + bodyForward.x * gripForward;
  const gripY = input.playerY + bodyForward.y * gripForward;
  const bladeBaseX = gripX + bladeForward.x * (shaftLength + forwardBoost);
  const bladeBaseY = gripY + bladeForward.y * (shaftLength + forwardBoost);
  const bladeCenterX = bladeBaseX + bladeForward.x * bladeCenterOffset;
  const bladeCenterY = bladeBaseY + bladeForward.y * bladeCenterOffset;
  const bladeTipX = bladeBaseX + bladeForward.x * bladeLength;
  const bladeTipY = bladeBaseY + bladeForward.y * bladeLength;
  const assistX = bladeBaseX - bladeForward.x * SEMI_PHYSICAL_STICK_CONFIG.assistBackOffset;
  const assistY = bladeBaseY - bladeForward.y * SEMI_PHYSICAL_STICK_CONFIG.assistBackOffset;

  return {
    state,
    gripX,
    gripY,
    bladeBaseX,
    bladeBaseY,
    bladeCenterX,
    bladeCenterY,
    bladeTipX,
    bladeTipY,
    assistX,
    assistY,
    bodyX: input.playerX,
    bodyY: input.playerY,
    bladeForwardX: bladeForward.x,
    bladeForwardY: bladeForward.y,
    bladeZoneRadius: SEMI_PHYSICAL_STICK_CONFIG.bladeZoneRadius,
    assistZoneRadius: SEMI_PHYSICAL_STICK_CONFIG.assistZoneRadius,
    bodyZoneRadius: Math.max(10, playerRadius * SEMI_PHYSICAL_STICK_CONFIG.bodyZoneRadiusScale),
    controlStability
  };
}

export function turningPenaltyFromAngularVelocity(angularVelocity: number) {
  return (
    clamp(
      (angularVelocity - SEMI_PHYSICAL_STICK_CONFIG.turningPenaltyAngularSpeed) /
        Math.max(0.001, SEMI_PHYSICAL_STICK_CONFIG.turningPenaltyRange),
      0,
      1
    ) * SEMI_PHYSICAL_STICK_CONFIG.maxTurningPenalty
  );
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unitFromAngle(angle: number) {
  return {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
}
