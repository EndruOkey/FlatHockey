// FlatHockey — lokální test obousměrného toku datagramů přes WebTransport.
// Vygeneruje self-signed ECDSA P-256 cert (platnost < 14 dní → vyhovuje serverCertificateHashes),
// spustí WT server (webtransport/server.mjs), připojí node WT klienta se serverCertificateHashes,
// pošle INPUT klient→server a ověří, že server→klient dorazí SNAP zpět (echo).
//
// Spuštění:  node webtransport/local-test.mjs
// Potřebuje: @fails-components/webtransport + -transport-http3-quiche (nativní QUIC binárka).

import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { startWebTransport } from './server.mjs';

const crypto = webcrypto;
x509.cryptoProvider.set(crypto);

function pem(der, label) {
  const b64 = Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

async function makeCert() {
  const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=127.0.0.1',
    notBefore: new Date(Date.now() - 60 * 1000),
    notAfter: new Date(Date.now() + 10 * 24 * 3600 * 1000), // 10 dní < 14 (limit Chrome)
    signingAlgorithm: alg,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: '127.0.0.1' }]),
    ],
  });
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
  const hashBuf = await crypto.subtle.digest('SHA-256', cert.rawData);
  const hashHex = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { cert: cert.toString('pem'), privKey: pem(pkcs8, 'PRIVATE KEY'), hashHex, hashBytes: new Uint8Array(hashBuf) };
}

const PORT = 14433;
const T_HELLO = 0x01, T_INPUT = 0x02, T_WELCOME = 0x04;

async function main() {
  const { cert, privKey, hashHex, hashBytes } = await makeCert();
  console.log('[test] cert SHA-256:', hashHex);

  let gotInput = false;
  const wt = await startWebTransport({
    cert, privKey, port: PORT, host: '127.0.0.1', path: '/fh',
    onOpen: (tok) => console.log('[server] session open, token=', tok),
    onInput: (tok, bytes) => {
      gotInput = true;
      const msg = wt.decodeJSON(bytes);
      console.log('[server] <- INPUT from', tok, JSON.stringify(msg));
      // echo zpět jako SNAP
      wt.send(tok, wt.encodeJSON({ echo: msg, serverTick: 42 }));
    },
    onClose: (tok) => console.log('[server] session close', tok),
  });
  console.log('[test] WT server ready on udp 127.0.0.1:' + PORT);

  // --- node WT klient ---
  const { WebTransport } = await import('@fails-components/webtransport');
  const url = `https://127.0.0.1:${PORT}/fh`;
  const client = new WebTransport(url, {
    serverCertificateHashes: [{ algorithm: 'sha-256', value: hashBytes }],
  });
  await client.ready;
  console.log('[client] connected');

  const writer = client.datagrams.writable.getWriter();
  const reader = client.datagrams.readable.getReader();
  const enc = new TextEncoder();

  const send = async (type, payload) => {
    const p = typeof payload === 'string' ? enc.encode(payload) : payload;
    const pkt = new Uint8Array(1 + p.length); pkt[0] = type; pkt.set(p, 1);
    await writer.write(pkt);
  };

  // HELLO + pár INPUTů (datagramy se můžou ztrácet → pošli opakovaně)
  await send(T_HELLO, 'tok-local-1');
  await new Promise(r => setTimeout(r, 200));

  let gotSnap = false;
  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length < 1) continue;
      if (value[0] === T_WELCOME) console.log('[client] <- WELCOME (session spárována)');
      else { gotSnap = true; console.log('[client] <- SNAP', new TextDecoder().decode(value.subarray(1))); }
    }
  })().catch(() => {});

  for (let i = 0; i < 10 && !gotSnap; i++) {
    await send(T_INPUT, JSON.stringify({ dir: [1, 0], shoot: false, seq: i }));
    await new Promise(r => setTimeout(r, 150));
  }

  await new Promise(r => setTimeout(r, 400));
  console.log('\n=== VÝSLEDEK ===');
  console.log('server přijal INPUT (klient→server):', gotInput ? 'ANO' : 'NE');
  console.log('klient přijal SNAP  (server→klient):', gotSnap ? 'ANO' : 'NE');
  console.log('obousměrny tok datagramu:', (gotInput && gotSnap) ? 'FUNGUJE ANO' : 'NEFUNGUJE NE');

  try { await writer.close(); } catch {}
  try { client.close(); } catch {}
  wt.stop();
  process.exit(gotInput && gotSnap ? 0 : 1);
}

main().catch((e) => { console.error('[test] CHYBA:', e); process.exit(2); });
