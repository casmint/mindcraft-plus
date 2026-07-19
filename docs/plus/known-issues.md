# Known issues and stabilization areas

This is a living list, not a claim that every issue reproduces on every server.

- **Water/self-preservation is WIP.** The code has live-state gates, cooldowns, source-plug safety checks, and loop detection, but shallow cave water and cramped ceilings need continued live-server validation.
- **Mode contention is WIP.** Combat ownership, cancellation handling, and the scheduler reduce thrash. Interactions among `self_preservation`, `unstuck`, and combat modes remain high-risk regression areas.
- **Server spam prevention needs field validation.** The physical-action limiter and soft quarantine exist, but no unit suite can conclusively reproduce or rule out a server `disconnect.spam` kick.
- **Mining is safety bounded.** A visible ore may correctly remain unmined when access excavation cannot prove a safe pocket, tool, footing, or hazard state.
- **Generated code remains untrusted operational input.** Compact style and skill selection reduce risk but cannot eliminate invalid syntax, bad assumptions, or raw Mineflayer calls.
- **Quick chat is opt-in.** It is disabled globally by default. With it enabled, only casual/questions take the fast path; instructions still rely on the established planner/scheduler.

When closing an issue, add an automated test where feasible and update this file with the observable condition and verification method.
