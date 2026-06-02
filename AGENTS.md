## Codex Goal Workflow

When this project is in Codex Goal mode and `docs/goal.md` exists:

1. Before doing active work, read this section, `docs/goal.md`, and `docs/goal-progress.md`.
2. Follow only the objective, scope, acceptance criteria, validation plan, and stop conditions in `docs/goal.md`.
3. Before ending each active work turn, update `docs/goal-progress.md` with completed work, validation evidence, risks/blockers, and the next step.
4. Keep `docs/goal.md` and `docs/goal-progress.md` during all active work turns.
5. If a Stop hook asks for a `<!-- codex-goal-turn: ... -->` marker, add the exact marker to `docs/goal-progress.md` before stopping again.
6. If work drifts from `docs/goal.md`, stop expanding scope and realign before continuing.
7. Only in the final completion turn, after all acceptance criteria are verified and final evidence is captured in the final response, delete `docs/goal.md` and `docs/goal-progress.md`.
8. Mark the Goal complete only after the workflow files are cleaned up.
