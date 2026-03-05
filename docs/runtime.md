# Production runtime - FlatHockey

## Backend process (single instance)

- Service: `flathockey.service`
- Listener: `:7777`
- Canonical WS handler in backend code: `/ws2` only
- Legacy `/ws` WS handler is removed in code

## Forbidden / must remain disabled

- `flathockey-ws2.service` must stay disabled
- `pm2-ubuntu` and PM2 process `flathockey` must not run backend

## Expected listeners

- `:7777` backend node process
- `:80` and `:443` Caddy
- `:22` SSH
- `:7778` must be closed
- `:8080` must be closed for FlatHockey runtime

## Caddy routing (prod)

- `/ws`, `/ws/`, `/ws/*` -> rewrite to `/ws2{uri}` -> `reverse_proxy 127.0.0.1:7777`
- `/ws2`, `/ws2/`, `/ws2/*` -> `reverse_proxy 127.0.0.1:7777`
- Static web root -> `/var/www/flathockey`

## Sanity checks (server)

```bash
sudo ss -lntp | egrep ':7777|:7778|:8080'
curl -i http://127.0.0.1:7777/health
curl -i http://127.0.0.1:7778/health
```

Expected:
- `:7777` present
- `:7778` absent / connection refused
- `:8080` absent for backend
- `7777/health` returns JSON

## External WS handshake expectations

- `wss://flathockey.fun/ws` -> `101 Switching Protocols` (via rewrite to ws2)
- `wss://flathockey.fun/ws2` -> `101 Switching Protocols`

## Operating rule

Use `systemd` as the single source of truth for backend process management on prod.
Do not run backend with PM2 in parallel.

