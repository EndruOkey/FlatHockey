You are the COMBAT+PUCK worker for FlatHockey. Project root: /mnt/c/Games/flathockey-move-rework

## Context
The charge→shot release animation is still not smooth. Previous fixes:
- chargeReleasePose captured before stickState overwrite in roomSystems.ts
- peakChargeAngle now flows through full pipeline (wire + interpolator + prediction)
- releaseCharge wired to minimalStickRig
- minimalStickRig release case uses peakChargeAngle (guard changed to !== undefined)

## Task
Read the current state of the code and find ALL remaining reasons why the shot release would not look smooth. Focus on:

1. The visual release animation itself (stick swing)
2. The puck visual during the release frame
3. Timing mismatches between server state and client render
4. The releaseTimer vs stickTimer duality

## Files to read (ALL of these)

1. shared/src/stick/minimalStickRig.ts
   - Read the full release case
   - What does the lerp sweep look like? peakAngle → aimAngle over releaseProgress 0→1
   - Is the sweep direction correct (wound-back → forward = natural swing)?
   - What is the sweep ANGLE RANGE? E.g. at chargeOffsetFactor=0.28 and full charge:
     chargeOffset = -PI * 0.28 * handSign ≈ ±0.88 rad ≈ ±50°
     peakAngle = aimAngle + chargeOffset (wound back 50° from aim)
     lerp(peakAngle, aimAngle, t) sweeps 50° over 0.08s
     Is that enough to be visually noticeable? Too fast? Too slow?

2. server/src/game/roomSystems.ts
   - Lines 235–260: the chargeReleasePose capture + stickState overwrite block
   - Lines 453–500: the justReleasedShoot block
   - After the fixes: is chargeReleasePose definitely computed with state='charge'?
   - Is peakChargeAngle = chargeReleasePose.stickAngle set AFTER owner.stickState is overwritten?
   - releaseTimer vs stickTimer: both set at line 490-491. What are their values?
     CANONICAL_STICK_CONFIG.releaseDurationSec vs MINIMAL_STICK_CONFIG.releaseDurationSec
     Are they the same value? If different, which one drives the client visual?

3. client/src/game/entities/playerView.ts
   - computePhysicsPose: how is releaseProgress computed?
     Is it from stickTimer or releaseTimer? What field name on the predicted state?
   - setStickVisualState: does it now accept peakChargeAngle as 6th param?
   - Is peakChargeAngle assigned to this.peakChargeAngle?
   - What is the declared type of this.peakChargeAngle (initialized to 0)?
   - Is this.stickTimer set from stickTimer param (not releaseTimer)?

4. client/src/game/scenes/PondSceneUpdateLoop.ts
   - Line ~201: setStickVisualState call — what is the stickTimer arg?
     Is it state.stickTimer (correct) or some releaseTimer field?
   - Does the state object have a releaseTimer field? If so, does it flow through?

5. client/src/game/net/prediction.ts
   - After justReleasedShoot branch sets predicted.stickState = 'release':
     - predicted.stickTimer = CANONICAL_STICK_CONFIG.releaseDurationSec — what value?
     - predicted.releaseCharge = predicted.shotCharge — correct
     - predicted.peakChargeAngle = computed formula — is it correct?
   - How is stickTimer decremented in the prediction loop? (look for stickTimer -= dt or similar)

6. shared/src/tuning/gameplay.defaults.ts OR shared/src/tuning/gameplayConfig.types.ts
   - Is there a shotChargeRate tuning value? What is the default?
   - How fast does charge build? At what rate does the player typically release?

## Specific questions

### The double-timer problem
The server sets BOTH:
- owner.stickTimer = CANONICAL_STICK_CONFIG.releaseDurationSec  (line ~490)
- owner.releaseTimer = MINIMAL_STICK_CONFIG.releaseDurationSec  (line ~491)

The client computePhysicsPose uses  for releaseProgress.
setStickVisualState receives stickTimer from state.stickTimer.

Q: Are CANONICAL_STICK_CONFIG.releaseDurationSec and MINIMAL_STICK_CONFIG.releaseDurationSec the same value?
   Look in shared/src/stick/canonicalStickRig.ts and shared/src/stick/minimalStickRig.ts.

Q: On the client, which field drives the release animation — stickTimer or releaseTimer?
   If stickTimer is decremented by prediction tick but releaseTimer is never sent on wire,
   do remote players get a frozen releaseProgress?

### The snap-back problem
At progress=1 (animation done), stickAngle = aimAngle (carry position).
But aimAngle changes every frame as the player moves the mouse!
So the end position is moving. Is the lerp actually stable?

### The charge state visual during charge
In charge state: stickAngle = aimAngle + chargeOffset * charge01
As charge01 builds from 0→1, the stick winds back continuously.
Q: Does the stick actually VISUALLY wind back as the player holds shoot?
   Or does charge01 stay 0 on the client somehow?

### peakChargeAngle=0 fallback
In minimalStickRig.ts, the release case now has:
  if (input.peakChargeAngle !== undefined) { peakAngle = input.peakChargeAngle; }
  else { peakAngle = aimAngle + chargeOffset * releaseCharge; }

Q: What is the initial value of this.peakChargeAngle in playerView.ts?
   If it's 0 (not undefined), the guard passes and peakAngle=0 is used on first frame.
   This would cause the stick to start from angle=0 (probably off-screen) on release frame 1.
   Fix: initialize to undefined, or use a different sentinel.

## Output format
1. Bugs / issues found: file:line — what — why — fix
2. The complete release animation as it currently works (step by step)
3. What the user sees vs what should happen
4. Recommended fixes in priority order

Be precise. Include exact values where possible.
