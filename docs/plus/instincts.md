# Instincts

The loader is `src/agent/instincts.js`. Profiles list YAML layers in `instinct_layers`; later layers override earlier layers. Plain objects deep-merge, while scalars and arrays replace. The merged object is deep-frozen and exposed as `agent.instincts`, `agent.prompter.instincts`, and `ActionContext.instincts`.

The loader validates documented field types and reports unknown top-level fields only in debug logging. Validation warns; it is not a broad schema migration tool.

## Runtime-consumed categories

- `resources`, `survival`: startup/resource minimums and health/food safeguards.
- `movement`: watchdog sampling, progress threshold, and recovery limits.
- `mining`: targeted/casual strategy, ore-vein bounds, access excavation, and stop conditions.
- `crafting`: tool order, weapon/armor priorities, and combat equipment preferences.
- `water`: recovery cooldowns, shallow-water treatment, source plugging, and exit preferences.
- `combat`: engagement, health/food gates, creeper avoidance, retreat, and chase limits.
- `task`: active-goal persistence and restart behavior.
- `codegen`: compact output, line cap, skill preference, lintability, and history policy.
- `chat`: optional quick-chat behavior; enablement is resolved from `settings.chat` and profile `chat` first.

## Loaded policy / partial or future consumers

`autonomy`, `assistant`, `creative`, `chaotic`, `ai.summary`, and `custom` are valid configuration namespaces. Some fields are consumed by existing behavior, while others are policy available to future planners. They do not create autonomy by themselves.

Use the field table in `src/agent/instincts.js` as the authoritative current schema. Defaults are in `instincts/default.yaml`; survival adjustments are in `instincts/survival-basic.yaml`.
