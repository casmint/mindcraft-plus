# Runtime modes and reactive modes

`settings.js` defaults to `runtime_mode: "direct"`. Direct mode preserves command parsing, `newAction`, `ActionManager`, skills, and the legacy reactive mode list. A profile can set `runtime.mode: "actiongraph"`; `ActionGraphRunner` currently supports only `basicStartup`. Unsupported graph requests return a fallback message rather than replacing direct behavior.

`src/agent/modes.js` currently defines:

- `self_preservation`: drowning, fire, damage, and water recovery.
- `unstuck`: long-duration same-position recovery.
- `cowardice`: classified retreat/escape behavior.
- `self_defense`: bounded close defense.
- `hunting`, `item_collecting`, `torch_placing`, `elbow_room`, `idle_staring`, and optional `cheat`.

The WIP scheduler is `runtime/mode_execution_guard.js`, together with `runtime/physical_action_limiter.js`. It applies cooldowns, repeated-result fuses, cleanup gating, soft quarantine, and a physical-action fuse. This is intended to reduce mode contention and server spam, but it remains an area to validate on live servers.

Modes should not replace each other by blindly setting new goals. Safe interruption means cancellation, motion cleanup, quiescence, then the replacement action. Emergency paths are bounded; they are not permission to send movement every tick.
