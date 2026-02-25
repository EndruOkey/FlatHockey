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
        this.handlers.message?.(msg);
      } catch {}
    });
  }

  onOpen(cb: () => void) { this.handlers.open = cb; }
  onClose(cb: () => void) { this.handlers.close = cb; }
  onMessage(cb: (msg: ServerMessage) => void) { this.handlers.message = cb; }

  send(msg: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }
}
