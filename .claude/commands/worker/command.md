---
description: 'Execute a worker command through direct tmux via bash. Creates a prompt file, spawns a real tmux worker, waits for completion, and collects logs/state without requiring MCP.'
---

IT IS CRITICAL THAT YOU FOLLOW THESE STEPS:

<context>
<commandName>`$COMMAND_ARGUMENT`</commandName>
<argument>`ARGUMENT`</argument>
</context>

<runtime>
Primary runtime: direct tmux via bash
Secondary runtime: WSL bridge via `wsl.exe -d Ubuntu -- ...` when native tmux or claude is unavailable in the current Bash tool environment
Optional transport: tmux-cli MCP only if explicitly available and proven working
Do not gate worker execution on `claude mcp list` or MCP health status
If native `tmux` and `claude` exist, use tmux worker mode directly
If native tools are unavailable, use WSL bridge tmux worker mode and convert paths with `wslpath`
Fallback only when neither native nor WSL bridge tmux runtime is available, or tmux session creation fails
</runtime>

<steps CRITICAL="TRUE">
1. Collect the full task description, including used files and gathered context.
2. Determine the effective <commandName> and required params.
3. Ask the user for params only if the request is genuinely ambiguous.
4. Follow `.claude/commands/worker/task/workflow.xml` exactly to build the prompt, spawn the tmux worker, and monitor completion.
5. Prefer direct tmux orchestration for every worker run.
</steps>

Runtime rules:
- Prefer direct tmux orchestration.
- Optional MCP integration may be used only if explicitly validated.
- Worker execution must remain functional without MCP.
