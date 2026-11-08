# WebTransport integrace do FlatHockey — přesný plán

Stav: NOVÉ soubory jsou hotové (`webtransport/server.mjs`, `public/js/wt.js`, `webtransport/local-test.mjs`).
Tento dokument popisuje MINIMÁLNÍ háčky do `server.js` a `net.js`. **Neaplikováno** — čísla řádků jsou proti aktuálnímu stavu.

Verze (ověřeno `npm view`, 2026-11-08):
- `@fails-components/webtransport` **1.6.11** (engines: node >=20)
- `@fails-components/webtransport-transport-http3-quiche` **1.6.11** (nativní QUIC binárka, prebuildy pro win/linux/mac x64)

---

## 1) Rozdělení kanálů (co jde kudy)

| data | kanál | proč |
|---|---|---|
| **snap** (pozice, úhly, puk, hodiny) | **WebTransport datagram** | vysoká frekvence, zastaralý paket je k ničemu → unreliable/unordered = bez TCP HoL |
| **input** (směr, střela, ctrl) | **WebTransport datagram** | totéž, 60/s |
| lobby:*, chat, auth, device_token | socket.io | musí dorazit a v pořadí |
| goal, whistle, match_rewards, online_count, sponsor | socket.io | spolehlivé, nízká frekvence |

WT běží **vedle** socket.io, nenahrazuje ho. Socket.io je zároveň fallback.

---

## 2) MTU — KRITICKÉ

QUIC datagram se musí vejít do cesty (~**1200 B**), jinak ho stack **zahodí**.
Současný `snap` (server.js:750) nese i kosmetiku (col, num, js, hc, sh, gc, tc, sk, ty, hy, vc, nm) — pro 6 hráčů **přeteče MTU**.

**Řešení:** přes WT posílat jen „slim" snap (dynamická data). Kosmetiku a jména klient už má z PRVNÍHO socket.io snapu (ten necháme projít po socket.io při startu zápasu). Slim snap = `n, players[{id,x,y,ba,aa,ca,sd,dr,dc,fh,hp,ch,cc,ln}], puck, gl, gr, score, lock, clk, per, pers, end, pnd`. To je ~600–900 B pro 6 hráčů → vejde se.
(Pokud by i slim přetékal, štěp na 2 datagramy s indexem, nebo pošli jen hráče co se hýbou.)

---

## 3) server.js — háčky

### a) Spuštění WT serveru (po `server.listen`, kolem řádku 1197)
```js
import { startWebTransport } from './webtransport/server.mjs';
// cert: sdílený s Caddy (Let's Encrypt) NEBO self-signed (viz VPS kroky).
const WT_PORT = Number(process.env.WT_PORT || 4433);
let wt = null;
if (process.env.WT_CERT && process.env.WT_KEY) {
  const cert = readFileSync(process.env.WT_CERT, 'utf8');
  const privKey = readFileSync(process.env.WT_KEY, 'utf8');
  wt = await startWebTransport({
    cert, privKey, port: WT_PORT, host: '0.0.0.0', path: '/fh',
    onInput: (token, bytes) => {
      // token = socket.id (klient ho posílá v HELLO)
      const socket = io.sockets.sockets.get(token);
      if (!socket) return;
      const msg = wt.decodeJSON(bytes);
      if (msg) handleInput(socket, msg);   // viz bod c)
    },
    onOpen:  (token) => { const s = io.sockets.sockets.get(token); if (s) s.data._wt = true; },
    onClose: (token) => { const s = io.sockets.sockets.get(token); if (s) s.data._wt = false; },
  });
  console.log('→ WebTransport on udp :' + WT_PORT);
}
```
Pozn.: `server.js` už `readFileSync` importuje (řádek 1) — netřeba přidávat import.
Pozn.: nahoře v souboru je `import`, takže top-level `await` jde jen když je modul ESM — `server.js` ESM je (používá `import`). OK.

