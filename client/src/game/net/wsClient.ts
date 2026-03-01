import type { ClientMessage, ServerMessage } from '@flathockey/shared';

type Handlers = {
  open?: () => void;
  close?: () => void;
  message?: (msg: ServerMessage | { type?: string; [key: string]: unknown }) => void;
  status?: (state: 'connecting' | 'connected' | 'disconnected') => void;
};

export class WsClient {
  private static readonly KNOWN_SERVER_TYPES = new Set([
    'hello',
    'login:ok',
    'login:reject',
    'welcome',
    'net:welcome',
    'join:reject',
    'snapshot',
    'net:pong'
  ]);
  private ws: WebSocket | null = null;
  private connectUrl: string | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private readonly reconnectDelaysMs = [500, 1000, 2000, 3000, 5000];
  private handlers: Handlers = {};
  private msgCount = 0;
  private lastMsgAt = 0;
  private netReportTimer: number | null = null;
  private pingTimer: number | null = null;
  private pingNonce = 0;
  private pendingPings = new Map<number, number>();
  private rttMs = -1;
  private unknownServerTypesLogged = new Set<string>();
  private didLogin = false;

  // tuning sync state conveyed by server welcome messages
  public allowTuningSync = false;
  public serverTuning: Partial<import('@flathockey/shared/sim/movementStep').MovementStepConfig> | null = null;

  // helper used by callers to know whether it's safe to send immediately
  public isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  public getRttMs(): number {
    return this.rttMs;
  }

  private ensureNetReporter() {
    if (this.netReportTimer !== null) return;

    this.netReportTimer = window.setInterval(() => {
      const age = (performance.now() - this.lastMsgAt).toFixed(0);
      console.log(`[NET] msgs=${this.msgCount} lastMsgAgeMs=${age}`);
      this.msgCount = 0;
    }, 1000);
  }

  connect(url: string) {
    this.ensureNetReporter();
    this.connectUrl = url;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  private setStatus(state: 'connecting' | 'connected' | 'disconnected') {
    this.handlers.status?.(state);
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
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private openSocket() {
    if (!this.connectUrl) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      try { this.ws.close(); } catch {}
    }

    this.setStatus('connecting');
    const ws = new WebSocket(this.connectUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.clearReconnectTimer();
      this.reconnectAttempt = 0;
      this.didLogin = false;
      // itch-safe fallback: if server doesn't send hello quickly, login anyway.
      window.setTimeout(() => {
        if (this.ws !== ws || this.didLogin || ws.readyState !== WebSocket.OPEN) return;
        this.sendLogin(ws);
      }, 250);
      this.setStatus('connected');
      this.handlers.open?.();
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.stopPingLoop();
      this.didLogin = false;
      this.setStatus('disconnected');
      this.handlers.close?.();
      this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // close event handles the reconnect/status transition.
    });
    ws.addEventListener('message', (ev) => {
      this.msgCount++;
      this.lastMsgAt = performance.now();

      try {
        const msg = JSON.parse(String(ev.data)) as (ServerMessage & { type?: string }) & {
          user?: { id?: string; name?: string; flag?: string };
        };
        if (!msg || typeof msg.type !== 'string') return;
        console.log('[WS recv]', msg.type, msg);
        if (msg.type === 'hello' && !this.didLogin) {
          this.sendLogin(ws);
        }
        if (msg.type === 'login:ok') {
          this.didLogin = true;
        }
        if (msg.type === 'net:pong') {
          const sentAt = this.pendingPings.get(msg.nonce);
          if (typeof sentAt === 'number') {
            this.pendingPings.delete(msg.nonce);
            this.rttMs = Math.max(0, performance.now() - sentAt);
          }
          return;
        }
        // store tuning information from welcome
        if (msg.type === 'welcome') {
          this.allowTuningSync = !!msg.allowTuningSync;
          if (msg.movementTuning) {
            this.serverTuning = msg.movementTuning as any;
          }
        }
        if (!WsClient.KNOWN_SERVER_TYPES.has(msg.type) && !this.unknownServerTypesLogged.has(msg.type)) {
          this.unknownServerTypesLogged.add(msg.type);
          console.warn('[WS] Unknown server message type', msg.type, msg);
        }
        this.handlers.message?.(msg);
      } catch {}
    });
  }

  onOpen(cb: () => void) { this.handlers.open = cb; }
  onClose(cb: () => void) { this.handlers.close = cb; }
  onMessage(cb: (msg: ServerMessage | { type?: string; [key: string]: unknown }) => void) { this.handlers.message = cb; }
  onStatus(cb: (state: 'connecting' | 'connected' | 'disconnected') => void) { this.handlers.status = cb; }

  send(msg: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      // ignore transient errors
    }
  }

  private startPingLoop() {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const nonce = ++this.pingNonce;
      this.pendingPings.set(nonce, performance.now());
      if (this.pendingPings.size > 64) {
        const oldest = this.pendingPings.keys().next();
        if (!oldest.done) this.pendingPings.delete(oldest.value);
      }
      this.send({ type: 'net:ping', nonce });
    }, 1000);
  }

  private stopPingLoop() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pendingPings.clear();
  }

  private sendLogin(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const username = `itch-${Math.floor(Math.random() * 10000)}`;
    const loginMessage = {
      type: 'login',
      username,
      flag: 'xx'
    };
    try {
      ws.send(JSON.stringify(loginMessage));
      console.log('[WS] LOGIN sent', loginMessage);
    } catch {
      // ignore transient send errors
    }
  }
}
