import { approachAngle, lerp, smoothstep01, wrapToPi } from './movementMath';

type V4VelocityStepArgs = {
  vx: number;
  vy: number;
  hasInput: boolean;
  moveDrag: number;
  glideDrag: number;
  simDt: number;
  minTravelDirSpeed: number;
  lockedTravelAngle: number;
  baseLateralDamping: number;
  maxLateralDamping: number;
  edgeFactor: number;
  speedNorm: number;
  chargeActive: boolean;
  chargeLateralGripMul: number;
  brakeActive: boolean;
  brakeLateralDampingBonus: number;
  brakeDrag: number;
  carveLossStrength: number;
  speedBefore: number;
  prevVx: number;
  prevVy: number;
  turnLowSpeed: number;
  turnHighSpeed: number;
  brakeTurnBonusValue: number;
  edgeTurnBonusMax: number;
  finalMaxSpeed: number;
};

export function applyV4VelocityStep(args: V4VelocityStepArgs) {
  const dragFactor = Math.exp(-(args.hasInput ? args.moveDrag : args.glideDrag) * args.simDt);
  let vx = args.vx * dragFactor;
  let vy = args.vy * dragFactor;

  const speedAfterDrag = Math.hypot(vx, vy);
  const slipRef = speedAfterDrag >= args.minTravelDirSpeed ? Math.atan2(vy, vx) : args.lockedTravelAngle;
  const dfx = Math.cos(slipRef);
  const dfy = Math.sin(slipRef);
  const dsx = -dfy;
  const dsy = dfx;

  let forwardVel = vx * dfx + vy * dfy;
  let lateralVel = vx * dsx + vy * dsy;
  let lateralDamping = lerp(args.baseLateralDamping, args.maxLateralDamping, args.edgeFactor * lerp(0.4, 1, args.speedNorm));
  lateralDamping *= args.chargeActive ? args.chargeLateralGripMul : 1;
  if (args.brakeActive) lateralDamping += args.brakeLateralDampingBonus;
  lateralVel *= Math.exp(-lateralDamping * args.simDt);

  if (args.brakeActive) {
    const brakeFactor = Math.exp(-args.brakeDrag * args.simDt);
    forwardVel *= brakeFactor;
    lateralVel *= brakeFactor;
  }

  const carveLoss = Math.exp(-args.carveLossStrength * args.edgeFactor * args.simDt);
  forwardVel *= carveLoss;
  const candidateVx = dfx * forwardVel + dsx * lateralVel;
  const candidateVy = dfy * forwardVel + dsy * lateralVel;
  const candidateSpeed = Math.hypot(candidateVx, candidateVy);

  if (args.speedBefore > 0.001 && candidateSpeed > 0.001) {
    const prevDir = Math.atan2(args.prevVy, args.prevVx);
    const candDir = Math.atan2(candidateVy, candidateVx);
    const delta = Math.abs(wrapToPi(candDir - prevDir));
    const bigFlipNorm = smoothstep01((delta - (120 * Math.PI) / 180) / ((Math.PI - (120 * Math.PI) / 180)));
    const speedTurnBase = lerp(args.turnLowSpeed, args.turnHighSpeed, args.speedNorm);
    const brakeBoost = args.brakeActive ? args.brakeTurnBonusValue : 0;
    const antiFlipSlowdown = args.brakeActive ? lerp(1, 0.85, bigFlipNorm) : lerp(1, 0.25, bigFlipNorm);
    const maxTurnRate = Math.max(0.08, (speedTurnBase + args.edgeTurnBonusMax * args.edgeFactor + brakeBoost) * antiFlipSlowdown);
    const steppedDir = approachAngle(prevDir, candDir, maxTurnRate * args.simDt);
    vx = Math.cos(steppedDir) * candidateSpeed;
    vy = Math.sin(steppedDir) * candidateSpeed;
  } else {
    vx = candidateVx;
    vy = candidateVy;
  }

  const finalSpeed = Math.hypot(vx, vy);
  if (finalSpeed > args.finalMaxSpeed) {
    const k = args.finalMaxSpeed / finalSpeed;
    vx *= k;
    vy *= k;
  }

  return { vx, vy };
}

type DirectionalLimitArgs = {
  vx: number;
  vy: number;
  hasInput: boolean;
  intentForward: number;
  sideMaxSpeed: number;
  forwardMaxSpeed: number;
  reverseMaxSpeed: number;
  chargeActive: boolean;
  chargeSpeedMul: number;
};

export function applyDirectionalSpeedLimit(args: DirectionalLimitArgs) {
  const directionalSpeedScale = (() => {
    if (!args.hasInput) return 1;
    if (args.intentForward >= 0) return lerp(args.sideMaxSpeed / args.forwardMaxSpeed, 1, args.intentForward);
    return lerp(args.sideMaxSpeed / args.forwardMaxSpeed, args.reverseMaxSpeed / args.forwardMaxSpeed, -args.intentForward);
  })();
  const localMaxSpeed = Math.max(1, args.forwardMaxSpeed * directionalSpeedScale * (args.chargeActive ? args.chargeSpeedMul : 1));
  const speedAfterForces = Math.hypot(args.vx, args.vy);
  if (speedAfterForces <= localMaxSpeed) return { vx: args.vx, vy: args.vy };
  const k = localMaxSpeed / Math.max(1, speedAfterForces);
  return { vx: args.vx * k, vy: args.vy * k };
}

type TravelAngleArgs = {
  vx: number;
  vy: number;
  minTravelDirSpeed: number;
  lastStableTravelAngle: number;
  lowSpeedStartupActive: boolean;
};

export function computeTravelAngle(args: TravelAngleArgs) {
  const speedAfterSolve = Math.hypot(args.vx, args.vy);
  const nextStableTravelAngle = speedAfterSolve >= args.minTravelDirSpeed
    ? Math.atan2(args.vy, args.vx)
    : args.lastStableTravelAngle;
  const useLockedTravelAngle = args.lowSpeedStartupActive || speedAfterSolve < args.minTravelDirSpeed;
  const moveAngle = useLockedTravelAngle ? nextStableTravelAngle : Math.atan2(args.vy, args.vx);
  return { nextStableTravelAngle, useLockedTravelAngle, moveAngle };
}
