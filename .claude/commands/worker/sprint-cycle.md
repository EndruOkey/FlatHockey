---
description: 'Sprint cycle orchestrator: loops create-story -> dev-story until all backlog stories are done.'
---

## Sprint Cycle Orchestrator

Loops two BMAD stages - create-story and dev-story - until no `backlog` stories remain in `sprint-status.yaml`. Each iteration produces one story file and implements it. Both skills auto-discover the next story from `sprint-status.yaml`.

### Worker Runtime

- Primary runtime: direct tmux via bash
- Secondary runtime: WSL bridge via `wsl.exe -d Ubuntu -- ...` when native tmux or claude is unavailable in the current Bash tool environment
- Optional transport: tmux-cli MCP only if explicitly available and proven working
- Do not inspect `claude mcp list` as a gating condition
- Convert Windows paths to WSL paths with `wslpath` when bridge mode is selected
- Fallback only when neither native nor WSL bridge tmux runtime is available, or tmux session creation fails

**CRITICAL: Execute stages ONE BY ONE. Wait for each stage to fully complete before starting the next.**

### Iteration Stages

| Stage | Worker | Purpose | Expected Outcome |
|-------|--------|---------|------------------|
| A | /worker:command /bmad-bmm-create-story | Analyze artifacts, produce story file | Story status: backlog -> ready-for-dev |
| B | /worker:command /bmad-bmm-dev-story | Implement story via red-green-refactor | Story status: ready-for-dev -> review |
| C | Check sprint-status.yaml | Count remaining backlog stories | Decision: loop or exit |

### Execution Rules

1. **Create TODO list** with the following items at the start:
   - Read `sprint-status.yaml` and count initial backlog stories
   - Iteration 1 - Stage A: create-story
   - Iteration 1 - Stage B: dev-story
   - Iteration 1 - Stage C: check backlog
   - Add further iterations dynamically as the loop continues
   - Print the final sprint cycle report

2. **Initial gate**: Read `sprint-status.yaml` (look for `_bmad-output/implementation-artifacts/sprint-status.yaml` relative to project root). Parse `development_status`. Count stories with status `backlog` (story keys match pattern `N-N-*`, not `epic-*` and not `*-retrospective`). If zero backlog stories remain, stop.

3. **Begin loop** for each iteration:

   a. **Stage A - Create Story**: Execute `/worker:command /bmad-bmm-create-story`. Wait for full completion. Record which story was created.

   b. **Stage B - Dev Story**: Execute `/worker:command /bmad-bmm-dev-story`. Wait for full completion. Record which story was implemented.

   c. **Stage C - Backlog Check**: Read `sprint-status.yaml` again. Count remaining `backlog` stories using the same filtering as step 2. Record the count.
      - If backlog stories remain, add the next iteration stages to the TODO list and continue the loop.
      - If no backlog stories remain, exit the loop and proceed to the final report.

4. **Track across iterations**: Maintain a running list of:
   - Iteration number
   - Story key processed
   - Create-story result (success or fail)
   - Dev-story result (success or fail)

### Error Handling

- If any stage fails in any iteration, stop immediately. Report which iteration and stage failed, show the running summary of completed iterations, and ask the user how to proceed.

### Final Report

After the loop exits with no backlog stories remaining, print:

```text
## Sprint Cycle Complete

| Iteration | Story | Create Story | Dev Story |
|-----------|-------|--------------|-----------|
| 1         | ...   | ...          | ...       |
| 2         | ...   | ...          | ...       |
| ...       | ...   | ...          | ...       |

Total stories processed: N
Remaining backlog: 0
Stories now in review: N
```
