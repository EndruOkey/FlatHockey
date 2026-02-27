import type { ClientMessage, ServerMessage } from '@flathockey/shared';

type Handlers = {
  open?: () => void;
  close?: () => void;
  message?: (msg: ServerMessage) => void;
};

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers: Handlers = {};
  private msgCount = 0;
  private lastMsgAt = 0;
  private netReportTimer: number | null = null;
  private pingTimer: number | null = null;
  private pingNonce = 0;
  private pendingPings = new Map<number, number>();
  private rttMs = -1;

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

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      try { this.ws.close(); } catch {}
    }

    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      this.startPingLoop();
      this.handlers.open?.();
    });
    this.ws.addEventListener('close', () => {
      this.stopPingLoop();
      this.handlers.close?.();
    });
    this.ws.addEventListener('error', () => {
      this.stopPingLoop();
      this.handlers.close?.();
    });
    this.ws.addEventListener('message', (ev) => {
      this.msgCount++;
      this.lastMsgAt = performance.now();

      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
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
        this.handlers.message?.(msg);
      } catch {}
    });
  }

  onOpen(cb: () => void) { this.handlers.open = cb; }
  onClose(cb: () => void) { this.handlers.close = cb; }
  onMessage(cb: (msg: ServerMessage) => void) { this.handlers.message = cb; }

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
}
