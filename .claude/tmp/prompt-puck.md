You are the PUCK worker for FlatHockey. Project root: /mnt/c/Games/flathockey-move-rework

## Task
Audit the shot release puck velocity pipeline and the charge->shot visual smoothness problem.

## Files to read (ALL of these)
1. shared/src/sim/puckInertia.ts        — computeShotRelease, computePassRelease
2. server/src/game/roomSystems.ts       — shot firing block (search for computeShotRelease)
3. shared/src/sim/puckPossession.ts     — instability tick, possession states
4. shared/src/net/messages.ts          — what fields are sent from server to client for stick state
5. client/src/game/scenes/PondSceneNetOps.ts — how server stick state updates playerView
6. client/src/game/entities/playerView.ts    — setStickVisualState, what fields are synced

## Questions to answer

### puckInertia.ts
- computeShotRelease signature: what inputs does it take (shotCharge, bladeForward, playerVel)?
- What is the output velocity formula? Is it additive with player velocity?
- Is there a minimum shot speed for low-charge shots?

### roomSystems.ts — shot firing
Find the block that fires the shot (transitions puck from OWNED to LOOSE with velocity):
  - Exact line where computeShotRelease is called
  - What is passed as shotCharge at that moment?
  - Is the puck released (state=LOOSE) on the SAME tick as the shot fires, or deferred?
  - Is there a check for "justReleasedShoot" or similar — report the exact variable name and value

### messages.ts + PondSceneNetOps.ts + playerView.ts
- When the server sends a player state update, which stick-related fields are included?
  List: stickState, shotCharge, releaseCharge, peakChargeAngle, releaseTimer — which are on wire?
- In PondSceneNetOps, when a player update is received, does it call setStickVisualState?
  If so, what args are passed?
- Is peakChargeAngle ever transmitted to the client? If not, the release animation on remote
  players will always start from wrong angle.

## Output format
1. Bugs found: file:line — what is wrong — what it should be
2. Shot firing sequence: exact tick order of events (puck detach, velocity apply, state change)
3. Network sync gaps: which fields missing from wire protocol
4. Minimal fix recommendation for each bug

Be precise. No filler.
