You are analyzing the current FlatHockey puck / shot system V2.
Project root: `c:/Games/flathockey-move-rework`

## Goal
Audit the new V2 puck / carry / charge / release architecture and identify any remaining issues in:

- geometry truth
- puck state machine
- release clip behavior
- handoff to loose sim
- shot direction correctness
- debug invariants

This is no longer the old hybrid flow. Do not assume legacy canonical-vs-minimal branching is the intended design.

## Current intended V2 architecture

### 1. Shared puck gameplay pose

Primary shared geometry source:

- `shared/src/puck2/pose.ts`

Main function:

- `computePuckCombatPose(input)`

This is intended to be the single gameplay geometry source for:

- pickup
- carry
- charge
- release origin
- release direction
- crosscheck

It returns:

- `contactX/contactY`
- `forwardX/forwardY`
- `bladeBaseX/bladeBaseY`
- `bladeTipX/bladeTipY`
- `bodyAngleResolved`
- `stickAngleResolved`
- `visualSide`
- `pickupAngle`

The lower-level rig still lives in:

- `shared/src/stick/minimalStickRig.ts`

but puck gameplay truth should now be derived through `computePuckCombatPose()`.

### 2. Shared shot object

Shot / release object types live in:

- `shared/src/puck2/types.ts`
- `shared/src/puck2/shot.ts`

Key type:

- `ShotInstance`

Important rule:

- `startX/startY/dirX/dirY/speed/spin` must be treated as immutable after creation

### 3. Server puck state machine

Server-side puck flow lives mainly in:

- `server/src/game/room.types.ts`
- `server/src/game/roomSystems.ts`
- `server/src/game/puck2/serverPuck2.ts`
- `server/src/game/room.ts`

Server puck is intended to be in exactly one of:

- `owned`
- `releasing`
- `loose`

Key room puck fields now include:

- `kind`
- `ownerId`
- `possessionId`
- `shot`
- `x/y/vx/vy/spin`

### 4. Network model

Important messages live in:

- `shared/src/net/messages.ts`

New V2 event:

- `shot:start`

This is intended to become the authoritative release-start event.

Snapshots still carry puck state, but snapshots should not visually override the release clip itself.

### 5. Client V2 presentation model

Client flow currently lives in:

- `client/src/game/scenes/PondScene.ts`
- `client/src/game/scenes/PondSceneNetOps.ts`
- `client/src/game/scenes/PondSceneUpdateLoop.ts`
- `client/src/game/scenes/PondSceneRenderOps.ts`
- `client/src/game/entities/playerView.ts`
- `client/src/game/puck2/clientPuck2.ts`

Important client concepts:

- active release payload / shot-like object
- optional background loose sim state
- explicit source resolver

## Intended puck lifecycle

### A. Owned

While owned:

- server puck position must come from pose contact point
- client render puck should use same logical contact point
- no alternate carry source

### B. Releasing

Release clip phase:

- visible puck source must be only shot/release payload
- no live loose puck render source
- no snapshot x/y override
- no auth x/y override
- stick release should be synchronized to same payload window

### C. Loose

After clip:

- handoff to loose puck sim
- auth may be adopted here
- snapshot may matter here
- still only one visible puck source

## Current strict render-source model

At any frame, intended puck render source is exactly one of:

- `owned`
- `release_clip`
- `loose_sim`
- `none`

Anything else is architectural drift.

## Current debug model

### Keys

- `F8` = lightweight release / shot summary
- `Shift+F8` = puck control debug
- `Ctrl+F8` = geometry debug
- `Alt+F8` = pickup debug
- `F7` = crosscheck debug

### Expected key debug values

#### Shot / release summary

Should show:

- gameplay charge
- render charge
- stick state
- payload active yes/no
- release phase
- shot direction source
- blade forward vs resolved aim delta
- impulse

#### Puck control debug

Should show:

- current render source
- gameplay puck point
- visual puck point
- release origin
- server release origin
- origin delta
- auth puck point
- handoff/source switch count

#### Warnings / invariants

Should warn on:

- multiple puck render sources
- origin mismatch
- debug overload

## Healthy expected behavior

At shot release start:

- server and client release origin should match closely
- visible puck source should be `release_clip`
- loose puck sim should not yet be the visible source
- stick and puck should read as one action

After release clip:

- visible source should become `loose_sim`
- auth/snapshot correction may happen here, not earlier

## Files to inspect first

1. `shared/src/puck2/pose.ts`
2. `shared/src/puck2/types.ts`
3. `shared/src/puck2/shot.ts`
4. `shared/src/stick/minimalStickRig.ts`
5. `server/src/game/puck2/serverPuck2.ts`
6. `server/src/game/roomSystems.ts`
7. `server/src/game/room.ts`
8. `client/src/game/puck2/clientPuck2.ts`
9. `client/src/game/scenes/PondScene.ts`
10. `client/src/game/scenes/PondSceneRenderOps.ts`
11. `client/src/game/scenes/PondSceneNetOps.ts`
12. `client/src/game/entities/playerView.ts`
13. `shared/src/net/messages.ts`

## What should NOT be proposed

Do not recommend:

- enlarging the puck
- restoring canonical puck gameplay truth
- letting `hasPuck=false` directly drive release render
- multiple simultaneous puck render branches
- blind blend layers without identifying source-of-truth

## Questions a worker should answer explicitly

When analyzing remaining issues, answer:

1. What is the exact active puck state machine?
2. What function now defines puck gameplay geometry truth?
3. What object defines release?
4. What drives visible puck during release clip?
5. When is auth allowed to affect visible puck position?
6. Are client and server using the same release origin and direction source?
7. If release still feels wrong, is the cause:
   - pose mismatch
   - shot object creation mismatch
   - clip duration / clip curve problem
   - handoff timing problem
   - stick presentation problem
