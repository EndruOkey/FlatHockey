You are the MASTER SYNTHESIS worker for FlatHockey. Project root: /mnt/c/Games/flathockey-move-rework

## Problem statement
The puck release after a charge shot is still extremely jerky. The release appears half a second late.
Developer is willing to do major rewrites. Diagnose the real root cause, then propose the best fix.

## Read ALL of these files

1. client/src/game/net/prediction.ts
2. client/src/game/scenes/PondSceneNetOps.ts
3. client/src/game/scenes/PondSceneUpdateLoop.ts
4. client/src/game/scenes/PondSceneRenderOps.ts
5. client/src/game/entities/playerView.ts
6. shared/src/stick/minimalStickRig.ts
7. shared/src/stick/canonicalStickRig.ts
8. server/src/game/roomSystems.ts  lines 215-520

## Core diagnostic question

WHEN puckSnapshot.state === 'HELD' and owner is local player, in PondSceneRenderOps.ts:
- Does puck rendering use playerCarryTargetWorld(scene, localPlayerId)?
- playerCarryTargetWorld returns view.getCarryAnchorWorld() = computePhysicsPose().bladeContactX/Y
- computePhysicsPose uses this.stickState (set by prediction to 'release' at T=0)
- computePhysicsPose uses this.stickTimer (counting down from 0.25s since T=0)

IF this is correct, then from T=0 (LMB keyup) to T+RTT (server snapshot with FREE):
- puck IS already following the swinging blade (because puckSnapshot.state=HELD, follows blade)
- no discontinuity needed

The puck BRIDGE might actually be FIGHTING this working system by:
- Re-attaching the puck to the blade (already attached via HELD path)
- But with different stickTimer/releaseProgress values (bridge reads playerRenderWorldStates
  which might have stale stickTimer from snapshot, not from prediction)

## Timing analysis: trace exactly what happens

For local player shot, RTT=30ms, server tick=50ms:

T=0: LMB released. Client prediction immediately sets stickState='release', stickTimer=0.25s
     puckSnapshot.state = HELD (last server snapshot said HELD)
     Puck render: HELD path -> playerCarryTargetWorld -> blade at releaseProgress=0 (wound-back) OK

T=16ms (frame 1): stickTimer = 0.25 - 0.016 = 0.234s, releaseProgress=0.064
     Puck render: HELD -> blade at releaseProgress=0.064. Blade sweeping. Puck follows. OK

T=50ms (server tick): server processes LMB release, fires shot, puck becomes LOOSE, stickState=release
     stickTimer on server = 0.25s at this tick

T=80ms (RTT 30ms after tick 50ms): snapshot arrives with puck FREE, stickState=release, stickTimer=0.2s
     Client detects HELD->FREE: starts puckBridge (remainingMs=100ms)
     reconcilePrediction: sets predicted.stickTimer = 0.20 (server value)
     But client prediction had stickTimer = 0.25 - 0.08 = 0.17s!
     JUMP: stickTimer from 0.17s to 0.20s = releaseProgress jumps from 0.32 to 0.20
     Blade SNAPS BACKWARD by 0.12 * 50deg = 6 degrees
     Puck (now on bridge) ALSO snaps backward with the blade

This explains the jerk: reconciliation resets stickTimer to a server value that does not
match the client prediction, causing the blade (and puck-on-blade) to snap.

## Additionally check

In reconciliation.ts: predicted.stickTimer = authoritative.stickTimer
- Does it always overwrite stickTimer? Even during release state?
- Should it skip stickTimer overwrite if stickState matches (both are 'release') to prevent jerk?

In prediction.ts timer decrement:
- Where exactly is stickTimer decremented?
- By what dt? CLIENT_FIXED_DT or actual frame dt?
- Does it decrement before or after stickState is set?

## The releaseDurationSec = 0.25s problem

This was changed from 0.08s to 0.25s for the follow-through animation.
But this makes the reconciliation jerk window 3x larger.
At 0.08s: max stickTimer mismatch ~16ms = 20% of animation = ~10 degree jerk
At 0.25s: max stickTimer mismatch ~66ms = 26% of animation = ~13 degree jerk
Plus the puck bridge rides the jerking blade.

## Four proposed solutions

### Solution 1: Skip stickTimer reconciliation during release (minimal change)
In reconciliation.ts: if both server and client stickState === 'release', skip stickTimer overwrite.
Client keeps its own countdown. Server state is ignored for timer.
Downside: client and server release duration diverge in high-latency scenarios.
But: no jerk, and 0.25s animation plays cleanly.

### Solution 2: Revert releaseDurationSec to 0.08s + keep follow-through formula
The 2-phase follow-through formula in minimalStickRig.ts is good.
But at 0.08s total, the snap phase (0.4*0.08 = 32ms = 2 frames) is still visible.
The reconciliation jerk is only 5ms = barely noticeable.
Change: releaseDurationSec = 0.08s in BOTH canonicalStickRig.ts and minimalStickRig.ts.
Effect: fast powerful shot with slight follow-through. No bridge needed.

### Solution 3: Remove puck bridge entirely, fix puck rendering during HELD+release
If the HELD path already correctly follows the predicted blade position (blade at releaseProgress),
the puck bridge is redundant and fighting the system. The bridge then causes a double-assignment.
Remove bridge. Check if HELD path alone gives good results.

### Solution 4: Predicted puck simulation (correct but large)
Add predicted puck position to PredictedPlayerState:
- At shot release: compute shot velocity, set predicted.puckX/Y/VX/VY
- Each frame: simulate predicted.puckX += predicted.puckVX * dt (with damping)
- Puck render: if local player just released, use predicted puck position
- Reconcile: when server FREE puck arrives, blend toward server position if error < 30px
This completely eliminates server-roundtrip dependency for puck visual.
Requires: ~80 lines added to prediction.ts, small change to PondSceneRenderOps.ts.

## What to report

1. Is the HELD-path puck tracking working? (puck follows blade during hold+predicted-release)
2. Exact cause of the jerk: reconciliation stickTimer overwrite? Bridge fighting HELD path?
3. Is the puck bridge making things WORSE?
4. Best solution from the 4 above, with exact file changes
5. If Solution 4 (predicted puck), write the complete implementation
