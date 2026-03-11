import { NET_PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@flathockey/shared';
import { BUILD_VERSION } from '../../config/version';

type Handlers = {
  open?: () => void;
  close?: () => void;
  message?: (msg: ServerMessage | { type?: string; [key: string]: unknown }) => void;
  status?: (state: 'connecting' | 'connected' | 'disconnected') => void;
};

/**
 * WS2 minimal client:
 * - on open: send hello, then join
 * - ping every 1s (for app-level heartbeat + RTT)
 * - exposes send(...) used by PondScene
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private connectUrl: string | null = null;

  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private readonly reconnectDelaysMs = [500, 1000, 2000, 3000, 5000];
  private reconnectEnabled = true;

  private handlers: Handlers = {};

  private pingTimer: number | null = null;
  private didHandshake = false;

  private rttMs = -1;

  connect(url: string) {
    this.connectUrl = url;
    this.reconnectEnabled = true;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  disconnect(permanent = false) {
    if (permanent) {
      this.reconnectEnabled = false;
      this.connectUrl = null;
    }
    this.clearReconnectTimer();
    this.stopPing();
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {}
  }

  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  getRttMs(): number {
    return this.rttMs;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (!this.reconnectEnabled || !this.connectUrl || this.reconnectTimer !== null) return;

    const idx = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1);
    const delay = this.reconnectDelaysMs[idx];
    this.reconnectAttempt++;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private openSocket() {
    if (!this.connectUrl) return;

    this.didHandshake = false;
    this.stopPing();

    this.handlers.status?.('connecting');

    const ws = new WebSocket(this.connectUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;

      this.reconnectAttempt = 0;
      this.sendHelloJoin();
      this.startPing();

      this.handlers.status?.('connected');
      this.handlers.open?.();
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;

      this.ws = null;
      this.stopPing();
      this.handlers.status?.('disconnected');
      this.handlers.close?.();
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // close handles reconnect/state
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));

        if (msg && msg.type === 'pong') {
          if (typeof msg.t === 'number') {
            this.rttMs = Math.max(0, Date.now() - msg.t);
          }
          return;
        }

        this.handlers.message?.(msg);
      } catch {}
    });
  }

  send(msg: ClientMessage | any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      const wireMsg = this.toV2WireMessage(msg);
      this.ws.send(JSON.stringify(wireMsg));
    } catch {}
  }

  private toV2WireMessage(msg: any): any {
    if (!msg || msg.type !== 'input') return msg;

    const hasGameplayFields =
      typeof msg.moveX === 'number' ||
      typeof msg.moveY === 'number' ||
      typeof msg.shoot === 'number' ||
      typeof msg.stop === 'number' ||
      typeof msg.backwards === 'number' ||
      typeof msg.aimAngle === 'number';

    if (!hasGameplayFields) return msg;

    return {
      type: msg.type,
      seq: Number.isFinite(msg.seq) ? Math.max(0, Math.floor(msg.seq)) : 0,
      moveX: typeof msg.moveX === 'number' ? msg.moveX : undefined,
      moveY: typeof msg.moveY === 'number' ? msg.moveY : undefined,
      aimAngle: typeof msg.aimAngle === 'number' ? msg.aimAngle : undefined,
      shoot: !!msg.shoot,
      stop: !!msg.stop,
      backwards: !!msg.backwards
    };
  }

  private sendHelloJoin() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.didHandshake) return;

    this.didHandshake = true;

    const name = `itch-${Math.floor(Math.random() * 9999)}`;

    this.send({
      type: 'hello',
      proto: NET_PROTOCOL_VERSION,
      clientBuild: BUILD_VERSION,
      name
    });

    this.send({
      type: 'join',
      mode: 'pond',
      room: 'pond-1'
    });
  }

  private startPing() {
    this.stopPing();

    this.pingTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.send({ type: 'ping', t: Date.now() });
    }, 1000);
  }

  private stopPing() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  onOpen(cb: () => void) {
    this.handlers.open = cb;
  }

  onClose(cb: () => void) {
    this.handlers.close = cb;
  }

  onMessage(cb: Handlers['message']) {
    this.handlers.message = cb;
  }

  onStatus(cb: Handlers['status']) {
    this.handlers.status = cb;
  }
}
