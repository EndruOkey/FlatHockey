const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class Net {
  constructor() {
    this.socket = window.io();
    this.pc = null;
    this.dc = null;          // 'game' — nespolehlivý, rychlý stav (60×/s)
    this.rc = null;          // 'events' — spolehlivý, ordered (střely/přihrávky/grab…)
    this.isHost = false;
    this.connected = false;
    this._announced = false; // onConnected jen jednou
    this.pendingCandidates = [];

    this.onMessage = null;
    this.onConnected = null;
    this.onDisconnected = null;

    this.socket.on('signal', data => this._handleSignal(data));
    this.socket.on('peer-left', () => {
      this.connected = false;
      this.onDisconnected?.();
    });
  }

  join(roomId) {
    return new Promise((resolve, reject) => {
      this.socket.emit('join', roomId);
      this.socket.once('joined', async ({ isHost }) => {
        this.isHost = isHost;
        await this._initPeer();
        if (isHost) resolve({ isHost: true, waiting: true });
        else resolve({ isHost: false, waiting: false });
      });
      this.socket.once('room-full', () => reject(new Error('Room is full')));
      this.socket.once('peer-ready', () => {
        if (this.isHost) this._createOffer();
      });
    });
  }

  send(data) {
    // Vše kromě high-frequency 'state' jde spolehlivým kanálem (střely/přihrávky/grab…),
    // aby se kritické akce neztrácely → puk šel spolehlivě odehrát.
    const ch = (data.t === 'state') ? this.dc : this.rc;
    if (ch?.readyState === 'open') ch.send(JSON.stringify(data));
  }

  // Čisté odpojení — zavře P2P i socket, server uvolní slot v místnosti
  leave() {
    this.connected = false;
    try { this.dc?.close(); } catch {}
    try { this.rc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    try { this.socket?.disconnect(); } catch {}
    this.dc = null; this.rc = null; this.pc = null;
  }

  async _initPeer() {
    this.pendingCandidates = [];
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit('signal', { type: 'ice', candidate });
    };

    this.pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(this.pc.connectionState)) {
        this.connected = false;
        this.onDisconnected?.();
      }
    };

    if (this.isHost) {
      this.dc = this.pc.createDataChannel('game',   { ordered: false, maxRetransmits: 0 });
      this.rc = this.pc.createDataChannel('events', { ordered: true });   // spolehlivý
      this._setupChannel(this.dc);
      this._setupChannel(this.rc);
    } else {
      this.pc.ondatachannel = ({ channel }) => {
        if (channel.label === 'events') this.rc = channel; else this.dc = channel;
        this._setupChannel(channel);
      };
    }
  }

  _setupChannel(ch) {
    ch.onopen = () => this._maybeConnected();
    ch.onclose = () => { this.connected = false; this.onDisconnected?.(); };
    ch.onmessage = ({ data }) => { try { this.onMessage?.(JSON.parse(data)); } catch {} };
  }

  // onConnected až když jsou OBA kanály otevřené (a jen jednou)
  _maybeConnected() {
    if (this._announced) return;
    if (this.dc?.readyState === 'open' && this.rc?.readyState === 'open') {
      this._announced = true;
      this.connected = true;
      this.onConnected?.();
    }
  }

  async _createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.socket.emit('signal', { type: 'offer', sdp: offer.sdp });
  }

  async _handleSignal(data) {
    if (data.type === 'offer') {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      await this._flushCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.socket.emit('signal', { type: 'answer', sdp: answer.sdp });
    } else if (data.type === 'answer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await this._flushCandidates();
    } else if (data.type === 'ice') {
      if (this.pc.remoteDescription) {
        await this.pc.addIceCandidate(data.candidate);
      } else {
        this.pendingCandidates.push(data.candidate);
      }
    }
  }

  async _flushCandidates() {
    for (const c of this.pendingCandidates) {
      await this.pc.addIceCandidate(c);
    }
    this.pendingCandidates = [];
  }
}
