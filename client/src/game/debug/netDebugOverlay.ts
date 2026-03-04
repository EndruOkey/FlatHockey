import type Phaser from 'phaser';
import { getNetDebugMetrics } from './netDebugState';

function shouldEnableOverlay(): boolean {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('debug') === '1') return true;
  } catch {}

  const g = globalThis as typeof globalThis & { __FH_DEBUG__?: unknown };
  return g.__FH_DEBUG__ === true;
}

export class NetDebugOverlay {
  private readonly enabled: boolean;
  private text: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene) {
    this.enabled = shouldEnableOverlay();
    if (!this.enabled) return;

    this.text = scene.add.text(12, 300, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#9bf2ff'
    }).setScrollFactor(0).setDepth(1100);
  }

  update() {
    if (!this.enabled || !this.text) return;
    const metrics = getNetDebugMetrics();
    this.text.setText([
      'NET DEBUG',
      `PING: ${metrics.pingMs >= 0 ? metrics.pingMs.toFixed(1) : '-'} ms`,
      `SERVER TICK: ${metrics.serverTick}`,
      `SNAPSHOT RATE: ${metrics.snapshotRate}/s`,
      `PLAYERS: ${metrics.players}`,
      `INPUT DELAY: ${metrics.inputDelayMs.toFixed(1)} ms`,
      `CLIENT FPS: ${metrics.clientFps.toFixed(1)}`
    ].join('\n'));
  }

  destroy() {
    this.text?.destroy();
    this.text = null;
  }
}
