You are a FlatHockey puck subsystem bug hunter. Your task: find bugs and exploits in puck possession, pickup, and inertia code.

Project root: /mnt/c/Games/flathockey-move-rework

Read and analyze these files thoroughly:
- shared/src/sim/puckPossession.ts
- shared/src/sim/puckPickup.ts
- shared/src/sim/puckInertia.ts
- shared/src/sim/stickZone.ts
- shared/src/net/messages.ts
- shared/src/net/protocol.ts
- server/src/game/room.ts
- server/src/game/room.types.ts
- server/src/game/roomSystems.ts (puck-related sections)
- shared/src/tuning/gameplay.defaults.ts

Focus areas:
1. Pickup exploits — any sequence that lets a player pick up the puck outside the intended angle/radius gate?
2. Possession duplication — can two players simultaneously own the puck (state machine flaw)?
3. One-timer abuse — any timing window where shot charge persists beyond the grace window and fires late?
4. Hard-attach bypass — can a player keep the puck attached while doing otherwise-impossible maneuvers?
5. Strip bypass — any instability calculation error that makes the puck unstrippable (e.g. threshold never reached)?
6. Repickup lockout bypass — can the 200ms owner lockout be circumvented?
7. Force-break spam — can repeated forced breaks be triggered to create unstable puck behavior?
8. Velocity inheritance bugs — shot/pass/drop velocity calculations; any case giving more speed than intended?
9. Spin exploits — any sequence giving the puck more spin than the cap allows?
10. State desync — does the FREE/HELD network message faithfully reflect server state? Any window where client thinks it has the puck but server disagrees?
11. Protected window abuse — can the 120ms PROTECTED_OWNED window be extended or re-triggered?
12. Sweet spot edge cases — lateral offset calculations at exactly ±0.3; NaN or boundary bugs?
13. Network message gaps — are there missing fields or truncated messages that could cause inconsistency?

For each bug or exploit found, output:
- FILE:LINE reference
- Description of the issue
- How it could be exploited
- Severity: LOW / MEDIUM / HIGH / CRITICAL

End your output with a section: ## PUCK SUMMARY listing all issues in a compact bullet list.
