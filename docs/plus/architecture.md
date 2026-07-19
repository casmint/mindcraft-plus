# Architecture

Mindcraft Plus keeps configuration, policy, execution, and evolving state separate.

```text
settings.js + profile JSON
        │
        ├─ agents/*.md       durable persona/instructions
        ├─ instincts/*.yaml  merged policy thresholds
        ▼
 Agent / Prompter ── direct command parser ── ActionManager ── skills ── Mineflayer
        │                       │                 │
        │                       └─ reactive modes ─┘
        ├─ memory.json (summary/history)
        ├─ task_state.json (durable goal)
        └─ optional ActionGraphRunner (explicit graphs only)
```

- `settings.js` supplies process-wide defaults, including `runtime_mode`, viewer settings, scheduler switch, and opt-in chat defaults.
- `profiles/*.json` select model, modes, instruction layers, instinct layers, and profile overrides. `profiles/surfski-autonomous.json` is the current autonomous Surfski example.
- `agents/*.md` define persona, broad behavior, and communication style. Bot identity belongs here, not in an external OpenClaw workspace `AGENTS.md`.
- `instincts/*.yaml` hold concrete policy knobs. They are configuration, not memory.
- Gathering and verification instincts govern bounded whole-tree collection and batch-level inventory checks; break/pickup evidence remains separate.
- The direct runtime is the current execution path: command parsing, `ActionManager`, `modes.js`, and `library/skills.js`.
- `admin_commands.js` is a separate control plane: player chat → `!surfski` prefix parser → local authorization → direct runtime-setting command. It bypasses the LLM and normal conversation history.
- Modes provide short reactive behavior; skills perform Mineflayer operations.
- `memory.json` is evolving conversational/world context. `task_state.json` is the durable active-goal record.
- `src/agent/runtime/action_graph.js` is optional. Its runner selects `direct` unless `actiongraph` is explicitly configured.

The intended interrupt sequence is: cancel the current action, run `runtime/motion_cleanup.js`, verify quiescence, then admit the next action. This is deliberately stricter than replacing a pathfinder goal in place.
