# Mindcraft Plus

Mindcraft Plus is the repository's compatibility-preserving safety and autonomy layer on top of the existing MINDcraft-style agent runtime. Its current direction is safer, more structured Minecraft behavior without replacing direct commands, skills, or reactive modes.

`runtime_mode: "direct"` remains the default. ActionGraph v0 exists for one explicit graph (`basicStartup`), but is not mandatory and does not replace direct commands.

| Area | Current status |
| --- | --- |
| Profile instruction layers | Implemented |
| Instinct YAML layers | Implemented |
| Direct runtime compatibility | Preserved |
| LocalBlockMap | Implemented |
| Water recovery / self-preservation | WIP / stabilizing |
| Full safe ore veins | Implemented / stabilizing |
| Durable task state | Implemented |
| Generated-code hardening | Implemented / stabilizing |
| Runtime anti-loop scheduler | WIP |
| Optional quick chat | Implemented, opt-in |
| Admin/settings command system | Implemented (profile switching is queued) |
| ActionGraph expansion | Planned |

Start with [architecture](architecture.md), then read [profiles, agents, and instincts](profiles-agents-instincts.md). Operational details live in [testing and debugging](testing-and-debugging.md), with current caveats in [known issues](known-issues.md).

## Document map

- [Architecture](architecture.md)
- [Profiles, agents, and instincts](profiles-agents-instincts.md)
- [Instinct reference](instincts.md)
- [Runtime modes](runtime-modes.md)
- [Memory and durable tasks](memory-and-task-state.md)
- [Mining](mining.md)
- [Water and self-preservation](water-and-self-preservation.md)
- [Movement and cleanup](movement-and-cleanup.md)
- [Generated code](generated-code.md)
- [Testing and debugging](testing-and-debugging.md)
- [Known issues](known-issues.md)
- [Roadmap](roadmap.md)
- [Notes for future Codex work](codex-notes.md)
