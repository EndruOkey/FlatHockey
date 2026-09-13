You are the MASTER SYNTHESIS worker for FlatHockey shot mechanic analysis. Project root: /mnt/c/Games/flathockey-move-rework

## Your task
Find the BEST solution for the charge shot mechanic — structural rewrites allowed.
Verify specific bugs and propose concrete implementation options ranked by quality.

## Key hypothesis to verify FIRST

### Bug A: `releaseTimer` not set on shot (server)
Read `server/src/game/roomSystems.ts` lines 498-520.
The shot fires and sets `owner.stickTimer = CANONICAL_STICK_CONFIG.releaseDurationSec` (0.25s).
QUESTION: Is `owner.releaseTimer` ALSO set to 0.25s here?
The non-hasPuck state machine at ~line 620 uses `player.releaseTimer <= 0` to exit 'release'.
If `releaseTimer` is NOT set alongside `stickTimer`, the server exits 'release' after 1 tick (33ms at 30Hz).

### Bug B: Decrement-before-pose timing
Read `client/src/game/net/prediction.ts` lines 70-108.
QUESTION: Is `predicted.stickTimer` decremented BEFORE `releaseProgress` is computed?
If yes: at release frame 0, animation starts 1/60=6.7% advanced instead of 0%.

### Bug C: `crosscheck` and `pass` release transitions
Read roomSystems.ts lines 612-617.
When crosscheck/pass expire → stickState='release', stickTimer=set. Is releaseTimer ALSO set?

## Architecture options to evaluate

### Option 1: Minimal fix (1-2 lines)
Wherever `stickState='release'` is set on server, also set `releaseTimer = releaseDurationSec`.
Files changed: roomSystems.ts only.
Risk: low. Keeps dual-timer architecture.

### Option 2: Unify timers (eliminate releaseTimer)
Use only `stickTimer` everywhere. In the `!hasPuck` state machine, replace `releaseTimer <= 0` with `stickTimer <= 0`.
Also fix it for the `hasPuck` branch if needed.
Files changed: roomSystems.ts (state machine).
Risk: low. Simpler.

### Option 3: Event-driven shot (radical but clean)
Instead of stickState='release' on wire, add a one-shot `SHOT_EVENT` message.
Server:
- On shot: compute puck velocity, send `SHOT_EVENT {ownerId, peakAngle, chargeLevel}` to all clients
- stickState stays 'charge' for 1 tick then goes to 'neutral' (no 'release' state on wire)
Client:
- On `SHOT_EVENT` for local player: already in prediction, animation plays from prediction
- On `SHOT_EVENT` for remote player: trigger a 0.25s cosmetic animation locally
Wire changes: new message type.
Risk: medium. Cleanest architecture.

### Option 4: Purely cosmetic release on client
Server: after shot, immediately go to 'neutral' (no 'release' state at all on wire).
Client: when `prevStickState='charge'` and new `stickState≠'charge'` with `releaseCharge>0`,
  start a local 0.25s cosmetic animation independently of stickTimer.
Wire: stickState goes charge→neutral (no release needed).
Risk: low for local player (prediction already does this). Medium for remote players.

## Files to read completely
1. server/src/game/roomSystems.ts lines 495-530 (shot release block)
2. server/src/game/roomSystems.ts lines 610-640 (non-hasPuck state machine)
3. client/src/game/net/prediction.ts lines 60-175
4. client/src/game/net/reconciliation.ts (full file, check how stickState is reconciled)
5. shared/src/net/messages.ts (what fields are on the wire)
6. shared/src/stick/canonicalStickRig.ts (timer values)

## Output format

1. **Bug verification**: For each bug A/B/C: CONFIRMED or NOT PRESENT (with exact line numbers)
2. **Impact assessment**: What does each bug cause visually?
3. **Option comparison table**:
   | Option | Lines changed | Server simplicity | Visual quality | Risk | Wire changes |
4. **Single best recommendation** with exact file+line changes
5. **One-timer edge case**: Does the current one-timer (oneTimerGraceMs=200ms) interact correctly with the shot animation fixes?
