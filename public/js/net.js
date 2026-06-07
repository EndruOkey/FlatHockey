// Tenký klient k server-authoritative simulaci přes socket.io.
export class Net {
  constructor() {
    this.socket = window.io();
    this.id = null;
    this.team = null;

    this.onJoined   = null;
    this.onSnap     = null;
    this.onGoal     = null;
    this.onPeerLeft = null;
    this.onFull     = null;

    this.socket.on('joined', d => { this.id = d.id; this.team = d.team; this.onJoined?.(d); });
    this.socket.on('snap',   d => this.onSnap?.(d));
    this.socket.on('goal',   d => this.onGoal?.(d));
    this.socket.on('peer-left', () => this.onPeerLeft?.());
    this.socket.on('room-full', () => this.onFull?.());
  }

  join(room, name, hand, color, num, style) {
    this.socket.emit('join', { room, name, hand, color, num, style });
  }

  input(msg) { this.socket.emit('input', msg); }

  leave() { try { this.socket?.disconnect(); } catch {} }
}
