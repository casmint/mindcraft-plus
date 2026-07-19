# Mining

Mining additions are concentrated in `runtime/ore_vein.js`, `mining_access.js`, `mining_strategy.js`, and `safe_dig.js`, with integration in `library/skills.js`.

## Current behavior

Ore collection treats a requested ore count as a target/minimum rather than a normal eight-block cap. For ore names, `collectBlocks` can discover and expand a connected safe vein, including newly exposed ore. Bounds such as `maxVeinRadius`, `maxOreActionSeconds`, and `oreEmergencyHardCap` are bug/safety fuses, not desired player-like stopping points. `exactCount` is available where the caller truly needs an exact amount.

Safety is checked between blocks: health, food, tool, footing/head state, inventory limits, credible hostile emergencies, lava/water, and drop risk. Inventory gain is verified at the end of the action rather than after every ore block.

After an ore break, `collectDropAfterBreak` moves into bounded pickup range when needed, waits briefly for item entities, and confirms inventory gain before reporting a pickup. Results distinguish a block break from an inventory-confirmed drop; a broken block is not assumed to be collected.

Log requests use bounded connected-cluster collection when `gathering.preferWholeTrees` is enabled. A normal requested log count is a minimum: the collector attempts one reachable trunk/tree cluster within `maxTreeLogs`, `maxTreeActionSeconds`, and `maxTreeRadius`, then verifies the batch. It does not break leaves for this behavior.

`ensureMiningReachability` can make a bounded access pocket for visible ore by breaking approved natural blocks. It must not mine support blocks, utilities, unknown tunnels, or obvious water/lava/drop barriers. Failure codes include `access_excavation_failed`, `unsafe_to_excavate`, and `no_safe_standable_position`.

`safeDigBlock` equips a valid tool, uses a block-sensitive timeout, waits for completion/block change, and retries only within a small budget. Diamond ore requires iron or better; deepslate receives longer time. Wrong-tool and interruption are explicit results.

## Strategy data

`mining.resourceTargets` currently contains targeted guidance such as diamond around Y -58, iron around Y 16, copper around Y 48, coal at higher elevations, redstone around Y -58, and ancient debris around Y 15. This is runtime configuration and WIP strategy support, not a guarantee that every task autonomously starts targeted mining.

Common stop reasons: wrong tool, no safe standable position, visible but unreachable vein, unsafe footing, lava/water/drop exposure, hostile emergency, or movement stuck in a tight pocket.
