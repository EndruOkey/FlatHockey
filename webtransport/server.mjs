// FlatHockey — samostatný WebTransport (HTTP/3 / QUIC) server pro pohybová data.
// Přenáší OBOUSMĚRNĚ datagramy (unreliable, unordered) → žádné TCP head-of-line trhání.
// NEřeší lobby/chat/auth/skóre — to zůstává na socket.io v server.js.
//
// Protokol datagramů (1. bajt = typ):
//   client → server:
//     0x01 HELLO  : zbytek = utf8 token (fh_recon_token nebo socket.id), spáruje WT session s hráčem
//     0x02 INPUT  : zbytek = payload vstupu (necháváme na aplikaci; typicky JSON utf8)
//   server → client:
//     0x03 SNAP   : zbytek = payload snapshotu (aplikace; musí se vejít do ~1200 B MTU, viz INTEGRATION.md)
//     0x04 WELCOME: potvrzení spárování (prázdné)
//
// Použití ze server.js (viz INTEGRATION.md):
//   import { startWebTransport } from './webtransport/server.mjs';
//   const wt = await startWebTransport({ cert, privKey, port: 4433,
//     onInput(token, bytes) { /* applyClientInput */ },
//     onOpen(token) {}, onClose(token) {} });
//   wt.send(token, snapBytes);   // pošle datagram konkrétnímu hráči

import { Http3Server } from '@fails-components/webtransport';

const T_HELLO = 0x01, T_INPUT = 0x02, T_SNAP = 0x03, T_WELCOME = 0x04;
const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * @param {object} o
 * @param {string} o.cert     PEM certifikát (ECDSA P-256, platnost < 14 dní pro serverCertificateHashes)
 * @param {string} o.privKey  PEM privátní klíč (PKCS#8)
 * @param {number} [o.port]   UDP port (default 4433)
 * @param {string} [o.host]   bind host (default '0.0.0.0')
 * @param {string} [o.secret] QUIC secret (default náhodný-stabilní string)
 * @param {string} [o.path]   WT cesta (default '/fh')
 * @param {(token:string, bytes:Uint8Array)=>void} [o.onInput]
 * @param {(token:string)=>void} [o.onOpen]
 * @param {(token:string)=>void} [o.onClose]
 */
export async function startWebTransport(o) {
  const port = o.port || 4433;
  const host = o.host || '0.0.0.0';
  const path = o.path || '/fh';

  const server = new Http3Server({
    port,
    host,
    secret: o.secret || 'flathockey-quic-secret',
    cert: o.cert,
    privKey: o.privKey,
  });

  server.startServer();
  await server.ready;

  // token -> { session, writer }
  const clients = new Map();
  // session -> token (pro úklid při zavření)
  const sessionToken = new WeakMap();

  async function pumpDatagrams(session) {
    let writer;
    try {
      const wr = session.datagrams.writable || session.datagrams.createWritable?.();
      writer = wr.getWriter();
    } catch (e) {
      return; // session bez datagramové podpory → ignoruj
    }
    const reader = session.datagrams.readable.getReader();
    let token = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length < 1) continue;
        const type = value[0];
        const rest = value.subarray(1);
        if (type === T_HELLO) {
          token = dec.decode(rest).slice(0, 80);
          clients.set(token, { session, writer });
          sessionToken.set(session, token);
          try { await writer.write(Uint8Array.of(T_WELCOME)); } catch {}
          o.onOpen?.(token);
        } else if (type === T_INPUT && token) {
          o.onInput?.(token, rest);
        }
      }
    } catch { /* session spadla */ }
    finally {
      try { reader.releaseLock?.(); } catch {}
      if (token && clients.get(token)?.session === session) clients.delete(token);
      if (token) o.onClose?.(token);
    }
  }

  (async () => {
    const sessionStream = await server.sessionStream(path);
    const sessionReader = sessionStream.getReader();
    while (true) {
      const { done, value } = await sessionReader.read();
      if (done) break;
      value.ready.then(() => pumpDatagrams(value)).catch(() => {});
      value.closed.catch(() => {}).finally(() => {
        const tk = sessionToken.get(value);
        if (tk && clients.get(tk)?.session === value) { clients.delete(tk); o.onClose?.(tk); }
      });
    }
  })().catch(() => {});

  return {
    server,
    address: () => server.address(),
    /** Pošle SNAP datagram jednomu hráči. bytes = již zakódovaný payload (Uint8Array). */
    send(token, bytes) {
      const c = clients.get(token);
      if (!c) return false;
      const pkt = new Uint8Array(1 + bytes.length);
      pkt[0] = T_SNAP;
      pkt.set(bytes, 1);
      c.writer.write(pkt).catch(() => {});
      return true;
    },
    /** Rozešle stejný payload všem připojeným WT hráčům (pokud chceš filtrovat podle room, dělej to v server.js). */
    broadcast(bytes, tokenFilter) {
      for (const token of clients.keys()) {
        if (tokenFilter && !tokenFilter(token)) continue;
        this.send(token, bytes);
      }
    },
    has(token) { return clients.has(token); },
    tokens() { return [...clients.keys()]; },
    count() { return clients.size; },
    stop() { try { server.stopServer(); } catch {} },
    // helpery pro aplikaci (JSON <-> bytes)
    encodeJSON(obj) { return enc.encode(JSON.stringify(obj)); },
    decodeJSON(bytes) { try { return JSON.parse(dec.decode(bytes)); } catch { return null; } },
  };
}
