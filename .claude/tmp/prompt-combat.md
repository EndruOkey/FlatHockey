You are the COMBAT worker for FlatHockey. Project root: /mnt/c/Games/flathockey-move-rework

## Task
Audit the charge->shot pipeline end-to-end and find exactly what is broken.

## Files to read (ALL of these)
1. shared/src/stick/minimalStickRig.ts
2. shared/src/stick/canonicalStickRig.ts
3. server/src/game/roomSystems.ts
4. server/src/game/room.types.ts
5. client/src/game/entities/playerView.ts

## Questions to answer

### minimalStickRig.ts — release case
- What is the formula for peakAngle in the release case?
- Is releaseCharge=0 a valid fallback (no wind-up shot)?
- Does lerp from peakAngle -> aimAngle sweep the stick forward correctly?
- Is charge01 passed correctly for charge state?

### roomSystems.ts — charge/release state machine
Find and report exact line numbers for:
  a) shoot pressed -> stickState = charge
  b) shotCharge accumulation per tick
  c) shoot released -> stickState = release, capture releaseCharge + peakChargeAngle + releaseTimer
  d) releaseTimer countdown -> back to neutral
  e) shot velocity applied to puck (exact moment and formula)

### room.types.ts
- List all fields: stickState, shotCharge, releaseCharge, peakChargeAngle, releaseTimer, oneTimerGrace
- Which are optional vs required?

### playerView.ts
- setStickVisualState params — does it accept releaseCharge and peakChargeAngle?
- Where is peakChargeAngle updated on the client? Is it ever set from server state?
- computePhysicsPose: are releaseCharge and peakChargeAngle both passed to computeMinimalStickPose?
- stickTimer: how is it decremented, from what value, and does it match releaseDurationSec?

## Output format
1. Bugs found: file:line — what is wrong — what it should be
2. Charge->release->neutral state transition with captured values at each step
3. Server vs client mismatch for releaseCharge / peakChargeAngle
4. Minimal fix recommendation for each bug

Be precise. No filler.
