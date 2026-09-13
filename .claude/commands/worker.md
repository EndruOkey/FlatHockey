---
description: 'Autonomous FlatHockey worker orchestrator using direct tmux via bash. Analyzes, spawns relevant workers, gathers outputs, and synthesizes next actions.'
---

IT IS CRITICAL THAT YOU FOLLOW THESE STEPS:

<context>
<commandName>autonomous-worker</commandName>
<argument>ARGUMENT</argument>
</context>

<runtime>
Primary runtime: direct tmux via bash
Secondary runtime: WSL bridge via `wsl.exe -d Ubuntu -- ...` when native tmux or claude is unavailable in the current Bash tool environment
Optional transport: tmux-cli MCP only if explicitly available and proven working
Do not gate worker execution on `claude mcp list` or MCP health status
If native `tmux` and `claude` exist, use tmux worker mode directly
If native tools are unavailable, use WSL bridge tmux worker mode and convert paths with `wslpath`
Fallback only when neither native nor WSL bridge tmux runtime is available, or tmux session creation fails
Minimal runtime check:
- `command -v tmux >/dev/null 2>&1`
- `command -v claude >/dev/null 2>&1`
- `wsl.exe -d Ubuntu -- bash -lc 'command -v tmux >/dev/null 2>&1 && command -v claude >/dev/null 2>&1'`
</runtime>

<steps CRITICAL="TRUE">
1. Interpret the user request directly from ARGUMENT.
2. Do not ask the user for an additional slash command.
3. Do not ask the user for more params unless the request is genuinely ambiguous.
4. Use raw instructions as the worker payload.
5. Detect which FlatHockey subsystems are relevant:
   - movement
   - puck
   - combat
   - master synthesis
6. Use direct tmux worker orchestration via `.claude/scripts/worker-spawn.sh`, `.claude/scripts/worker-status.sh`, `.claude/scripts/worker-tail.sh`, and `.claude/scripts/worker-kill.sh`.
7. Generate focused prompt files in `.claude/tmp/` and create or recreate real tmux worker sessions.
8. Send focused instructions to the relevant workers. Use direct `tmux send-keys` only when a follow-up is truly needed.
9. Let each worker inspect current code and gather findings.
10. Use worker log files and exit codes as the source of truth.
11. Collect worker outputs.
12. Synthesize:
   - subsystem findings
   - contradictions
   - safest next implementation pass
   - exact recommended next action
13. Prefer analysis and actionable output by default.
14. Only create a spec or implementation plan if the user explicitly asks for it.
</steps>

FlatHockey project path:
`/mnt/c/Games/flathockey-move-rework`

Worker behavior rules:
- movement worker handles:
  - playerMovement
  - hockeyStop
  - turning
  - reorientation
  - prediction
  - charge movement coupling
- puck worker handles:
  - possession
  - pickup
  - one-timers
  - puck inertia
  - hold / release behavior
- combat worker handles:
  - crosscheck
  - charge / release states
  - strip logic
  - combat-to-puck coupling
- master worker synthesizes all findings into one implementation-ready recommendation

Output format:
1. relevant workers used
2. findings by subsystem
3. contradictions / uncertainties
4. safest next pass
5. exact recommendation

Runtime rules:
- Prefer direct tmux orchestration.
- Optional MCP integration may be used only if explicitly validated.
- Worker execution must remain functional without MCP.
