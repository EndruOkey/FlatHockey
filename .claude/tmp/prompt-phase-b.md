You are implementing Phase B of the FlatHockey minimal stick redesign.

Project root: /mnt/c/Games/flathockey-move-rework

## Goal

Wire `computeMinimalStickPose` as the single source of truth for ALL puck position logic.

One bladeContactPoint, used for:
- server hard-attach (owned puck position each tick)
- server pickup gate origin
- server shot release origin
- server bad-receive deflect origin
- client puck draw position (both local-player and remote)

No carryAnchor vs strikeCenter split. No visualPuckTarget override. No spring on puck position.
Owned puck is hard-locked to bladeContactPoint — no drift, no second truth.

## Read these files first

Read all of them before writing anything:

- shared/src/stick/minimalStickRig.ts              (the new rig — Phase A output)
- shared/src/stick/canonicalStickRig.ts            (being replaced — understand the old API)
- shared/src/index.ts                               (need to add minimalStickRig export)
- shared/src/sim/puckPickup.ts                      (BladeZone type used by evaluatePickupGate)
- server/src/game/room.types.ts                     (PlayerState fields)
- server/src/game/roomSystems.ts                    (main server logic — full file)
- client/src/game/scenes/PondSceneRenderOps.ts      (puck draw + playerCarryTargetWorld fallback)
- client/src/game/entities/playerView.ts            (getCarryAnchorWorld, getVisualPuckTargetWorld)
- client/src/game/net/prediction.ts                 (client-side predicted state fields)

## Changes to make — in this order

### 1. shared/src/index.ts
Add: `export * from './stick/minimalStickRig';`

### 2. shared/src/sim/puckPickup.ts
The `BladeZone` type currently has `carryAnchorX/Y`. Rename to `bladeContactX/Y`:
```typescript
export type BladeZone = {
  bladeContactX: number;  // was carryAnchorX
  bladeContactY: number;  // was carryAnchorY
  bladeForwardX: number;
  bladeForwardY: number;
  bladeZoneRadius: number;
};
```
Update the internals of `evaluatePickupGate` to use `pose.bladeContactX/Y` instead of `pose.carryAnchorX/Y`.
Also update `computeSweetSpotZone` call — it uses `dx = puckX - pose.carryAnchorX`.

### 3. server/src/game/room.types.ts
Add to `PlayerState`:
```typescript
peakChargeAngle: number;   // world-space stickAngle captured at shot release; used by release state
releaseTimer: number;      // countdown for release animation (seconds)
```
Keep `stickTimer: number` and `releaseCharge: number` for now — they'll be removed in Phase C.
Keep `oneTimerGraceMsRemaining: number` for now.

### 4. server/src/game/roomSystems.ts

#### 4a. Add import
```typescript
import { computeMinimalStickPose, MINIMAL_STICK_CONFIG, type MinimalStickPose } from '@flathockey/shared';
```

#### 4b. Replace `stickStateToRigMode` with a minimal state mapper
```typescript
function toMinimalState(stickState: string): import('@flathockey/shared').MinimalStickState {
  if (stickState === 'charge') return 'charge';
  if (stickState === 'release') return 'release';
  return 'carry';  // neutral, control, turning, charge_break, pass, oneTimerReady → carry
}
```

#### 4c. Replace `stickPose()` function
Old function calls `computeCanonicalStickRig` + `projectStickRigToWorld`.
New function calls `computeMinimalStickPose`:
```typescript
function minimalPose(room: any, player: any): MinimalStickPose {
  const playerRadius = Math.max(12, Number(room.gameplayConfig.playerRadius ?? 18));
  return computeMinimalStickPose({
    playerX: player.x,
    playerY: player.y,
    bodyAngle: player.angle,
    aimAngle: player.aimAngle,
    playerRadius,
    handedness: player.handedness,
    state: toMinimalState(player.stickState),
    charge01: player.shotCharge,
    peakChargeAngle: player.peakChargeAngle,
    releaseProgress: player.releaseTimer > 0
      ? 1 - player.releaseTimer / MINIMAL_STICK_CONFIG.releaseDurationSec
      : 1
  });
}
```

Wait — `MINIMAL_STICK_CONFIG` doesn't have `releaseDurationSec`. Use `CANONICAL_STICK_CONFIG.releaseDurationSec` for now (keep import of CANONICAL_STICK_CONFIG just for that constant until Phase C removes it).

Actually, add `releaseDurationSec: 0.08` directly to `MINIMAL_STICK_CONFIG` in `minimalStickRig.ts` first.

After adding that constant, the `minimalPose` function can use:
```typescript
releaseProgress: player.releaseTimer > 0
  ? 1 - player.releaseTimer / MINIMAL_STICK_CONFIG.releaseDurationSec
  : 1
```

