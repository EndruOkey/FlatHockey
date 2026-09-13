You are the MASTER SYNTHESIS worker for FlatHockey. Project root: /mnt/c/Games/flathockey-move-rework

## Goal
The shot release still does not look natural. Find the BEST possible solution — structural changes are allowed.
Do not just find bugs. Think from first principles about what a natural shot release should look like and
how the current architecture enables or prevents that.

## Read ALL of these files completely

1. shared/src/stick/minimalStickRig.ts
2. server/src/game/roomSystems.ts lines 215-550
3. client/src/game/entities/playerView.ts
4. client/src/game/scenes/PondSceneUpdateLoop.ts lines 120-220
5. client/src/game/net/prediction.ts
6. shared/src/stick/canonicalStickRig.ts
7. shared/src/tuning/gameplay.defaults.ts

## What a natural shot looks like

In real hockey:
1. Player winds up (charge) — blade moves BACK from aim direction
2. Player releases — blade SNAPS quickly through aim direction (fast, powerful)
3. Puck leaves blade at or just past aim direction
4. After contact: stick CONTINUES past aim (follow-through), then returns to carry

Current model:
- charge state: stickAngle = aimAngle + chargeOffset * charge01 (winds BACK)
- release state: lerp(peakAngle, aimAngle, releaseProgress) — ends AT aim direction

Problems this causes:
a) No follow-through past aim — looks like player stops halfway
b) releaseDurationSec = 0.08s = only ~5 frames at 60fps — too fast to see OR too slow for snap feel
c) The animation speed is CONSTANT (linear lerp) — a real shot is fast then decelerates

## Architecture options to evaluate

### Option A: Follow-through extension (minimal structural change)
Split release into 2 sub-phases within single release state, using a midpoint:
- t=0.0 to 0.4 of releaseProgress: lerp(peakAngle, aimAngle + followAngle) — fast snap through contact
- t=0.4 to 1.0 of releaseProgress: lerp(aimAngle + followAngle, aimAngle) — decelerate return
Where followAngle = -chargeOffset * 0.6 * releaseCharge (overshoot past aim in opposite direction of wind-up)
Duration: 0.25s total (15 frames — enough to perceive as animation, not snap)

Requires: only minimalStickRig.ts release case + increase releaseDurationSec to 0.25s
Server must also increase stickTimer to match new duration.
Wire: no changes needed.

### Option B: Client-only visual follow-through (zero server impact)
Server keeps 0.08s release for puck accuracy. Client adds a purely visual animation layer.
- When stickState transitions to release on client, start a client-side visual timer (0.25s)
- Client renders custom animation curve regardless of stickTimer
- Animation: fast snap (0.08s) + follow-through + return (0.17s more)
- After animation ends, return to carry render

Requires: animation state machine in playerView.ts. Server unchanged. Wire unchanged.
Works for remote players only if we handle the visual in playerView.draw() independently.

### Option C: Easing curve on existing lerp (zero structural change)
Keep current 2-point lerp but use non-linear t (ease-out):
- t_eased = 1 - (1-t)^3  (cubic ease-out — starts fast, decelerates)
This makes the snap feel more like a real shot impact even without follow-through.
Additionally extend duration from 0.08s to 0.15s.

Requires: one line change in minimalStickRig.ts + duration tweak.
No server changes if we keep same stickTimer value and just add easing.
BUT: end position is still aimAngle — no follow-through.

### Option D: Two-state model release + follow_through
Add MinimalStickState = 'follow_through'.
- release (0.06s): fast snap from peakAngle to aimAngle + followAngle (overshoot)
- follow_through (0.18s): slow return from overshoot back to carry
Server sets stickState=release, then after timer: transitions to follow_through automatically.

Requires: new state in minimalStickRig.ts + roomSystems.ts + prediction.ts + reconciliation.ts
Most natural result. Most work.

### Option E: Extend existing lerp past aim (simplest structural change)
Change the release lerp endpoint:
  stickAngle = lerp(peakAngle, aimAngle + followAngle, nonLinearT)
Where followAngle = -chargeOffset * 0.5 * releaseCharge
And nonLinearT = a 2-phase curve that overshoots aimAngle and returns.

Single formula in minimalStickRig.ts. Duration stays at 0.08s (fast) or extends to 0.18s.

## For each option evaluate

1. Server changes needed? (stickTimer duration, new state, new fields)
2. Wire changes needed?
3. Works for remote players via interpolation?
4. Visual quality (1-5): does it look like a real hockey shot?
5. Risk of regression for puck detach, blade contact, pickup gate
6. Lines changed estimate

## Additional diagnosis to run first

Before evaluating options, answer:

### Actual current values
From minimalStickRig.ts:
- releaseDurationSec value
- chargeOffsetFactor value
- At 60fps: how many frames is the current release? (releaseDurationSec * 60 = ?)
- At 30fps (server): how many ticks? (releaseDurationSec * 30 = ?)
- Maximum wind-back angle in degrees: PI * chargeOffsetFactor * 180/PI = ?

From canonicalStickRig.ts:
- Is releaseDurationSec the same as in minimalStickRig?

From gameplay.defaults.ts:
- shotChargeRate (how fast charge builds)
- shotBaseImpulse, shotMaxImpulse

### stickTimer timing on client
From prediction.ts:
- When stickState='release', what value does stickTimer get?
- Where exactly is stickTimer decremented? (before or after stick pose is computed)
- In playerView.ts computePhysicsPose: releaseProgress = 1 - stickTimer/releaseDurationSec?
  At frame 0: stickTimer=releaseDurationSec, releaseProgress=0 (correct start)
  Problem: if stickTimer is decremented BEFORE pose is computed, frame 0 starts at
  releaseProgress = dt/releaseDurationSec (not 0) — animation starts already advanced

### The charge visual problem
Is shotCharge actually building on the client while the player holds shoot?
In prediction.ts: when shooting=true, does shotCharge increment by shotChargeRate*dt?
In computePhysicsPose: does it pass charge01: this.shotCharge?
If charge does not visually build, the player never sees the wind-back, so the release
has nothing to snap FROM, making the whole thing feel broken regardless of fixes.

## Output format

1. Current values (exact numbers from code)
2. Diagnosis: EXACTLY why the release looks wrong (what the player actually sees, step by step)
3. Option comparison table
4. SINGLE best recommendation with exact implementation:
   - Option letter and name
   - File-by-file changes with exact new code
   - Why this is the best tradeoff
