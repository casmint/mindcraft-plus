# Notes for future Codex work

Treat this worktree as potentially dirty. Inspect `git status`, preserve unrelated edits, and do not edit `references/` for Plus changes.

Before changing behavior, identify whether it belongs in: profile instructions, instinct policy, direct command/skill runtime, reactive modes, durable task state, or a future graph. Do not move Surfski-specific identity into a generic backend workspace.

Prefer deterministic runtime geometry, safety checks, and verification over asking the model to infer local world state from prose. Keep LLM-facing context compact; avoid echoing generated source or repetitive action logs into history.

For any movement/action change, check cancellation, `GoalChanged`, controls in `finally`, pathfinder/PVP stopping, and physical-rate admission. For water or combat work, test both ordinary and emergency paths. For docs, distinguish **Implemented**, **WIP**, and **Planned** and cite the exact module/configuration rather than guessing.

Run `npm run test:runtime`, appropriate `node --check` commands, and `git diff --check` before handoff.

Update the relevant `docs/plus/` files in the same patch whenever adding a runtime feature.
