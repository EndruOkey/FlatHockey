# FlatHockey Visual Audit: Stick + Puck

You are a senior game developer auditing the visual quality of stick and puck rendering in a top-down 2D hockey game.

## Project path
/mnt/c/Games/flathockey-move-rework

## Your task
Read the following files and produce a structured diagnosis of visual problems with the stick and puck, then propose concrete fixes.

### Files to read:
1. `client/src/game/entities/playerView.ts` — createGripLayout, buildRenderPose, spring state, blade derivation
2. `client/src/game/render/stickRenderer.ts` — how stick is drawn layer by layer
3. `shared/src/stick/canonicalStickRig.ts` — physics stick geometry
4. `client/src/game/scenes/PondSceneRenderOps.ts` — puck draw, puckRender, playerCarryTargetWorld
5. `client/src/game/entities/playerBodyRig.ts` — body rig anchors, hand sockets

## What to diagnose

### Stick problems to look for:
- Does the shaft cross through the body? Top hand is on LEFT (gripSign = -handSign for right-handed), effectiveBladeBase is derived from visTopHand + shaftDir * visShaftLen. If shaft angle is wrong direction the shaft can cross body.
- Does the shaft stretch during charge? effectiveBladeBase = visTopHand + shaftDir * visShaftLen — visShaftLen might grow too large.
- Is the blade angle correct w.r.t. aim direction? bladeTipLocal = effectiveBladeBase + (physBTLocal - physBBLocal) — if phys blade delta is large, does it swing correctly?
- Is the puck contact point (carryAnchorX/Y in buildRenderPose) matching visual blade position?
- Does the shaft render behind body (back layer) or in front?
- During charge wind-up, is the windup direction correct for handedness?
- Are the hand positions (top=LEFT, bottom=RIGHT for right-handed) visually convincing?

### Puck problems to look for:
- Does the puck sit on the blade forehand (toe side) when held?
- Is `playerCarryTargetWorld` returning the right position — view.getCarryAnchorWorld() calls buildRenderPose.carryAnchorX/Y which should match visual blade position
- Does the puck jump on pickup/release transitions?
- Is the puck indicator halo in stickRenderer at the right spot (uses pose.carryAnchorX/Y)?
- Is there coordinate mismatch between puckRender.x/y (world coords) and what the blade renders at?

## Key current code facts
- `effectiveBladeBase = visTopHand + shaftDir * visShaftLen` (shaft-derived, NOT physBBLocal)
- `bladeTipLocal = effectiveBladeBase + (physBTLocal - physBBLocal)` (physics direction + length)
- `bladePuckContactLocal` at 0.75 ratio along blade (= 9/12wu = forehand toe-side)
- `carryAnchorX/Y` in renderPose = `bladePuckContactLocal` converted back to world space
- `getCarryAnchorWorld()` in PlayerView returns renderPose carryAnchorX/Y
- `playerCarryTargetWorld()` in PondSceneRenderOps calls getCarryAnchorWorld()

## Deliverable

For each problem found, output:
```
PROBLEM: <short title>
SEVERITY: high | medium | low
ROOT CAUSE: <exact code location + what is wrong>
FIX: <exact change needed>
```

Then: TOP 3 most impactful fixes in priority order. Be specific with variable names and line numbers.