#### 4d. Replace all `stickPose(room, player)` / `stickPose(room, owner)` calls with `minimalPose(room, player/owner)`

In the existing code, `stickPose()` is called in these places:
- `stickPose(room, owner)` in the OWNED branch (for hard-attach, crosscheck, instability)
- `stickPose(room, owner, 'pass')` for pass release direction
- `stickPose(room, owner, 'charge')` for shot origin
- `stickPose(room, player)` in the pickup loop (for evaluatePickupGate)
- `stickPose(room, owner)` in `dropPuckFrom`

For the pass case: just use `minimalPose(room, owner)` — in carry state, bladeContactPoint IS the correct origin for a pass.
For the shot case: `minimalPose(room, owner)` with stickState='charge' — bladeContactPoint in charge state IS the shot origin.

#### 4e. Replace `pose.carryAnchorX/Y` with `pose.bladeContactX/Y` everywhere

Search for all uses:
- `hardAttachPuck(room, pose.carryAnchorX, pose.carryAnchorY)` → `hardAttachPuck(room, pose.bladeContactX, pose.bladeContactY)`
- `room.puck.x = bestPose.carryAnchorX` → `room.puck.x = bestPose.bladeContactX`
- `room.puck.y = bestPose.carryAnchorY` → `room.puck.y = bestPose.bladeContactY`
- `dx = room.puck.x - bestPose.carryAnchorX` → `dx = room.puck.x - bestPose.bladeContactX`
- `dy = room.puck.y - bestPose.carryAnchorY` → `dy = room.puck.y - bestPose.bladeContactY`
- In `dropPuckFrom`: `pose.carryAnchorX` → `pose.bladeContactX`

#### 4f. Replace `chargePose.strikeCenterX/Y` with `pose.bladeContactX/Y` for shot origin

In the shot release block:
```typescript
// OLD:
const chargePose = stickPose(room, owner, 'charge');
// ...
room.puck.x = chargePose.strikeCenterX;
room.puck.y = chargePose.strikeCenterY;

// NEW:
const chargePose = minimalPose(room, owner);  // stickState is 'charge' here
// ...
room.puck.x = chargePose.bladeContactX;
room.puck.y = chargePose.bladeContactY;
```

#### 4g. Update `evaluatePickupGate` BladeZone argument

Old:
```typescript
evaluatePickupGate(..., pose, ...)
// pose was StickRigWorld with carryAnchorX/Y
```

New — pass a BladeZone object directly:
```typescript
const bladeZone = {
  bladeContactX: pose.bladeContactX,
  bladeContactY: pose.bladeContactY,
  bladeForwardX: pose.bladeForwardX,
  bladeForwardY: pose.bladeForwardY,
  bladeZoneRadius: MINIMAL_STICK_CONFIG.bladeZoneRadius  // need to add this to config, use 10
};
evaluatePickupGate(..., bladeZone, ...)
```

Add `bladeZoneRadius: 10` to `MINIMAL_STICK_CONFIG` in minimalStickRig.ts.

#### 4h. Capture peakChargeAngle on shot release

In the shot release block, after `chargeAtRelease = owner.shotCharge`:
```typescript
// Capture the stickAngle at peak charge for release animation
const chargePose = minimalPose(room, owner);
owner.peakChargeAngle = chargePose.stickAngle;
```
Then set:
```typescript
owner.stickState = 'release';
owner.releaseTimer = MINIMAL_STICK_CONFIG.releaseDurationSec;
```

#### 4i. Tick releaseTimer

In the global timer tick loop (near line 199):
```typescript
player.releaseTimer = Math.max(0, (player.releaseTimer ?? 0) - dt);
```

#### 4j. Release exit transition (non-owner cleanup block, near line 675)

The existing `player.stickState === 'release' && player.stickTimer <= 0` check:
Change condition to also check `player.releaseTimer <= 0`:
```typescript
} else if (player.stickState === 'release' && player.releaseTimer <= 0) {
  player.stickState = 'neutral';
  player.releaseCharge = 0;
  player.peakChargeAngle = 0;
}
```

Also: in the OWNED branch after shot release:
```typescript
owner.stickState = 'release';
owner.stickTimer = CANONICAL_STICK_CONFIG.releaseDurationSec;  // keep for old rig compat
owner.releaseTimer = MINIMAL_STICK_CONFIG.releaseDurationSec;  // new
owner.releaseCharge = chargeAtRelease;                         // keep for old rig compat
owner.peakChargeAngle = chargePose.stickAngle;                 // new
```

#### 4k. Remove old stickPose function (and its stickStateToRigMode helper)

After verifying all call sites are replaced, delete the old `stickPose()` function and `stickStateToRigMode()` function.

Keep the import of `computeCanonicalStickRig` ONLY if any other code still uses it (check carefully). If not used, remove that import too.

