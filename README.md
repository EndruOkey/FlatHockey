# FlatHockey V4

Fresh server-authoritative POND-only prototype.

## Dev

```bash
npm install
npm run dev
```

- Client: `http://localhost:5173`
- Server WS: `ws://localhost:8080/ws`
- Server WS v2: `ws://localhost:8080/ws2`

## Build

```bash
npm run build
```

## Itch.io HTML5 ZIP (build-only)

```bash
npm run itch:zip
```

This creates:

- `release/FlatHockey-itch.zip`

Packaging rules:

- ZIP contains only `client/dist` contents (not full repo)
- `index.html` is in ZIP root (itch HTML5 requirement)
- source maps are removed before zipping
- build fails if packaged file count is over 999

## Start (prod-like server)

```bash
npm run start
```

Server serves `client/dist` if built.

## Backend v2 Protocol (`/ws2`)

New server-authoritative protocol v2 runs in parallel with legacy `/ws`.

Client flow:
1. `hello` (`proto: 2`)
2. `join` (`mode: "pond"`, `room: "pond-1"`)
3. periodic `input`
4. optional `ping` -> `pong`

Server flow:
1. `welcome` (`clientId` assigned on hello)
2. `join:ok`
3. continuous `snapshot`

Client switch:

```bash
VITE_WS_URL=wss://flathockey.fun/ws2
```

Deploy guide: [docs/backend-v2-deploy.md](/c:/Games/flathockey-move-rework/docs/backend-v2-deploy.md)

## Prod sanity

Run on the production server:

```bash
./scripts/prod-sanity.sh
```
