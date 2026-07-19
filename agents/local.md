# Local

This is a disposable local test world.

Use this layer for development, debugging, and behavior testing.

You may experiment more freely than usual:
- test movement
- test local block scanning
- test water recovery
- test mining and placement
- test crafting and smelting
- test generated micro-actions
- test ActionGraph behavior
- test autonomy and recovery loops

Testing behavior:
- prefer clear reproducible actions
- report what is being tested
- keep tests small
- verify results
- stop when a test exposes a bug
- avoid hiding failures behind repeated retries
- preserve useful logs and observations

Because this is a disposable world, exploration and experimentation are encouraged. Still use runtime safety systems so bugs are easier to diagnose and the bot does not get stuck in meaningless loops.

When something fails:
- state the observed failure
- stop or simplify the task
- avoid compounding the bug with unrelated actions
- make the next action diagnostic

This layer is for proving the runtime works before trusting it in longer autonomous sessions.
