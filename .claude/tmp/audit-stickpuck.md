# Stick+Puck Audit Task

Audit whether it's worth deleting the stick, hands, and puck systems completely and rewriting from scratch.

## Context already gathered by main agent

### Files read:
- `shared/src/stick/canonicalStickRig.ts` — "Phase 1" canonical rig, body-local space, 8+ modes
- `shared/src/stick/minimalStickRig.ts` — "Phase A" minimal rig, 3 states (carry/charge/release), world-space
- `client/src/game/render/stickRenderer.ts` — imports `MinimalStickPose`, renders from it
- `client/src/game/entities/playerView.ts` — imports BOTH rigs, has split render paths
- `server/src/game/roomSystems.ts` — uses `computeMinimalStickPose` for ALL gameplay

### Key findings so far:

#### FINDING 1: Two competing stick rigs both active simultaneously
- `canonicalStickRig.ts` — body-local, 8+ states, complex blending → `StickRigWorld`
- `minimalStickRig.ts` — world-space, 3 states → `MinimalStickPose`

#### FINDING 2: Split consumption
- Server: uses `computeMinimalStickPose()` → bladeContactX/Y for ALL gameplay (hard attach, pickup, crosscheck, shot, pass) ✓
- Client `playerView.draw()`: calls `computePhysicsPose()` → `computeMinimalStickPose()` for stick render ✓
- Client `playerView.createStickPose()`: calls `computeStickRigWorld()` (canonical) → for `physicsStickPose` field
- Client `stickRenderer.ts`: accepts `MinimalStickPose` only

#### FINDING 3: `draw()` and `resolveBodyRig()` are separate paths
- `draw()` calls `createBodyRig()` then `computePhysicsPose()` (minimal) — this is the actual render path
- `resolveBodyRig()` calls `createBodyRig()` + `createStickPose()` (canonical) + `createPresentationRig()` + `createGripLayout()`
- `draw()` NEVER calls `createGripLayout()` — the spring-animated hand positions from `createGripLayout()` are NOT applied in the actual render frame

#### FINDING 4: createGripLayout() system is orphaned in render path
- `createGripLayout()` is ~300 lines of spring state (`visTopHand`, `visShaftAngle`, `visBottomHandFree`, `visBottomAttachBlend`)
- Its output feeds `bodyRig.leftHandSocket/rightHandSocket` → used by playerBodyRenderer for hand positions
- But `draw()` calls `createBodyRig()` WITHOUT `createPresentationRig()`, so spring-animated sockets never reach renderPlayerBody in the actual draw() path

#### FINDING 5: Dead types
- `PhysicsStickPose`, `RenderStickPose`, `StickRigWorld` — canonical types still imported but the actual physics (server) and render both use `MinimalStickPose`
- `renderStickPose: RenderStickPose | null` computed in `resolveRenderStickPose()` but `draw()` uses `computePhysicsPose()` instead

#### FINDING 6: Crosscheck state gap
- `toMinimalState()` maps `crosscheck` → `'carry'` (server uses carry geometry for crosscheck stick)
- `stickStateToRigMode()` maps `crosscheck` → `'crosscheck'` (canonical only — not in minimal rig)
- When crosscheck is held, the stick visually renders in carry mode (no crosscheck visual)

## Your task:
Please read the following files to complete the audit and provide the verdict:

1. `client/src/game/entities/playerBodyRig.ts` — check how leftHandSocket/rightHandSocket are used
2. `client/src/game/render/playerBodyRenderer.ts` — check if it actually reads leftHandSocket/rightHandSocket
3. `client/src/game/scenes/PondSceneUpdateLoop.ts` — check how playerView.draw() is called and whether resolveBodyRig/getCarryAnchorWorld are called in same frame
4. Check if `getCarryAnchorWorld()` (uses minimal) vs `getStickBladeWorld()` (uses canonical) diverge significantly in practice

Then provide:
- Confirmation or correction of the 6 findings above
- Verdict: delete+rewrite vs targeted cleanup
- If cleanup: exact list of what to delete/keep
- If rewrite: what the clean architecture should look like
