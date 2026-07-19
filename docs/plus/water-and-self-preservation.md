# Water and self-preservation

Water handling is a first-class WIP safety subsystem built from `local_block_map.js`, `water_detector.js`, `exit_water.js`, `swim_controller.js`, `water_recovery_state.js`, `self_preservation_state.js`, and `water_source_plug.js`.

The runtime distinguishes shallow standing water from drowning. Water at legs with air at head and a solid block below is not automatically an emergency. Stable footing near water should not interrupt mining. Live-state gates produce messages such as:

```text
self_preservation skipped: stable_live_state
self_preservation skipped: nearby_water_not_hazard
water recovery skipped: stable_live_state
Water source plug: no_single_source (...)
```

Recovery scans nearby geometry for a safe standable exit. Cramped headroom prefers horizontal exit; the controller clears jump/forward/sprint and pathfinder state in cleanup. `resolvedWaterCooldownMs`, `waterRecoveryCooldownMs`, and repeated-signature state suppress immediate retries after success or repeated failure.

`plugSingleSourceFlow` is a conservative tactical option for a small, confidently identified source using disposable blocks. It refuses large clusters, unsafe lava adjacency, or uncertain candidates. A `no_single_source` result is not proof that the bot should keep relocating.

This subsystem is stabilizing. Validate shallow water, cramped ceilings, source plugging, and post-recovery task continuation against the target server before relying on it unattended.
