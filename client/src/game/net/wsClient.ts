import { NET } from '../../config/constants';
import type { SnapshotMsg } from '@flathockey/shared';
import type { RawInput } from '../input/InputHandler';

const WS_URL = import.meta.env.DEV ? NET.WS_LOCAL : NET.WS_PROD;

type WelcomeLike = { clientId: string; roomId?: string };

export class WsClient {
  onWelcome:  (clientId: string, roomId: string) => void = () => {};
  onSnapshot: (snap: SnapshotMsg) => void = () => {};
  onStatus:   (msg: string) => void = () => {};

  private ws:       WebSocket | null = null;
  private clientId: string | null = null;
  private seq = 0;
  private inputTimer = 0;
  private connected = false;

  connect() {
    this.onStatus('Connecting...');
    try {
      this.ws = new WebSocket(WS_URL);
    } catch {
      this.onStatus('Connection failed');
      setTimeout(() => this.connect(), NET.RECONNECT_DELAY_MS ?? 2000);
      return;
    }

    this.ws.onopen = () => {
      this.send({ type: 'hello', proto: NET.PROTOCOL_VERSION, name: this.resolveName() });
    };

    this.ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.onStatus('Disconnected — reconnecting...');
      setTimeout(() => this.connect(), NET.RECONNECT_DELAY_MS ?? 2000);
    };

    this.ws.onerror = () => {
      this.onStatus('Connection error');
    };
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'welcome':
      case 'net:welcome': {
        this.clientId = String(msg.clientId ?? '');
        const roomId  = String(msg.roomId ?? msg.room ?? 'pond-1');
        // Join the default room
        this.send({ type: 'join', room: 'pond-1' });
        break;
      }

      case 'join:ok': {
        this.connected = true;
        this.onStatus('');
        this.onWelcome(this.clientId ?? '', String(msg.room ?? 'pond-1'));
        break;
      }

      case 'join:reject': {
        this.onStatus(`Rejected: ${msg.reason ?? 'unknown'}`);
        break;
      }

      case 'error': {
        if (msg.code === 'UNSUPPORTED_PROTO') {
          this.onStatus('Protocol mismatch — refresh the page');
        } else {
          this.onStatus(`Error: ${msg.code ?? msg.reason}`);
        }
        break;
      }

      case 'snapshot': {
        this.onSnapshot(msg as SnapshotMsg);
        break;
      }
    }
  }

  /** Send input — call every frame, rate-limited internally */
  sendInput(input: RawInput, dtMs: number) {
    if (!this.connected || !this.clientId) return;

    this.inputTimer += dtMs;
    const intervalMs = 1000 / NET.INPUT_HZ;
    if (this.inputTimer < intervalMs) return;
    this.inputTimer -= intervalMs;

    this.send({
      type:      'input',
      seq:       ++this.seq,
      moveX:     input.moveX,
      moveY:     input.moveY,
      aimAngle:  input.aimAngle,
      aimDistance: input.aimDist,
      shoot:     input.shoot,
      pass:      input.pass,
      drop:      input.drop,
      stop:      input.stop,
      keys: {
        mouse0: input.shoot,
        mouse1: input.pass || input.shoot === false && false, // rmb
        mouse2: input.drop,
        space:  input.stop,
      },
    });
  }

  private send(obj: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private resolveName(): string {
    try {
      return localStorage.getItem('fh_name') ?? 'Player';
    } catch {
      return 'Player';
    }
  }

  get isConnected() { return this.connected; }
  get myClientId()  { return this.clientId; }
}
