---
description: 'Execute tech spec and then quick development implementation using direct tmux workers with a spec file. Respond intelligently to worker questions, answer with context when possible, and minimize user interruptions.'
---

IT IS CRITICAL THAT YOU FOLLOW THESE STEPS:

CRITICAL: tech spec never implements work
quick dev only implements work

<runtime>
Primary runtime: direct tmux via bash
Secondary runtime: WSL bridge via `wsl.exe -d Ubuntu -- ...` when native tmux or claude is unavailable in the current Bash tool environment
Optional transport: tmux-cli MCP only if explicitly available and proven working
Do not gate worker execution on `claude mcp list` or MCP health status
If native `tmux` and `claude` exist, use tmux worker mode directly
If native tools are unavailable, use WSL bridge tmux worker mode and convert paths with `wslpath`
Fallback only when neither native nor WSL bridge tmux runtime is available, or tmux session creation fails
</runtime>

<step name="tech-spec">

<context>
<commandName>/bmad-bmm-quick-spec</commandName>
<argument>NULL</argument>
</context>

<steps CRITICAL="TRUE">
1. Create the tech spec only. Never implement here.
2. Determine required params.
3. Ask the user for params only if the task is genuinely ambiguous.
4. Follow `.claude/commands/worker/task/workflow.xml` exactly.
</steps>
</step>

<step name="quick-dev">

<context>
<commandName>/bmad-quick-dev-new-preview</commandName>
<argument>tech-spec file</argument>
</context>

<steps CRITICAL="TRUE">
1. Determine required params.
2. Ask the user for params only if the task is genuinely ambiguous.
3. Follow `.claude/commands/worker/task/workflow.xml` exactly.
</steps>
</step>

Runtime rules:
- Prefer direct tmux orchestration.
- Optional MCP integration may be used only if explicitly validated.
- Worker execution must remain functional without MCP.
