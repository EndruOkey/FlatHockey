import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { approachAngle, clamp, expBlend, lerp, smoothstep01, wrapToPi } from './movementMath';
import type { MovementV4Args, MovementV4Result } from './movementV4.types';

export function applyMovementV4Solver(args: MovementV4Args): MovementV4Result {
  const { state, input, dt, config, hasPuck, mouseDrivesMove, inputAimRaw, rawInputX, rawInputY, prevMoveAngle } = args;

  const simDt = clamp(dt, 0.001, 0.05);
  const rawLen = Math.hypot(rawInputX, rawInputY);
  const hasInput = rawLen > 0.0001;
  const rawNx = hasInput ? rawInputX / rawLen : 0;
  const rawNy = hasInput ? rawInputY / rawLen : 0;

  const chargeActive = !!input.buttons.sprint && !hasPuck;
  state.debugChargeActive = chargeActive;

  const inputVectorResponsiveness = Math.max(1, config.inputVectorResponsiveness ?? config.inputVectorTauMs ?? MOVEMENT_DEFAULTS.inputVectorResponsiveness ?? MOVEMENT_DEFAULTS.inputVectorTauMs ?? 95);
  const desiredRate = 1000 / inputVectorResponsiveness;
  const desiredAlpha = expBlend(desiredRate, simDt);

  const rawDriveAngle = hasInput
    ? wrapToPi(mouseDrivesMove ? inputAimRaw : Math.atan2(rawNy, rawNx))
    : (state.moveAngle ?? 0);
  const rawDriveX = Math.cos(rawDriveAngle);
  const rawDriveY = Math.sin(rawDriveAngle);

  const filteredXRaw = (state.desiredDirX ?? rawDriveX) + (rawDriveX - (state.desiredDirX ?? rawDriveX)) * desiredAlpha;
  const filteredYRaw = (state.desiredDirY ?? rawDriveY) + (rawDriveY - (state.desiredDirY ?? rawDriveY)) * desiredAlpha;
  const filteredMag = Math.hypot(filteredXRaw, filteredYRaw);
  const driveX = filteredMag > 0.0001 ? filteredXRaw / filteredMag : rawDriveX;
  const driveY = filteredMag > 0.0001 ? filteredYRaw / filteredMag : rawDriveY;
  state.desiredDirX = driveX;
  state.desiredDirY = driveY;
  state.pendingDirX = driveX;
  state.pendingDirY = driveY;

  const prevVx = state.vx;
  const prevVy = state.vy;
  const speedBefore = Math.hypot(prevVx, prevVy);
  const prevTravelAngle = speedBefore > 0.001
    ? Math.atan2(prevVy, prevVx)
    : (Number.isFinite(state.lastStableTravelAngle) ? state.lastStableTravelAngle! : rawDriveAngle);

  const turnRateBase = Math.max(0.05, config.turnRateBase ?? MOVEMENT_DEFAULTS.turnRateBase ?? 1.8);
  const turnRateSpeedScale = Math.max(0, config.turnRateSpeedScale ?? MOVEMENT_DEFAULTS.turnRateSpeedScale ?? 0.0065);
  const brakeTurnMult = Math.max(1, config.brakeTurnMult ?? MOVEMENT_DEFAULTS.brakeTurnMult ?? 1.8);
  let maxTurnRate = turnRateBase + speedBefore * turnRateSpeedScale;
  if (input.buttons.brake) maxTurnRate *= brakeTurnMult;

  const driveAngle = Math.atan2(driveY, driveX);
  const curvedTravelAngle = hasInput
    ? approachAngle(prevTravelAngle, driveAngle, maxTurnRate * simDt)
    : prevTravelAngle;
  const travelX = Math.cos(curvedTravelAngle);
  const travelY = Math.sin(curvedTravelAngle);

  const forwardAccel = Math.max(0, config.forwardAccel ?? MOVEMENT_DEFAULTS.forwardAccel ?? 1500);
  const lateralSteerForce = Math.max(0, config.lateralSteerForce ?? MOVEMENT_DEFAULTS.lateralSteerForce ?? 620);
  const reverseThreshold = clamp(config.reverseThreshold ?? MOVEMENT_DEFAULTS.reverseThreshold ?? -0.4, -0.98, -0.05);
  const reverseAccelMult = clamp(config.reverseAccelMult ?? MOVEMENT_DEFAULTS.reverseAccelMult ?? 0.28, 0, 1);
  const reverseBrakeBonus = Math.max(0, config.reverseBrakeBonus ?? MOVEMENT_DEFAULTS.reverseBrakeBonus ?? 3.5);

  const driveDotTravel = hasInput ? clamp(driveX * travelX + driveY * travelY, -1, 1) : 0;
  const driveSide = hasInput ? (travelX * driveY - travelY * driveX) : 0;
  const reverseT = driveDotTravel < reverseThreshold
    ? smoothstep01((reverseThreshold - driveDotTravel) / Math.max(1 + reverseThreshold, 0.0001))
    : 0;

  const accelScale = lerp(1, reverseAccelMult, reverseT);
  const forwardIntent = hasInput ? driveDotTravel : 0;
  const forwardForce = forwardAccel * accelScale * (forwardIntent >= 0 ? forwardIntent : forwardIntent * 0.15);
  const lateralForce = lateralSteerForce * driveSide * (input.buttons.brake ? 1.25 : 1);

  if (hasInput) {
    state.vx += (travelX * forwardForce + (-travelY) * lateralForce) * simDt;
    state.vy += (travelY * forwardForce + travelX * lateralForce) * simDt;
  }

  const forwardMaxSpeed = Math.max(1, config.forwardMaxSpeed ?? MOVEMENT_DEFAULTS.forwardMaxSpeed ?? 342.5);
  const sideMaxSpeed = clamp(config.sideMaxSpeed ?? MOVEMENT_DEFAULTS.sideMaxSpeed ?? forwardMaxSpeed * 0.85, 1, forwardMaxSpeed);
  const reverseMaxSpeed = clamp(config.reverseMaxSpeed ?? MOVEMENT_DEFAULTS.reverseMaxSpeed ?? forwardMaxSpeed * 0.7, 1, forwardMaxSpeed);
  const chargeSpeedMul = Math.max(1, config.chargeSpeedMul ?? MOVEMENT_DEFAULTS.chargeSpeedMul ?? 1.2);

  const directionalSpeedScale = (() => {
    if (!hasInput) return 1;
    if (driveDotTravel >= 0) return lerp(sideMaxSpeed / forwardMaxSpeed, 1, driveDotTravel);
    return lerp(sideMaxSpeed / forwardMaxSpeed, reverseMaxSpeed / forwardMaxSpeed, -driveDotTravel);
  })();
  const localMaxSpeed = Math.max(1, forwardMaxSpeed * directionalSpeedScale * (chargeActive ? chargeSpeedMul : 1));
  const speedAfterForces = Math.hypot(state.vx, state.vy);
  if (speedAfterForces > localMaxSpeed) {
    const k = localMaxSpeed / Math.max(1, speedAfterForces);
    state.vx *= k;
    state.vy *= k;
  }

  const moveDrag = Math.max(0, config.moveDrag ?? MOVEMENT_DEFAULTS.moveDrag ?? 2.6);
  const glideDrag = Math.max(0, config.glideDrag ?? MOVEMENT_DEFAULTS.glideDrag ?? 0.96909);
  const brakeDrag = Math.max(0, config.brakeDrag ?? MOVEMENT_DEFAULTS.brakeDrag ?? 4.8);
  const baseLateralDamping = Math.max(0, config.baseLateralDamping ?? MOVEMENT_DEFAULTS.baseLateralDamping ?? 0.18);
  const maxLateralDamping = Math.max(baseLateralDamping, config.maxLateralDamping ?? MOVEMENT_DEFAULTS.maxLateralDamping ?? 1.35);
  const brakeLateralDampingBonus = Math.max(0, config.brakeLateralDampingBonus ?? MOVEMENT_DEFAULTS.brakeLateralDampingBonus ?? 0.65);
  const carveLossStrength = Math.max(0, config.carveLossStrength ?? MOVEMENT_DEFAULTS.carveLossStrength ?? 0.42);

  const baseDrag = hasInput ? moveDrag : glideDrag;
  state.vx *= Math.exp(-baseDrag * simDt);
  state.vy *= Math.exp(-baseDrag * simDt);

  const speedAfterDrag = Math.hypot(state.vx, state.vy);
  const minTravelDirSpeed = Math.max(0.001, config.minTravelDirSpeed ?? MOVEMENT_DEFAULTS.minTravelDirSpeed ?? 55);
  const slipRef = speedAfterDrag >= minTravelDirSpeed ? Math.atan2(state.vy, state.vx) : curvedTravelAngle;
  const sfx = Math.cos(slipRef);
  const sfy = Math.sin(slipRef);
  const stx = -sfy;
  const sty = sfx;

  let forwardVel = state.vx * sfx + state.vy * sfy;
  let sideVel = state.vx * stx + state.vy * sty;
  let lateralDamping = lerp(baseLateralDamping, maxLateralDamping, clamp(speedAfterDrag / Math.max(forwardMaxSpeed, 1), 0, 1));
  if (input.buttons.brake) lateralDamping += brakeLateralDampingBonus;
  lateralDamping += reverseT * reverseBrakeBonus;
  sideVel *= Math.exp(-lateralDamping * simDt);

  if (input.buttons.brake || reverseT > 0) {
    const dynBrake = brakeDrag + reverseT * reverseBrakeBonus;
    const brakeFactor = Math.exp(-dynBrake * simDt);
    forwardVel *= brakeFactor;
    sideVel *= brakeFactor;
  }

  forwardVel *= Math.exp(-carveLossStrength * clamp(Math.abs(driveSide), 0, 1) * simDt);
  state.vx = sfx * forwardVel + stx * sideVel;
  state.vy = sfy * forwardVel + sty * sideVel;

  const finalSpeed = Math.hypot(state.vx, state.vy);
  const finalMaxSpeed = Math.max(1, forwardMaxSpeed * (chargeActive ? chargeSpeedMul : 1));
  if (finalSpeed > finalMaxSpeed) {
    const k = finalMaxSpeed / finalSpeed;
    state.vx *= k;
    state.vy *= k;
  }

  const prevX = state.x;
  const prevY = state.y;
  state.x += state.vx * simDt;
  state.y += state.vy * simDt;

  const moved = Math.hypot(state.x - prevX, state.y - prevY);
  state.distanceSinceCommit = Math.max(0, (state.distanceSinceCommit ?? 0) + moved);
  state.commitNoInputTimer = hasInput ? 0 : Math.max(0, (state.commitNoInputTimer ?? 0) + simDt);
  state.committedDirX = travelX;
  state.committedDirY = travelY;

  const speedAfterSolve = Math.hypot(state.vx, state.vy);
  const stableTravelAngle = speedAfterSolve >= minTravelDirSpeed
    ? Math.atan2(state.vy, state.vx)
    : (Number.isFinite(state.lastStableTravelAngle) ? state.lastStableTravelAngle! : curvedTravelAngle);
  state.lastStableTravelAngle = stableTravelAngle;
  state.moveAngle = stableTravelAngle;
  state.heading = stableTravelAngle;
  state.inputAngle = driveAngle;

  const velocityDesiredDelta = wrapToPi(driveAngle - stableTravelAngle);
  state.debugRawInputAngle = rawDriveAngle;
  state.debugDesiredMoveAngle = driveAngle;
  state.debugTurnIntentAngle = curvedTravelAngle;
  state.debugVelocityDesiredDeltaDeg = velocityDesiredDelta * (180 / Math.PI);
  state.debugMoveTurnRateAppliedDeg = Math.abs(wrapToPi(stableTravelAngle - prevMoveAngle)) * (180 / Math.PI) / Math.max(simDt, 0.0001);
  state.debugTurnResistance = clamp(reverseT, 0, 1);
  state.debugRedirectAccelScale = accelScale;
  state.debugDesiredInputX = driveX;
  state.debugDesiredInputY = driveY;
  state.debugRequestedInputDirX = driveX;
  state.debugRequestedInputDirY = driveY;
  state.debugFilteredInputX = driveX;
  state.debugFilteredInputY = driveY;
  state.debugAppliedForwardForce = hasInput ? forwardForce : 0;
  state.debugAppliedLateralForce = hasInput ? lateralForce : 0;
  state.debugSteerDirX = travelX;
  state.debugSteerDirY = travelY;
  state.debugEffectiveStartDirX = travelX;
  state.debugEffectiveStartDirY = travelY;
  state.debugSignedInputVsVelocityAngle = Math.atan2(driveSide, driveDotTravel);
  state.debugEdgeFactor = clamp(Math.abs(driveSide), 0, 1);
  state.debugTravelDirLocked = speedAfterSolve < minTravelDirSpeed;
  state.debugMajorDirectionChangeBlocked = false;
  state.debugBrakeActive = !!input.buttons.brake;
  state.debugCommitTimer = 0;
  state.debugOppositeHoldTimer = 0;
  state.debugAntiFlipActive = false;

  state.directionCommitTimer = 0;
  state.oppositeHoldTimer = 0;
  state.antiFlipTimer = 0;
  state.carveLockTimer = 0;
  state.carveSwitchCooldownTimer = 0;
  state.carveSide = 0;
  state.movementPhase = input.buttons.brake ? 'BRAKE' : 'GLIDE';
  state.debugMovementPhase = state.movementPhase;
  state.debugCarveLockTimer = 0;
  state.debugCarveSide = 0;

  return {
    desiredMoveAngle: driveAngle,
    turnIntentAngle: curvedTravelAngle,
    turnResistance: reverseT,
    chargeActive
  };
}
