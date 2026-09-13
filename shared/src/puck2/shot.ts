import type { ShotInstance } from './types';

export function createShotInstance(input: ShotInstance): ShotInstance {
  return { ...input };
}

export function sampleShotClipPosition(shot: ShotInstance, elapsedSec: number) {
  const t = Math.max(0, Math.min(elapsedSec, shot.clipDurationSec));
  return {
    x: shot.startX + shot.dirX * shot.speed * t,
    y: shot.startY + shot.dirY * shot.speed * t
  };
}

export function isShotClipComplete(shot: ShotInstance, elapsedSec: number) {
  return elapsedSec >= shot.clipDurationSec;
}
