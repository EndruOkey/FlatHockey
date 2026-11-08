// FlatHockey — klientský WebTransport modul (pohybová data přes HTTP/3 datagramy).
// Běží VEDLE socket.io (net.js). WT nese jen snap+input (unreliable, unordered → bez TCP HoL).
// Když WT není podporován nebo spojení selže, signalizuje fallback → hra jede dál po socket.io.
//
// Datagramy – 1. bajt = typ (musí ladit s webtransport/server.mjs):
//   out: 0x01 HELLO (utf8 token), 0x02 INPUT (payload)
//   in:  0x03 SNAP (payload),     0x04 WELCOME
//
// Použití (viz webtransport/INTEGRATION.md):
//   import { WT } from './wt.js';
//   const wt = new WT();
//   if (WT.isSupported()) {
//     wt.connect({ url: 'https://host:4433/fh', token: rt, certHash: '<hex sha-256>' ,
//                  onSnap: d => game.applySnap(d), onReady: ()=>{}, onFail: ()=>{/* zůstaň na socket.io */} });
//   }
//   wt.sendInput(msg);   // místo socket.emit('input', msg) když wt.ready

const T_HELLO = 0x01, T_INPUT = 0x02, T_SNAP = 0x03, T_WELCOME = 0x04;

export class WT {
  static isSupported() { return typeof window !== 'undefined' && 'WebTransport' in window; }

  constructor() {
    this.ready = false;        // true až po WELCOME
    this.failed = false;
    this.transport = null;
    this._writer = null;
    this._enc = new TextEncoder();
    this._dec = new TextDecoder();
    this.onSnap = null;
    this.onReady = null;
    this.onFail = null;
  }

  // hexHash: SHA-256 DER certifikátu jako hex (self-signed). Když prázdné, spoléhá na důvěryhodný cert (Let's Encrypt).
  static _hexToBytes(hex) {
    const clean = (hex || '').replace(/[^0-9a-fA-F]/g, '');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  async connect({ url, token, certHash, onSnap, onReady, onFail }) {
    this.onSnap = onSnap; this.onReady = onReady; this.onFail = onFail;
    if (!WT.isSupported()) { this._fail('no-webtransport'); return; }
    try {
      const opts = {};
      if (certHash) {
        opts.serverCertificateHashes = [{ algorithm: 'sha-256', value: WT._hexToBytes(certHash) }];
      }
      this.transport = new WebTransport(url, opts);
      // pokud se spojení nenaváže do 3 s, spadni na socket.io
      const timeout = setTimeout(() => { if (!this.ready) this._fail('timeout'); }, 3000);
      await this.transport.ready;
      this.transport.closed.then(() => this._fail('closed')).catch(() => this._fail('closed'));

      const wr = this.transport.datagrams.writable;
      this._writer = wr.getWriter();
      this._readLoop();

      // HELLO → spáruj session s tokenem hráče
      await this._send(T_HELLO, this._enc.encode(String(token || '')));
      clearTimeout(timeout);
    } catch (e) {
      this._fail('connect-error:' + (e && e.message || e));
    }
  }

  async _send(type, payload) {
    if (!this._writer) return false;
    const pkt = new Uint8Array(1 + payload.length);
    pkt[0] = type; pkt.set(payload, 1);
    try { await this._writer.write(pkt); return true; } catch { return false; }
  }

  // Pošle vstup jako datagram. msg = stejný objekt jako socket.emit('input', msg).
  sendInput(msg) {
    if (!this.ready) return false;
    return this._send(T_INPUT, this._enc.encode(JSON.stringify(msg)));
  }

  async _readLoop() {
    try {
      const reader = this.transport.datagrams.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length < 1) continue;
        const type = value[0];
        const rest = value.subarray(1);
        if (type === T_WELCOME) {
          this.ready = true;
          this.onReady?.();
        } else if (type === T_SNAP) {
          let d = null;
          try { d = JSON.parse(this._dec.decode(rest)); } catch {}
          if (d) this.onSnap?.(d);
        }
      }
    } catch { /* spadlo → closed handler zařídí fallback */ }
  }

  _fail(reason) {
    if (this.failed) return;
    this.failed = true; this.ready = false;
    try { this.transport?.close(); } catch {}
    this.onFail?.(reason);
  }

  close() {
    this.ready = false;
    try { this._writer?.close(); } catch {}
    try { this.transport?.close(); } catch {}
  }
}
