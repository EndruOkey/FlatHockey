import {
  computePuckCombatPose,
  createShotInstance,
  mapShotChargeToStickPose,
  sampleShotClipPosition,
  type ShotInstance
} from '@flathockey/shared';
import type { PlayerState, RoomPuckState } from '../room.types';

export function computeOwnedPuckContact(player: PlayerState, playerRadius: number) {
  return computePuckCombatPose({
    playerX: player.x,
    playerY: player.y,
    bodyAngle: player.angle,
    aimAngle: player.aimAngle,
    playerRadius,
    handedness: player.handedness,
    state: 'carry'
  });
}

export function computeChargedShotPose(
  player: PlayerState,
  playerRadius: number,
  charge01: number,
  chargeStartRelativeAngle: number | null
) {
  return computePuckCombatPose({
    playerX: player.x,
    playerY: player.y,
    bodyAngle: player.angle,
    aimAngle: player.aimAngle,
    playerRadius,
    handedness: player.handedness,
    state: 'charge',
    charge01: mapShotChargeToStickPose(charge01),
    chargeStartRelativeAngle
  });
}

export function createServerShotInstance(input: {
  shotId: number;
  ownerId: string;
  startTick: number;
  startX: number;
  startY: number;
  dirX: number;
  dirY: number;
  vx: number;
  vy: number;
  speed: number;
  spin: number;
  charge01: number;
  radius: number;
  clipDurationSec: number;
}): ShotInstance {
  return createShotInstance({
    ...input,
    authoritative: true
  });
}

export function sampleServerReleasingPuck(puck: RoomPuckState, elapsedSec: number) {
  if (!puck.shot) {
    return { x: puck.x, y: puck.y };
  }
  return sampleShotClipPosition(puck.shot, elapsedSec);
}
