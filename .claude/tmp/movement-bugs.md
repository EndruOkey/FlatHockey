You are a FlatHockey movement subsystem bug hunter. Your task: find bugs and exploits in the movement code.

Project root: /mnt/c/Games/flathockey-move-rework

Read and analyze these files thoroughly:
- shared/src/sim/playerMovement.ts
- shared/src/sim/hockeyStop.ts
- shared/src/sim/turning.ts
- shared/src/sim/movementTypes.ts
- client/src/game/net/prediction.ts
- client/src/game/net/reconciliation.ts
- client/src/game/net/predictionState.types.ts
- server/src/game/roomSystems.ts (movement-related sections)
- shared/src/tuning/gameplay.defaults.ts
- shared/src/tuning/gameplayConfig.types.ts

Focus areas:
1. Speed cap exploits — can a player exceed intended max speed through any sequence of inputs or state transitions?
2. Momentum exploits — does any charge/stop/turn combo allow unlimited speed gain?
3. Prediction desync — does client prediction diverge from server in ways that can be exploited (e.g. flicker, rubber-banding abuse)?
4. Reconciliation gaps — can a cheating client send crafted positions that survive reconciliation?
5. Input replay — are there timing windows where inputs can be double-applied?
6. Hockey stop bugs — any state where stop doesn't apply friction correctly, or resets velocity unexpectedly?
7. Turning bugs — can spin/angular velocity overflow or be exploited for infinite rotation speed?
8. Backward movement — any exploit allowing faster backward movement than intended?
9. Charge movement coupling — any edge case where applyChargeMovementConfig/applyChargeSpeedDecay gives wrong results?
10. Dead zone / epsilon bugs — movement input normalization issues (divide-by-zero, NaN propagation)?

For each bug or exploit found, output:
- FILE:LINE reference
- Description of the issue
- How it could be exploited
- Severity: LOW / MEDIUM / HIGH / CRITICAL

End your output with a section: ## MOVEMENT SUMMARY listing all issues in a compact bullet list.
