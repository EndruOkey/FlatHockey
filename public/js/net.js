const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class Net {
  constructor() {
    this.socket = window.io();
    this.pc = null;
    this.dc = null;
    this.isHost = false;
    this.connected = false;
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
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(data));
    }
  }

  async _initPeer() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit('signal', { type: 'ice', candidate });
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'connected') {
        this.connected = true;
        this.onConnected?.();
      }
      if (['disconnected', 'failed', 'closed'].includes(this.pc.connectionState)) {
        this.connected = false;
        this.onDisconnected?.();
      }
    };

    if (this.isHost) {
      this.dc = this.pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
      this._setupChannel(this.dc);
    } else {
      this.pc.ondatachannel = ({ channel }) => {
        this.dc = channel;
        this._setupChannel(channel);
      };
    }
  }

  _setupChannel(ch) {
    ch.onopen = () => { this.connected = true; this.onConnected?.(); };
    ch.onclose = () => { this.connected = false; this.onDisconnected?.(); };
    ch.onmessage = ({ data }) => { try { this.onMessage?.(JSON.parse(data)); } catch {} };
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
