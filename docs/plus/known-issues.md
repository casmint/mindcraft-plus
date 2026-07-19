# Known issues and stabilization areas

This is a living list, not a claim that every issue reproduces on every server.

- **Water/self-preservation is WIP.** The code has live-state gates, cooldowns, source-plug safety checks, and loop detection, but shallow cave water and cramped ceilings need continued live-server validation.
- **Mode contention is WIP.** Combat ownership, cancellation handling, and the scheduler reduce thrash. Interactions among `self_preservation`, `unstuck`, and combat modes remain high-risk regression areas.
- **Threat reachability needs live validation.** Surface-blocked creepers now classify as watch/ignore rather than immediate escape, but unusual cave geometry and pathfinder reachability should be tested on the target server.
- **Server spam prevention needs field validation.** The physical-action limiter and soft quarantine exist, but no unit suite can conclusively reproduce or rule out a server `disconnect.spam` kick.
- **Mining is safety bounded.** A visible ore may correctly remain unmined when access excavation cannot prove a safe pocket, tool, footing, or hazard state.
- **Drop collection is stabilizing.** Collection now attempts a bounded move to a just-broken block's drop position, but item timing and unsafe terrain need live-server validation.
- **Generated code remains untrusted operational input.** Compact style and skill selection reduce risk but cannot eliminate invalid syntax, bad assumptions, or raw Mineflayer calls.
- **Dig timing is stabilizing.** `safeDigBlock` uses conservative block-sensitive timeouts and bounded retries, but actual break timing still depends on server tick conditions, tools, and Mineflayer behavior.
- **Quick chat is opt-in.** It is disabled globally by default. With it enabled, only casual/questions take the fast path; instructions still rely on the established planner/scheduler.
- **Profile switching is queued.** The admin command persists a pending profile rather than hot-swapping runtime objects during an active process; it reports that the switch applies when idle/restart.

When closing an issue, add an automated test where feasible and update this file with the observable condition and verification method.
