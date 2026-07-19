# Roadmap

## Stabilizing now

- Live-server validation of water recovery, cleanup, and physical-action rate limiting.
- Mode ownership/cancellation behavior under combat, water, and stuck movement.
- Full-vein mining, access excavation, and safe dig timing across block/tool combinations.
- Optional quick chat behavior and durable task updates.
- Admin/settings command system is implemented; validate its local authorization and persistence workflow on deployed servers.

## Planned

- Broader ActionGraph graphs while keeping direct runtime as a switchable compatibility mode.
- More admin/operator observability controls beyond the current safe settings commands.
- Building intelligence built on LocalBlockMap: flat areas, walls, corners, and clear volumes.
- More deterministic goal progression and task checkpoints.

No roadmap item authorizes removal of direct commands, ActionManager, or legacy reactive modes without a separate compatibility decision.