### 5. client/src/game/entities/playerView.ts

#### 5a. Add import
```typescript
import { computeMinimalStickPose, MINIMAL_STICK_CONFIG, type MinimalStickPose } from '@flathockey/shared';
```

#### 5b. Add a `computePhysicsPose()` method

This replaces the old `resolvePhysicsStickPose()` for puck position purposes:
```typescript
private computePhysicsPose(): MinimalStickPose {
  const tuning = getTuning();
  const playerRadius = Math.max(12, tuning.playerRadius ?? 18);
  const state: import('@flathockey/shared').MinimalStickState =
    this.stickState === 'charge' ? 'charge'
    : this.stickState === 'release' ? 'release'
    : 'carry';
  return computeMinimalStickPose({
    playerX: this.worldX,
    playerY: this.worldY,
    bodyAngle: this.rot,
    aimAngle: this.aimRot,
    playerRadius,
    handedness: this.handedness,
    state,
    charge01: this.shotCharge,
    peakChargeAngle: (this as any).peakChargeAngle ?? 0,
    releaseProgress: this.stickTimer > 0
      ? 1 - this.stickTimer / MINIMAL_STICK_CONFIG.releaseDurationSec
      : 1
  });
}
```

#### 5c. Replace `getCarryAnchorWorld()`

```typescript
getCarryAnchorWorld() {
  const pose = this.computePhysicsPose();
  return { x: pose.bladeContactX, y: pose.bladeContactY };
}
```

#### 5d. Replace `getVisualPuckTargetWorld()`

```typescript
getVisualPuckTargetWorld() {
  // Phase B: no visual override — puck tracks physics blade contact point exactly.
  return this.getCarryAnchorWorld();
}
```

### 6. client/src/game/scenes/PondSceneRenderOps.ts

The fallback path in `playerCarryTargetWorld()` (when `view` is not available) currently calls `computeStickRigWorld` and returns `carryAnchorX/Y`.

Replace with `computeMinimalStickPose` and `bladeContactX/Y`:

```typescript
import { computeMinimalStickPose } from '@flathockey/shared';

// In the fallback block:
const stickState = state.stickState as string ?? 'carry';
const minState: import('@flathockey/shared').MinimalStickState =
  stickState === 'charge' ? 'charge'
  : stickState === 'release' ? 'release'
  : 'carry';
const pose = computeMinimalStickPose({
  playerX: state.x,
  playerY: state.y,
  bodyAngle: state.rot,
  aimAngle: state.aimRot ?? state.rot,
  playerRadius: Math.max(12, tuning.playerRadius ?? 18),
  handedness: state.handedness ?? 'right',
  state: minState,
  charge01: state.shotCharge ?? 0,
  peakChargeAngle: state.peakChargeAngle ?? 0,
  releaseProgress: state.stickTimer > 0
    ? 1 - state.stickTimer / (0.08)
    : 1
});
return { x: pose.bladeContactX, y: pose.bladeContactY };
```

Remove `computeStickRigWorld` from the import in this file if no longer needed.

## Additions to minimalStickRig.ts

Before any other changes, add these constants to `MINIMAL_STICK_CONFIG`:
```typescript
releaseDurationSec: 0.08,   // release animation duration (seconds)
bladeZoneRadius: 10,         // pickup gate blade zone radius (world units)
```

## Build validation

After all changes:
```bash
cd /mnt/c/Games/flathockey-move-rework
npm run build -w shared
npm run build -w server
npm run build -w client
```

Fix ALL TypeScript errors before finishing.

## Rules

- Remove all `carryAnchorX/Y` references from the new code paths. Old references in old functions (like `stickStateToRigMode`, `stickPose`) should be deleted along with those functions.
- Do NOT touch `stickRenderer.ts` or `playerBodyRenderer.ts` — Phase D handles the renderer.
- Do NOT touch `createGripLayout()` in playerView.ts — Phase D handles hands.
- The old `resolvePhysicsStickPose()` / `resolveRenderStickPose()` methods and their spring-animated visual machinery in playerView.ts can stay untouched — just override `getCarryAnchorWorld` and `getVisualPuckTargetWorld` to use the new minimal pose.
- `evaluatePickupGate` signature doesn't change — just update the BladeZone type.
- Keep `releaseCharge` and `stickTimer` fields on PlayerState — do not remove. Phase C will clean them up.
- Keep `oneTimerGraceMsRemaining` for now.
- The net/prediction.ts file may reference `releaseCharge` — do NOT change it in Phase B.

## Output

When done, report:
1. Files modified (list)
2. Build results (shared, server, client — each pass/fail)
3. Any remaining `carryAnchorX/Y` or `strikeCenterX/Y` references in new code
4. Any TypeScript errors you could not resolve
