# Movement and cleanup

`runtime/motion_cleanup.js` is the common interruption cleanup. It attempts to stop collect-block work, PVP, pathfinder goal/pathfinder, digging, item use, windows, and control states. It records observed residual state and reports `quiescent` only when no relevant motion/UI activity remains.

`runtime/expected_cancellation.js` recognizes Mineflayer-pathfinder `GoalChanged` during ordinary cleanup as expected cancellation rather than a fatal generated-code exception.

`runtime/movement_watchdog.js` wraps moving operations. It samples progress, detects a lack of movement in a bounded window, clears controls, stops pathfinding, attempts a small safe recovery/repath, then returns a clear failure after its retry budget. It is intended for corners and cramped caves, not for crafting/inventory UI.

All manual movement should clear controls in `finally`. Bounded retries are important: a stuck bot must fail clearly rather than hold movement/jump long enough to create server-side invalid-motion spam.
