import Phaser from 'phaser';
import type { WelcomeMsg } from '@flathockey/shared';
import type { WsClient } from '../net/wsClient';

export default class DebugUIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'DebugUIScene' });
  }

  // Kept for backwards compatibility with older hooks.
  setWsClient(_ws: WsClient) {}
  onWelcome(_msg: WelcomeMsg) {}

  create() {
    this.scene.setVisible(false);
  }
}
