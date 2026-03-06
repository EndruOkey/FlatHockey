import type { ClientMessage, ServerMessage } from '@flathockey/shared';

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

  private handlers: Handlers = {};

  private pingTimer: number | null = null;
  private didHandshake = false;

  private rttMs = -1;

  connect(url: string) {
    this.connectUrl = url;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.openSocket();
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
    if (!this.connectUrl || this.reconnectTimer !== null) return;

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

    // reset per-connection state
    this.didHandshake = false;
    this.stopPing();

    this.handlers.status?.('connecting');

    const ws = new WebSocket(this.connectUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;

      this.reconnectAttempt = 0;

      // handshake + join
      this.sendHelloJoin();

      // keepalive
      this.startPing();

      this.handlers.status?.('connected');
      this.handlers.open?.();
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;

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

        // RTT pong from server
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

  // Translate legacy/shared input payload to WS2 wire schema.
  private toV2WireMessage(msg: any): any {
    if (!msg || msg.type !== 'input') return msg;

    const hasLegacyFields =
      typeof msg.moveX === 'number' ||
      typeof msg.moveY === 'number' ||
      typeof msg.sprint === 'number' ||
      typeof msg.brake === 'number' ||
      typeof msg.shoot === 'number' ||
      typeof msg.aimAngleRaw === 'number' ||
      typeof msg.aimAngle === 'number';

    if (!hasLegacyFields) return msg;

    const moveX = Number(msg.moveX ?? 0);
    const moveY = Number(msg.moveY ?? 0);
    const aim = typeof msg.aimAngleRaw === 'number'
      ? msg.aimAngleRaw
      : (typeof msg.aimAngle === 'number' ? msg.aimAngle : undefined);

    return {
      type: 'input',
      seq: Number.isFinite(msg.seq) ? Math.max(0, Math.floor(msg.seq)) : 0,
      dt: typeof msg.dt === 'number' && Number.isFinite(msg.dt) ? msg.dt : undefined,
      pointer: typeof aim === 'number' ? { aim } : undefined,
      keys: {
        w: moveY < 0,
        a: moveX < 0,
        s: moveY > 0,
        d: moveX > 0,
        shift: !!msg.sprint,
        space: !!msg.brake,
        e: !!msg.shoot
      }
    };
  }

  private sendHelloJoin() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.didHandshake) return;

    this.didHandshake = true;

    const name = `itch-${Math.floor(Math.random() * 9999)}`;

    // hello
    this.send({
      type: 'hello',
      proto: 2,
      name
    });

    // join
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
  onMessage(cb: any) {
    this.handlers.message = cb;
  }
  onStatus(cb: any) {
    this.handlers.status = cb;
  }
}