### b) Odeslání snapu přes WT místo socket.io (funkce `broadcast`, server.js:733–760)
Na konci `broadcast(match)`, za `io.to(match.room).emit('snap', snap)`:
```js
// snap postav jako dnes do proměnné `snap`, pak:
io.to(match.room).emit('snap', snap);          // socket.io hráči + fallback + diváci
if (wt) {
  const slim = { n: snap.n, players: snap.players.map(p => ({
      id:p.id, x:p.x, y:p.y, ba:p.ba, aa:p.aa, ca:p.ca, sd:p.sd, dr:p.dr, dc:p.dc,
      fh:p.fh, hp:p.hp, ch:p.ch, cc:p.cc, ln:p.ln })),
    puck: snap.puck, gl: snap.gl, gr: snap.gr, score: snap.score, lock: snap.lock,
    clk: snap.clk, per: snap.per, pers: snap.pers, end: snap.end, pnd: snap.pnd };
  const bytes = wt.encodeJSON(slim);
  for (const [sid, p] of match.players) if (wt.has(sid)) wt.send(sid, bytes);
}
```
Hráč, který má WT (`wt.has(sid)`), dostane snap dvakrát (socket.io i WT) — klient bere ten, co dorazí dřív / zahazuje starší podle `n`. Volitelně: pro WT hráče snap po socket.io NEposílat (ušetří TCP), ale kvůli jednoduchosti fallbacku doporučuju zprvu posílat obojím a měřit.

### c) Vstup — vytáhnout tělo handleru do funkce (server.js:1112–1122)
Dnešní `socket.on('input', msg => {...})` zabal do `function handleInput(socket, msg){...}` a v listeneru jen zavolej `handleInput(socket, msg)`. Pak ho volá i WT `onInput`. (Rate-limit nech — u WT počítej zvlášť, nebo sdílej `socket.data._inrl`.)

---

## 4) net.js / klient — háčky

`net.js` nech BEZE ZMĚNY vnitřně; přidej WT jako nadstavbu v `game.js` (nebo malý doplněk v net.js):

```js
import { WT } from './wt.js';
// po socket 'connect' (máme this.socket.id):
this.wt = new WT();
if (WT.isSupported()) {
  this.wt.connect({
    url: `https://${location.hostname}:${WT_PORT}/fh`,
    token: this.socket.id,                 // HELLO token = socket.id
    certHash: window.FH_WT_HASH || '',     // hex SHA-256 self-signed certu (jen při self-signed)
    onSnap: d => this.onSnap?.(d),         // stejný callback jako socket 'snap'
    onReady: () => { this._wtReady = true; },
    onFail: () => { this._wtReady = false; },  // zůstaň na socket.io
  });
}
// input():
input(msg) {
  if (this._wtReady && this.wt.sendInput(msg)) return;  // primárně WT
  this.socket.emit('input', msg);                        // fallback socket.io
}
```
- `WT_PORT` a `FH_WT_HASH` dodej do stránky (inline `<script>window.FH_WT_HASH='...'</script>` nebo z `/api/wtinfo`).
- Klient posílá snap-callback z obou zdrojů → v `game.js` `_interp` už je řazení podle `n`, takže duplicity/pořadí řeší existující buffer. Ověř, že starší `n` zahazuje.

---

## 5) Pořadí nasazení
1. VPS: otevřít UDP port, cert (bod VPS).
2. `npm install @fails-components/webtransport @fails-components/webtransport-transport-http3-quiche` na VPS (Node 20/22 LTS → prebuild, bez buildu).
3. Přidat háčky a/c (server), spustit s `WT_CERT`/`WT_KEY`/`WT_PORT`.
4. Přidat háček b (snap přes WT) a klienta (bod 4).
5. Měřit `scripts/test_netsmooth.mjs` + `/api/netstat` PŘED/PO (cíl: stalls dolů, snapMax dolů proti TCP-HoL profilu).
