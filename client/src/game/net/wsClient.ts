import { NET_PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@flathockey/shared';
import { BUILD_VERSION } from '../../config/version';

type Handlers = {
  open?: () => void;
  close?: () => void;
  message?: (msg: ServerMessage | { type?: string; [key: string]: unknown }) => void;
  status?: (state: 'connecting' | 'connected' | 'disconnected') => void;
};

type WireSummary = {
  ts: string;
  type: string;
  seq?: number;
  tick?: number;
  serverTick?: number;
  detail?: string;
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
  private lastSentSummary: WireSummary | null = null;
  private lastReceivedSummary: WireSummary | null = null;

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

    console.info('[WS_CLIENT] CREATE', {
      ts: new Date().toISOString(),
      url: this.connectUrl
    });

    const ws = new WebSocket(this.connectUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;

      console.info('[WS_CLIENT] OPEN', {
        ts: new Date().toISOString(),
        url: this.connectUrl
      });
      this.reconnectAttempt = 0;
      this.sendHelloJoin();
      this.startPing();

      this.handlers.status?.('connected');
      this.handlers.open?.();
    });

    ws.addEventListener('close', (ev) => {
      if (this.ws !== ws) return;

      console.warn('[WS_CLIENT] CLOSE', {
        ts: new Date().toISOString(),
        url: this.connectUrl,
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
        lastSent: this.lastSentSummary,
        lastReceived: this.lastReceivedSummary
      });
      this.ws = null;
      this.stopPing();
      this.handlers.status?.('disconnected');
      this.handlers.close?.();
      this.scheduleReconnect();
    });

    ws.addEventListener('error', (ev) => {
      console.error('[WS_CLIENT] ERROR', {
        ts: new Date().toISOString(),
        url: this.connectUrl,
        readyState: ws.readyState,
        eventType: ev.type,
        lastSent: this.lastSentSummary,
        lastReceived: this.lastReceivedSummary
      });
      // close handles reconnect/state
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        this.lastReceivedSummary = summarizeWireMessage(msg);
        console.info('[WS_CLIENT] RECV', this.lastReceivedSummary);

        if (msg && msg.type === 'pong') {
          if (typeof msg.t === 'number') {
            this.rttMs = Math.max(0, Date.now() - msg.t);
          }
          return;
        }

        this.handlers.message?.(msg);
      } catch (error) {
        console.error('[WS_CLIENT] MESSAGE_PARSE_ERROR', {
          ts: new Date().toISOString(),
          url: this.connectUrl,
          error: error instanceof Error ? error.message : String(error),
          raw: String(ev.data).slice(0, 240),
          lastSent: this.lastSentSummary,
          lastReceived: this.lastReceivedSummary
        });
      }
    });
  }

  send(msg: ClientMessage | any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      const wireMsg = this.toV2WireMessage(msg);
      this.lastSentSummary = summarizeWireMessage(wireMsg);
      console.info('[WS_CLIENT] SEND', this.lastSentSummary);
      this.ws.send(JSON.stringify(wireMsg));
    } catch (error) {
      console.error('[WS_CLIENT] SEND_ERROR', {
        ts: new Date().toISOString(),
        url: this.connectUrl,
        error: error instanceof Error ? error.message : String(error),
        attempted: summarizeWireMessage(msg),
        lastReceived: this.lastReceivedSummary
      });
    }
  }

  private toV2WireMessage(msg: any): any {
    if (!msg || msg.type !== 'input') return msg;

    const hasGameplayFields =
      typeof msg.moveX === 'number' ||
      typeof msg.moveY === 'number' ||
      typeof msg.shoot === 'number' ||
      typeof msg.pass === 'number' ||
      typeof msg.drop === 'number' ||
      typeof msg.poke === 'number' ||
      typeof msg.stop === 'number' ||
      typeof msg.aimAngle === 'number';

    if (!hasGameplayFields) return msg;

    return {
      type: msg.type,
      seq: Number.isFinite(msg.seq) ? Math.max(0, Math.floor(msg.seq)) : 0,
      moveX: typeof msg.moveX === 'number' ? msg.moveX : undefined,
      moveY: typeof msg.moveY === 'number' ? msg.moveY : undefined,
      aimAngle: typeof msg.aimAngle === 'number' ? msg.aimAngle : undefined,
      shoot: !!msg.shoot,
      pass: !!msg.pass,
      drop: !!msg.drop,
      poke: !!msg.poke,
      stop: !!msg.stop
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

function summarizeWireMessage(msg: any): WireSummary {
  const ts = new Date().toISOString();
  const type = typeof msg?.type === 'string' ? msg.type : 'unknown';

  if (type === 'hello') {
    return {
      ts,
      type,
      detail: [
        typeof msg.proto === 'number' ? `proto=${msg.proto}` : null,
        typeof msg.clientBuild === 'string' ? `build=${msg.clientBuild}` : null
      ]
        .filter(Boolean)
        .join(' ')
    };
  }

  if (type === 'join') {
    return {
      ts,
      type,
      detail: [
        typeof msg.mode === 'string' ? `mode=${msg.mode}` : null,
        typeof msg.room === 'string' ? `room=${msg.room}` : null
      ]
        .filter(Boolean)
        .join(' ')
    };
  }

  if (type === 'input') {
    const parts = [
      typeof msg.seq === 'number' ? `seq=${msg.seq}` : null,
      typeof msg.moveX === 'number' || typeof msg.moveY === 'number' ? `move=(${msg.moveX ?? 0},${msg.moveY ?? 0})` : null,
      msg.pass ? 'pass' : null,
      msg.drop ? 'drop' : null,
      msg.poke ? 'poke' : null,
      msg.shoot ? 'shoot' : null,
      msg.stop ? 'stop' : null
    ].filter(Boolean);
    return {
      ts,
      type,
      seq: typeof msg.seq === 'number' ? msg.seq : undefined,
      detail: parts.join(' ')
    };
  }

  if (type === 'snapshot') {
    return {
      ts,
      type,
      tick: typeof msg.tick === 'number' ? msg.tick : undefined,
      serverTick: typeof msg.serverTick === 'number' ? msg.serverTick : undefined,
      detail: `players=${Array.isArray(msg.players) ? msg.players.length : 0} puck=${msg.puck?.state ?? 'none'}`
    };
  }

  if (type === 'ping' || type === 'pong' || type === 'net:ping' || type === 'net:pong') {
    return {
      ts,
      type,
      detail: typeof msg.t === 'number' ? `t=${msg.t}` : undefined
    };
  }

  if (type === 'welcome' || type === 'net:welcome' || type === 'join:ok' || type === 'error') {
    return {
      ts,
      type,
      detail:
        typeof msg.code === 'string'
          ? `${msg.code}:${msg.message ?? ''}`
          : typeof msg.room === 'string'
            ? `room=${msg.room}`
            : typeof msg.roomId === 'string'
              ? `room=${msg.roomId}`
              : undefined
    };
  }

  return { ts, type };
}
