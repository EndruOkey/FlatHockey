---
description: 'Universal workflow builder. Discovers available capabilities, builds a task-appropriate chain, then executes workers via direct tmux runtime.'
---

## Universal Workflow - Dynamic Delegated Workers

Pipeline-style orchestrator that decides what workers to spawn based on the task. It does not have hardcoded stages beyond the initial scout. It evaluates the task and builds the chain at runtime.

### Worker Runtime Decision Tree

1. Run `command -v tmux >/dev/null 2>&1`.
2. Run `command -v claude >/dev/null 2>&1`.
3. If both commands are available, use native tmux worker mode.
4. Otherwise run `wsl.exe -d Ubuntu -- bash -lc 'command -v tmux >/dev/null 2>&1 && command -v claude >/dev/null 2>&1'`.
5. If the WSL check passes, use WSL bridge tmux worker mode and convert Windows paths with `wslpath`.
6. Do not inspect `claude mcp list` as a gating condition.
7. Do not require tmux-cli MCP tools for worker execution.
8. Fallback mode is allowed only when neither native nor WSL bridge tmux runtime is available, or tmux session creation fails.

Optional MCP integration may be used only if it is explicitly validated, but worker execution must remain functional without it.

**CRITICAL: Execute stages ONE BY ONE. Wait for each stage to fully complete before starting the next.**

IT IS CRITICAL THAT YOU FOLLOW THESE STEPS:

---

### Stage 1: Run Scout

Always run the scout first:

```text
/worker:universal-workflow:scout $ARGUMENTS
```

Wait for the scout to complete and collect the capability report.

---

### Stage 2: Evaluate Task and Build Chain

Analyze the user's task (`$ARGUMENTS`) against the scout's capability report. Determine what work is needed and build an ordered chain of stages.

**Decision rules** - add each matching stage:

| Condition | Stage to add | How |
|-----------|--------------|-----|
| Task needs investigation | Detective | Invoke `/worker:detective` |
| Task needs a technical specification | Tech Spec | Invoke `/worker:tech-spec` |
| Task needs code implementation | Quick Dev | Invoke `/worker:quick-dev` |
| Task needs browser testing | Chrome | Invoke `/worker:chrome` |
| Task needs something not covered by existing workers | Custom Worker | Compose a `<context>` block with `<message>` + `<windowName>` + `<permissions>` and execute `workflow.xml` directly |
| Task maps to exactly one existing worker | Single Worker | Invoke that one worker and stop building the chain |

**Composing custom workers**:

1. Choose a descriptive `<windowName>` such as `research`, `analysis`, or `migration`.
2. Write a focused `<message>` with a TODO list. Keep one concern per worker.
3. Set appropriate `<permissions>` such as read-only for research or full for implementation.
4. Execute via `.claude/commands/worker/task/workflow.xml`.

**Chain ordering**:

- Investigation and research first
- Specification after investigation
- Implementation after specification
- Testing and validation last

---

### Stage 3: Execute the Chain

Do not ask the user for approval. Proceed immediately.

1. Create a TODO list with all planned stages at the start.
2. For each stage in the chain:
   - For existing workers, invoke `/worker:*` with the appropriate arguments and include context from previous stages.
   - For custom workers, compose the `<context>` block and follow `workflow.xml`.
   - Wait for completion before starting the next stage.
   - Collect results to pass forward.
3. If a stage fails, stop immediately. Report which stage failed and why. Ask the user how to proceed.

**Passing context forward**:

- Each stage's output becomes input context for the next stage.
- Include file paths, summaries, and key findings from previous stages as arguments.
- Be exhaustive enough for the next worker to act without missing context.

---

### Stage 4: Final Summary

After all stages complete, print:

```text
## Workflow Complete: "<task description>"

| Stage | Worker | Session | Status | Output |
|-------|--------|---------|--------|--------|
| 1     | scout  | scout   | ...    | capability report |
| 2     | ...    | ...     | ...    | ... |
| ...   | ...    | ...     | ...    | ... |

Total stages: N
```

---

### Examples

`investigate task 12345` -> scout -> detective
`create spec and implement booking feature` -> scout -> detective -> tech-spec -> quick-dev
`test checkout in browser` -> scout -> chrome
`research BMAD architecture patterns` -> scout -> custom research worker
`full pipeline for task 12345` -> scout -> detective -> tech-spec -> quick-dev

---

**CRITICAL: Scout is the only fixed stage - everything else is dynamic**
**CRITICAL: Each stage runs in its own tmux worker session - never mix concerns**
**CRITICAL: Prefer direct tmux orchestration**
**CRITICAL: Optional MCP integration may be used only if explicitly validated**
**CRITICAL: Worker execution must remain functional without MCP**
