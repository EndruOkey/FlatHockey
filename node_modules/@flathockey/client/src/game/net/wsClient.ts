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

  // tuning sync state conveyed by server welcome messages
  public allowTuningSync = false;
  public serverTuning: Partial<import('@flathockey/shared/sim/movementStep').MovementStepConfig> | null = null;

  // helper used by callers to know whether it's safe to send immediately
  public isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
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
    this.ws.addEventListener('open', () => this.handlers.open?.());
    this.ws.addEventListener('close', () => this.handlers.close?.());
    this.ws.addEventListener('error', () => this.handlers.close?.());
    this.ws.addEventListener('message', (ev) => {
      this.msgCount++;
      this.lastMsgAt = performance.now();

      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
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
}
