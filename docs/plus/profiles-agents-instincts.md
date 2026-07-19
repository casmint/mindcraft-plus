# Profiles, agents, and instincts

Profiles are stack selectors. A typical Surfski profile uses ordered instruction and instinct layers:

```json
{
  "name": "Surfski",
  "instruction_layers": ["./agents/default.md", "./agents/autonomous.md", "./agents/survival.md", "./agents/surfski.md"],
  "instinct_layers": ["./instincts/default.yaml", "./instincts/survival-basic.yaml", "./instincts/autonomous.yaml"]
}
```

Configured layer paths are repository-relative and loaded in list order. Missing or escaping paths fail clearly. The agent-layer convention in this repository is one-word files such as `default`, `autonomous`, `survival`, `surfski`, `rules`, `creative`, `local`, `assistant`, and `chaotic`.

`agents/*.md` are durable instructions: identity, social style, and broad game behavior. `instincts/*.yaml` are machine-readable thresholds and preferences. Neither should be confused with memory.

Known Surfski variants include `surfski-autonomous.json`, `surfski-assistant.json`, `surfski-chaotic.json`, `surfski-creative.json`, `surfski-local.json`, and `surfski-rules.json`. Profiles may override `runtime.mode` and `chat`; profile chat settings override `settings.chat`.

## Adding a profile safely

1. Copy `profiles/surfski.example.json` or a close existing profile.
2. Use only existing agent and instinct layer paths at first.
3. Keep `runtime.mode` omitted or `direct` unless testing an explicit graph.
4. Enable `chat.enableQuickChat` only for profiles that should opt in.
5. Parse JSON and run the runtime test suite before server use.
