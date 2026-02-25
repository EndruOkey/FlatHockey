import Phaser from 'phaser';
import { PondScene } from './scenes/PondScene';

export function createPhaserGame(parent: HTMLElement) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pauseOnBlur: false,
    backgroundColor: '#07141a',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [PondScene]
  });
}
