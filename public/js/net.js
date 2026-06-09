// Tenký klient k server-authoritative simulaci + lobby systému (socket.io).
export class Net {
  constructor() {
    this.socket = window.io();
    this.id = this.socket.id || null;

    this.onLobbyList   = null;
    this.onLobbyJoined = null;
    this.onLobbyState  = null;
    this.onLobbyStart  = null;
    this.onLobbyError  = null;
    this.onSnap        = null;
    this.onGoal        = null;
    this.onWhistle     = null;
    this.onPeerLeft    = null;

    this.socket.on('connect', () => { this.id = this.socket.id; });
    this.socket.on('lobby:list',   d => this.onLobbyList?.(d));
    this.socket.on('lobby:joined', d => this.onLobbyJoined?.(d));
    this.socket.on('lobby:state',  d => this.onLobbyState?.(d));
    this.socket.on('lobby:start',  d => this.onLobbyStart?.(d));
    this.socket.on('lobby:error',  d => this.onLobbyError?.(d));
    this.socket.on('sponsor:result', d => this.onSponsor?.(d));
    this.socket.on('snap', d => this.onSnap?.(d));
    this.socket.on('goal', d => this.onGoal?.(d));
    this.socket.on('whistle', d => this.onWhistle?.(d));
    this.socket.on('peer-left', () => this.onPeerLeft?.());
  }

  listLobbies()              { this.socket.emit('lobby:list'); }
  createLobby(settings, profile) { this.socket.emit('lobby:create', { settings, profile }); }
  joinLobby(id, profile, password) { this.socket.emit('lobby:join', { id, profile, password }); }
  setTeam(team)              { this.socket.emit('lobby:team', { team }); }
  updateSettings(settings)   { this.socket.emit('lobby:settings', { settings }); }
  startLobby()               { this.socket.emit('lobby:start'); }
  leaveLobby()               { this.socket.emit('lobby:leave'); }
  checkSponsor(name)         { this.socket.emit('sponsor:check', name); }

  input(msg) { this.socket.emit('input', msg); }
  leave()    { try { this.socket?.disconnect(); } catch {} }
}
