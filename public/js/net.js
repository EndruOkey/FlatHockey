// Tenký klient k server-authoritative simulaci + lobby systému (socket.io).
export class Net {
  constructor() {
    // Persistent reconnect identity token (survives tab refresh within the session)
    let rt = localStorage.getItem('fh_recon_token');
    if (!rt) {
      rt = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem('fh_recon_token', rt);
    }

    this.socket = window.io({ auth: { rt } });
    this.id = this.socket.id || null;
    this._connected = false;

    this.onLobbyList       = null;
    this.onLobbyJoined     = null;
    this.onLobbyState      = null;
    this.onLobbyStart      = null;
    this.onLobbyError      = null;
    this.onSnap            = null;
    this.onGoal            = null;
    this.onWhistle         = null;
    this.onPeerLeft        = null;
    this.onMatchRewards    = null;
    this.onOnlineCount     = null;
    this.onDisconnect      = null;  // fired on unexpected drop
    this.onReconnect       = null;  // fired when socket reconnects after a drop

    this.socket.on('connect', () => {
      const wasConnected = this._connected;
      this.id = this.socket.id;
      this._connected = true;
      if (wasConnected) this.onReconnect?.();
    });
    this.socket.on('disconnect', (reason) => {
      // 'io client disconnect' means voluntary (net.leave()), don't fire callback
      if (reason !== 'io client disconnect') this.onDisconnect?.();
    });
    this.socket.on('lobby:list',      d => this.onLobbyList?.(d));
    this.socket.on('lobby:joined',    d => this.onLobbyJoined?.(d));
    this.socket.on('lobby:state',     d => this.onLobbyState?.(d));
    this.socket.on('lobby:start',     d => this.onLobbyStart?.(d));
    this.socket.on('lobby:error',     d => this.onLobbyError?.(d));
    this.socket.on('sponsor:result',  d => this.onSponsor?.(d));
    this.socket.on('snap',            d => this.onSnap?.(d));
    this.socket.on('goal',            d => this.onGoal?.(d));
    this.socket.on('whistle',         d => this.onWhistle?.(d));
    this.socket.on('peer-left',       () => this.onPeerLeft?.());
    this.socket.on('match_rewards',   d  => this.onMatchRewards?.(d));
    this.socket.on('online_count',    d  => this.onOnlineCount?.(d));
  }

  listLobbies()                        { this.socket.emit('lobby:list'); }
  createLobby(settings, profile)       { this.socket.emit('lobby:create', { settings, profile }); }
  joinLobby(id, profile, password)     { this.socket.emit('lobby:join', { id, profile, password }); }
  setTeam(team)                        { this.socket.emit('lobby:team', { team }); }
  updateSettings(settings)             { this.socket.emit('lobby:settings', { settings }); }
  startLobby()                         { this.socket.emit('lobby:start'); }
  leaveLobby()                         { this.socket.emit('lobby:leave'); }
  checkSponsor(name)                   { this.socket.emit('sponsor:check', name); }

  input(msg) { this.socket.emit('input', msg); }
  leave()    { try { this.socket?.disconnect(); } catch {} }
}
