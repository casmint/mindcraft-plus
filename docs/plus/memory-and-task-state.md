# Memory and task state

Bot data lives under `bots/<botName>/`. Memory and durable task state have different jobs.

- `memory.json` is conversational/world summary state. It may be compacted, reset, or empty.
- `task_state.json` is the authoritative durable active-goal record. An empty memory summary must not erase it.
- `runtime_settings.json` stores local runtime overrides such as quick chat, command display, self-prompting, pending profile, and mode overrides.

`src/agent/task_state.js` stores `activeGoal`, `sourcePlayer`, timestamps, status, position/progress fields, and restart metadata. Valid reloadable statuses are `active` and `paused`; startup logs `Loaded active task: ...` when present. `Agent.setDurableGoal` persists player-assigned goals immediately.

Example shape:

```json
{"activeGoal":"Obtain full diamond armor","status":"active","sourcePlayer":"Player","createdAt":0,"updatedAt":0,"restartCount":0}
```

To reset memory while retaining the goal, remove only the memory file:

```bash
rm bots/Surfski/memory.json
```

Keep `bots/Surfski/task_state.json` unless intentionally clearing the active goal. The runtime also has pause, resume, complete, and cleared task-state operations; do not edit state files while the process is writing them.

Runtime settings are separate from both memory and task state, and layer over profile defaults. Admin authorization is in gitignored `config/local_admins.json`; create or edit it locally with `{"authorized_players":["YourMinecraftName"]}` and do not add that file to Git.
