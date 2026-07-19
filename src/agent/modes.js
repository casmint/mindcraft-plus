import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';
import { exitWater, findNearestWaterExit, findWaterEdgeRetreat, verifyOnSolidGround } from './runtime/exit_water.js';
import { classifyHostileThreat } from './runtime/threat_classifier.js';
import { claimCombatState, clearCombatState, getCombatState } from './runtime/combat_state.js';
import { hasStableLiveState, shouldDeferSelfPreservation, shouldUseHorizontalWaterExit, waterHazardSignature } from './runtime/self_preservation_state.js';

async function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

function isSolidCell(cell) {
    return Boolean(cell?.observed && (cell.isSolid || cell.boundingBox === 'block'
        || (cell.name && !['air', 'cave_air', 'void_air', 'water', 'lava'].includes(cell.name))));
}

function describeWaterHazard(bot, snapshot, waterState) {
    const position = {
        x: Math.floor(bot.entity.position.x),
        y: Math.floor(bot.entity.position.y),
        z: Math.floor(bot.entity.position.z),
    };
    let ceilingOffset = null;
    for (let offset = 0; offset <= 3; offset++) {
        const cell = snapshot?.getAbsolute({ ...position, y: position.y + 1 + offset });
        if (isSolidCell(cell)) {
            ceilingOffset = offset;
            break;
        }
    }
    const grounded = isSolidCell(waterState?.below);
    return {
        ceilingOffset,
        crampedHeadroom: ceilingOffset != null && ceilingOffset <= 1,
        signature: waterHazardSignature({
            position,
            feet: waterState?.feet,
            below: waterState?.below,
            head: waterState?.head,
            ceilingOffset,
            drowning: waterState?.drowningRisk,
            grounded,
        }),
    };
}

function clearPreservationMotion(bot) {
    bot.pathfinder?.stop?.();
    for (const control of ['jump', 'forward', 'sprint', 'sneak']) {
        bot.setControlState?.(control, false);
    }
    bot.clearControlStates?.();
}

async function getHostileThreat(agent, range) {
    const state = getCombatState(agent);
    const tracked = state && Object.values(agent.bot.entities || {})
        .find(entity => (entity.id ?? entity.uuid ?? entity.name) === state.targetId);
    if (state && !tracked) clearCombatState(agent, 'target_gone');
    const enemy = tracked || world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), range);
    if (!enemy) return null;
    const localMap = agent.localBlockMap?.getSnapshot(agent.bot, {
        radius: Math.min(range, 16),
        heightUp: 3,
        heightDown: 3,
    });
    const feetBlock = agent.bot.blockAt?.(agent.bot.entity.position);
    const headBlock = agent.bot.blockAt?.(agent.bot.entity.position.offset(0, 1, 0));
    const inLavaOrFire = [feetBlock?.name, headBlock?.name].some(name => name === 'lava' || name === 'fire');
    const inWater = typeof agent.bot.entity?.isInWater === 'function'
        ? agent.bot.entity.isInWater()
        : Boolean(agent.bot.entity?.isInWater);
    const drowning = inWater && Number(agent.bot.oxygenLevel) <= 4;
    const nearbyHostiles = world.getNearbyEntities(agent.bot, 12)
        .filter(entity => mc.isHostile(entity)).length;
    const threat = await classifyHostileThreat(agent.bot, enemy, localMap, {
        instincts: agent.instincts,
        nearbyHostiles,
        environmentDanger: inLavaOrFire || drowning,
    });
    let combatState = getCombatState(agent);
    if (threat.stance !== 'IGNORE' && threat.stance !== 'WATCH') {
        combatState = claimCombatState(agent, enemy, threat);
        threat.stance = combatState.stance;
        threat.level = combatState.stance;
    }
    if (settings.log_all_prompts) {
        console.debug(`[threat] ${enemy.name} stance=${threat.stance} owner=${combatState?.ownerMode || 'none'} (${threat.reasonCode}) distance=${threat.distance.toFixed(1)} los=${threat.lineOfSight} reachable=${threat.reachable}`);
    }
    return { enemy, threat, combatState };
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
const modes_list = [
    {
        name: 'self_preservation',
        description: 'Respond to drowning, burning, and damage at low health. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        fall_blocks: ['sand', 'gravel', 'concrete_powder'], // includes matching substrings like 'sandstone' and 'red_sand'
        update: async function (agent) {
            const bot = agent.bot;
            let waterSnapshot = agent.localBlockMap?.getSnapshot(bot, {
                radius: 8,
                heightUp: 4,
                heightDown: 4,
            });
            let waterState = waterSnapshot && agent.waterDetector?.observe(bot, waterSnapshot);
            // A cached observation can be useful for ordinary mode polling, but
            // never use it alone to interrupt another action for water recovery.
            if (waterState?.inWater || waterState?.requiresRecovery || waterState?.shallowStanding) {
                waterSnapshot = agent.localBlockMap?.getSnapshot(bot, {
                    radius: 8,
                    heightUp: 4,
                    heightDown: 4,
                    fresh: true,
                });
                waterState = waterSnapshot && agent.waterDetector?.observe(bot, waterSnapshot);
            }
            const waterInstincts = agent.instincts?.water || {};
            const survival = agent.instincts?.survival || {};
            const waterHazard = describeWaterHazard(bot, waterSnapshot, waterState);
            const lowHealth = typeof bot.health === 'number' && bot.health < (survival.stopMiningBelowHealth ?? 8);
            const activeDamage = Date.now() - (bot.lastDamageTime || 0) < 1_000;
            const lowAir = waterState?.headUnderwater && Number(waterState.oxygen) <= 8;
            const fallingAbove = ['sand', 'gravel', 'concrete_powder']
                .some(name => waterState?.head?.name?.includes(name));
            const feetName = waterState?.feet?.name || 'air';
            const headName = waterState?.head?.name || 'air';
            const lavaOrFire = [feetName, headName].some(name => name === 'lava' || name === 'fire');
            const trueEmergency = waterState?.drowningRisk || waterState?.headUnderwater
                || waterState?.lavaAdjacent || lavaOrFire || fallingAbove
                || activeDamage || (typeof bot.health === 'number' && bot.health <= 4);
            const modeGuard = settings.enable_mode_scheduler === false
                ? { allowed: true }
                : agent.runtimeGuard?.canRunMode('self_preservation', { emergency: trueEmergency });
            if (modeGuard && !modeGuard.allowed) {
                if (settings.log_all_prompts) console.debug(`self_preservation skipped: ${modeGuard.reasonCode}`);
                return;
            }
            const currentAction = agent.actions.currentActionLabel;
            const deferReason = shouldDeferSelfPreservation({
                currentAction,
                actionState: agent.actions.actionState,
                emergency: trueEmergency,
            });
            if (deferReason) {
                if (settings.log_all_prompts) console.debug(`self_preservation skipped: ${deferReason}`);
                return;
            }
            const stableLiveState = hasStableLiveState({
                below: waterState?.below,
                feet: waterState?.feet,
                head: waterState?.head,
                lowHealth,
                activeDamage,
                falling: fallingAbove || lavaOrFire,
            });
            // This is intentionally a live, immediate-block gate. Nearby water
            // and previous recovery results must never interrupt normal work.
            if (stableLiveState) {
                if (settings.log_all_prompts) {
                    console.debug('self_preservation skipped: stable_live_state');
                    console.debug('water recovery skipped: stable_live_state');
                }
                return;
            }
            if (!waterState?.inWater && !lavaOrFire && !fallingAbove && !lowHealth && !activeDamage) {
                if (settings.log_all_prompts) console.debug('self_preservation skipped: nearby_water_not_hazard');
            }
            if (shouldUseHorizontalWaterExit({
                shallowStanding: waterState?.shallowStanding,
                lavaAdjacent: waterState?.lavaAdjacent,
                crampedHeadroom: waterHazard.crampedHeadroom,
            })) {
                this.lastGuardSignature = waterHazard.signature;
                const decision = agent.selfPreservation?.begin(waterHazard.signature, {
                    emergency: fallingAbove || lowHealth || activeDamage,
                }) || { start: true };
                if (!decision.start) {
                    if (decision.loopDetected) {
                        say(agent, 'self_preservation_loop_detected: shallow water recovery paused.');
                        clearPreservationMotion(bot);
                    } else if (settings.log_all_prompts) {
                        console.debug(`self_preservation skipped: ${decision.reasonCode}`);
                    }
                    return;
                }
                execute(this, agent, async (context) => {
                    let result;
                    try {
                        const liveSnapshot = agent.localBlockMap.getSnapshot(bot, {
                            radius: 4,
                            heightUp: 2,
                            heightDown: 2,
                            fresh: true,
                        });
                        const liveWater = agent.waterDetector?.observe(bot, liveSnapshot);
                        if (hasStableLiveState({
                            below: liveWater?.below,
                            feet: liveWater?.feet,
                            head: liveWater?.head,
                        })) {
                            if (settings.log_all_prompts) console.debug('water recovery skipped: stable_live_state');
                            result = { status: 'completed', reasonCode: 'stable_live_state' };
                            return;
                        }
                        if (!waterState?.drowningRisk) {
                            const plug = await skills.plugWaterSourceIfSafe(bot, {
                                localMap: agent.localBlockMap,
                                instincts: agent.instincts,
                            });
                            if (plug.status === 'plugged') {
                                say(agent, 'Plugged a small water source before exiting.');
                            }
                        }
                        const snapshot = agent.localBlockMap.getSnapshot(bot, {
                            radius: 4,
                            heightUp: 2,
                            heightDown: 2,
                            fresh: true,
                        });
                        const exit = findNearestWaterExit(bot, snapshot);
                        if (!exit) {
                            result = {
                                status: 'blocked',
                                reasonCode: waterHazard.crampedHeadroom
                                    ? 'trapped_water_cramped_headroom'
                                    : 'shallow_water_exit_not_found',
                            };
                        } else {
                            await skills.goToPosition(bot, exit.x, exit.y, exit.z, 0.5, { signal: context.signal });
                            const ground = verifyOnSolidGround(bot, agent.localBlockMap.getSnapshot(bot, {
                                radius: 4,
                                heightUp: 2,
                                heightDown: 2,
                                fresh: true,
                            }));
                            result = {
                                status: ground.grounded ? 'completed' : 'blocked',
                                reasonCode: ground.grounded ? 'shallow_water_exit_verified' : 'shallow_water_exit_unverified',
                            };
                        }
                    } catch (error) {
                        console.warn('Shallow water exit failed:', error);
                        result = { status: 'blocked', reasonCode: 'shallow_water_exit_error' };
                    } finally {
                        clearPreservationMotion(bot);
                        agent.selfPreservation?.finish(result || {
                            status: context.signal?.aborted ? 'cancelled' : 'blocked',
                            reasonCode: context.signal?.aborted ? 'cancelled' : 'shallow_water_interrupted',
                        }, { resolvedCooldownMs: waterInstincts.resolvedWaterCooldownMs ?? 15_000 });
                    }
                    say(agent, `Water edge exit ${result.status}: ${result.reasonCode}.`);
                });
                return;
            }
            const waterEmergency = waterState?.drowningRisk || waterState?.lavaAdjacent || waterState?.sinking
                || waterState?.stuck || lowAir || lowHealth || activeDamage || fallingAbove;
            const mustExitWater = waterState?.requiresRecovery && (
                waterInstincts.exitWaterImmediately !== false
                || waterEmergency
                || (waterState.headUnderwater && waterInstincts.avoidUnderwaterTasksWithoutAirPlan !== false)
            );
            if (mustExitWater) {
                this.lastGuardSignature = waterHazard.signature;
                const preservationDecision = agent.selfPreservation?.begin(waterHazard.signature, {
                    emergency: waterEmergency,
                }) || { start: true };
                if (!preservationDecision.start) {
                    if (preservationDecision.loopDetected) {
                        say(agent, 'self_preservation_loop_detected: water recovery paused.');
                        clearPreservationMotion(bot);
                        agent.self_prompter.stop(false);
                    } else if (settings.log_all_prompts) {
                        console.debug(`self_preservation skipped: ${preservationDecision.reasonCode}`);
                    }
                    return;
                }
                if (settings.log_all_prompts && waterEmergency) {
                    console.debug(`self_preservation active: ${waterState.headUnderwater ? 'head_submerged' : 'unsafe_footing'}`);
                }
                const resourceRisk = lowHealth
                    || (typeof bot.food === 'number' && bot.food < (survival.stopMiningBelowFood ?? 4));
                const decision = agent.waterRecovery?.begin({ ...waterState, resourceRisk }, bot.entity.position)
                    || { start: true };
                if (!decision.start) {
                    agent.selfPreservation?.finish({ reasonCode: decision.reasonCode });
                    if (decision.loopDetected) {
                        say(agent, 'Water recovery loop detected; pausing repeated recovery attempts.');
                        bot.clearControlStates?.();
                        agent.self_prompter.stop(false);
                    } else if (settings.log_all_prompts) {
                        console.debug(`[water] recovery suppressed: ${decision.reasonCode}`);
                    }
                    return;
                }
                say(agent, `Water recovery: ${waterState.state}.`);
                execute(this, agent, async (context) => {
                    const maxMs = Math.max(1_000, (waterInstincts.maxWaterRecoverySeconds ?? 15) * 1_000);
                    let result;
                    try {
                        const liveSnapshot = agent.localBlockMap.getSnapshot(bot, {
                            radius: 4,
                            heightUp: 2,
                            heightDown: 2,
                            fresh: true,
                        });
                        const liveWater = agent.waterDetector?.observe(bot, liveSnapshot);
                        if (hasStableLiveState({
                            below: liveWater?.below,
                            feet: liveWater?.feet,
                            head: liveWater?.head,
                        })) {
                            if (settings.log_all_prompts) console.debug('water recovery skipped: stable_live_state');
                            result = { status: 'completed', reasonCode: 'stable_live_state' };
                            return;
                        }
                        result = await exitWater(bot, {
                            detector: agent.waterDetector,
                            localMap: agent.localBlockMap,
                            signal: context.signal,
                            surfaceTimeoutMs: Math.min(4_000, Math.floor(maxMs * 0.4)),
                            exitTimeoutMs: Math.max(1_000, Math.floor(maxMs * 0.6)),
                        });
                        if (result.status === 'completed' && result.reasonCode === 'water_exit_verified') {
                            const snapshot = agent.localBlockMap.getSnapshot(bot, {
                                radius: 4,
                                heightUp: 2,
                                heightDown: 2,
                                fresh: true,
                            });
                            const retreat = findWaterEdgeRetreat(bot, snapshot);
                            if (retreat) await skills.goToPosition(bot, retreat.x, retreat.y, retreat.z, 0.5, { signal: context.signal });
                        }
                    } catch (error) {
                        console.warn('Water recovery failed:', error);
                        result = { status: 'blocked', reasonCode: 'water_recovery_error' };
                    } finally {
                        clearPreservationMotion(bot);
                        agent.waterRecovery?.finish(result || {
                            status: context.signal?.aborted ? 'cancelled' : 'blocked',
                            reasonCode: context.signal?.aborted ? 'cancelled' : 'water_recovery_interrupted',
                        }, bot.entity.position, {
                            avoidMs: waterInstincts.avoidWaterUnlessNeeded === false ? maxMs : maxMs * 2,
                        });
                        agent.selfPreservation?.finish(result || {
                            status: context.signal?.aborted ? 'cancelled' : 'blocked',
                            reasonCode: context.signal?.aborted ? 'cancelled' : 'water_recovery_interrupted',
                        }, { resolvedCooldownMs: waterInstincts.resolvedWaterCooldownMs ?? 15_000 });
                    }
                    say(agent, `Water recovery ${result.status}: ${result.reasonCode}.`);
                });
                return;
            }
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            if (this.fall_blocks.some(name => blockAbove.name.includes(name))) {
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 2);
                });
            }
            else if (block.name === 'lava' || block.name === 'fire' ||
                blockAbove.name === 'lava' || blockAbove.name === 'fire') {
                say(agent, 'I\'m on fire!');
                // if you have a water bucket, use it
                let waterBucket = bot.inventory.findInventoryItem('water_bucket');
                if (waterBucket) {
                    execute(this, agent, async () => {
                        let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                        if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                    });
                }
                else {
                    execute(this, agent, async () => {
                        let waterBucket = bot.inventory.findInventoryItem('water_bucket');
                        if (waterBucket) {
                            let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                            if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                            return;
                        }
                        let nearestWater = world.getNearestBlock(bot, 'water', 20);
                        if (nearestWater) {
                            const pos = nearestWater.position;
                            let success = await skills.goToPosition(bot, pos.x, pos.y, pos.z, 0.2);
                            if (success) say(agent, 'Found some water, ahhhh that\'s better!');
                            return;
                        }
                        await skills.moveAway(bot, 5);
                    });
                }
            }
            else if (Date.now() - bot.lastDamageTime < 3000 && (bot.health < 5 || bot.lastDamageTaken >= bot.health)) {
                say(agent, 'I\'m dying!');
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 20);
                });
            }
            else if (agent.isIdle()) {
                bot.clearControlStates(); // clear jump if not in danger or doing anything else
            }
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        prev_location: null,
        distance: 2,
        stuck_time: 0,
        last_time: Date.now(),
        max_stuck_time: 20,
        prev_dig_block: null,
        update: async function (agent) {
            if (agent.isIdle()) { 
                this.prev_location = null;
                this.stuck_time = 0;
                return; // don't get stuck when idle
            }
            const bot = agent.bot;
            const cur_dig_block = bot.targetDigBlock;
            if (cur_dig_block && !this.prev_dig_block) {
                this.prev_dig_block = cur_dig_block;
            }
            if (this.prev_location && this.prev_location.distanceTo(bot.entity.position) < this.distance && cur_dig_block == this.prev_dig_block) {
                this.stuck_time += (Date.now() - this.last_time) / 1000;
            }
            else {
                this.prev_location = bot.entity.position.clone();
                this.stuck_time = 0;
                this.prev_dig_block = null;
            }
            const max_stuck_time = cur_dig_block?.name === 'obsidian' ? this.max_stuck_time * 2 : this.max_stuck_time;
            if (this.stuck_time > max_stuck_time) {
                say(agent, 'I\'m stuck!');
                this.stuck_time = 0;
                execute(this, agent, async () => {
                    const crashTimeout = setTimeout(() => { agent.cleanKill("Got stuck and couldn't get unstuck") }, 10000);
                    await skills.moveAway(bot, 5);
                    clearTimeout(crashTimeout);
                    say(agent, 'I\'m free.');
                });
            }
            this.last_time = Date.now();
        },
        unpause: function () {
            this.prev_location = null;
            this.stuck_time = 0;
            this.prev_dig_block = null;
        }
    },
    {
        name: 'cowardice',
        description: 'Run away from enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const hostile = await getHostileThreat(agent, 16);
            if ((hostile?.threat.stance === 'RETREAT' || hostile?.threat.stance === 'ESCAPE')
                && (hostile.combatState?.ownerMode === 'cowardice' || hostile.threat.stance === 'ESCAPE')) {
                const { enemy, threat } = hostile;
                say(agent, `${threat.stance === 'ESCAPE' ? 'Escaping' : 'Taking cover from'} ${enemy.name.replace("_", " ")}.`);
                execute(this, agent, async () => {
                    if (threat.stance === 'ESCAPE') {
                        await skills.avoidEnemies(agent.bot, 16);
                    } else {
                        await skills.tacticalRetreat(agent.bot, enemy, 6);
                    }
                });
            }
        }
    },
    {
        name: 'self_defense',
        description: 'Use bounded close defense against nearby enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const hostile = await getHostileThreat(agent, 8);
            if (hostile?.threat.stance === 'ENGAGE' && hostile.combatState?.ownerMode === 'self_defense') {
                const { enemy } = hostile;
                say(agent, `Fighting ${enemy.name}!`);
                execute(this, agent, async () => {
                    await skills.defendSelf(agent.bot, 8, {
                        durationMs: 3000,
                        engagementRange: 3,
                        healthFloor: agent.instincts?.combat?.minimumHealthToFight ?? 8,
                        targetEntity: enemy,
                    });
                    const stillPresent = Object.values(agent.bot.entities || {})
                        .some(entity => (entity.id ?? entity.uuid ?? entity.name) === (enemy.id ?? enemy.uuid ?? enemy.name));
                    if (!stillPresent) clearCombatState(agent, 'target_gone');
                });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (agent) {
            const huntable = world.getNearestEntityWhere(agent.bot, entity => mc.isHuntable(entity), 8);
            if (huntable && await world.isClearPath(agent.bot, huntable)) {
                execute(this, agent, async () => {
                    say(agent, `Hunting ${huntable.name}!`);
                    await skills.attackEntity(agent.bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,

        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (agent) {
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    this.prev_item = item;
                    execute(this, agent, async () => {
                        await skills.pickupNearbyItems(agent.bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (agent) {
            if (world.shouldPlaceTorch(agent.bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                execute(this, agent, async () => {
                    const pos = agent.bot.entity.position;
                    await skills.placeBlock(agent.bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Move away from nearby players when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        distance: 0.5,
        update: async function (agent) {
            const player = world.getNearestEntityWhere(agent.bot, entity => entity.type === 'player', this.distance);
            if (player) {
                execute(this, agent, async () => {
                    // wait a random amount of time to avoid identical movements with other bots
                    const wait_time = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, wait_time));
                    if (player.position.distanceTo(agent.bot.entity.position) < this.distance) {
                        await skills.moveAwayFromEntity(agent.bot, player, this.distance);
                    }
                });
            }
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        update: function (agent) {
            const entity = agent.bot.nearestEntity();
            let entity_in_view = entity && entity.position.distanceTo(agent.bot.entity.position) < 10 && entity.name !== 'enderman';
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1000 + 4000;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && entity.metadata[16];
                let height = isbaby ? entity.height/2 : entity.height;
                agent.bot.lookAt(entity.position.offset(0, height, 0));
            }
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                // look in random direction
                this.staring = Math.random() < 0.3;
                if (!this.staring) {
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = (Math.random() * Math.PI/2) - Math.PI/4;
                    agent.bot.look(yaw, pitch, false);
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (agent) { /* do nothing */ }
    }
];

async function execute(mode, agent, func, timeout=-1) {
    const guardStart = agent.runtimeGuard?.beginMode(mode.name) || { allowed: true };
    if (!guardStart.allowed) {
        console.debug(`mode skipped: ${guardStart.reasonCode}`);
        return;
    }
    if (agent.self_prompter.isActive())
        agent.self_prompter.stopLoop();
    let interrupted_action = agent.actions.currentActionLabel;
    mode.active = true;
    let code_return = await agent.actions.runAction(`mode:${mode.name}`, async (context) => {
        try {
            await func(context);
        } finally {
            if (mode.name === 'self_preservation') clearPreservationMotion(agent.bot);
        }
    }, { timeout });
    mode.active = false;
    console.log(`Mode ${mode.name} finished executing, code_return: ${code_return.message}`);
    const guardResult = agent.runtimeGuard?.finishMode(mode.name, code_return.message, mode.lastGuardSignature);
    mode.lastGuardSignature = '';
    if (guardResult?.suppressed) {
        console.warn(`mode skipped: repeated_result ${mode.name} ${guardResult.signature}`);
        agent.self_prompter.pauseForRuntime?.(5_000);
    }

    let should_reprompt = 
        interrupted_action && // it interrupted a previous action
        !agent.actions.resume_func && // there is no resume function
        !agent.self_prompter.isActive() && // self prompting is not on
        !code_return.interrupted; // this mode action was not interrupted by something else

    if (should_reprompt) {
        // auto prompt to respond to the interruption
        let role = convoManager.inConversation() ? agent.last_sender : 'system';
        let logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted_action}' was interrupted by ${mode.name}.
        Your behavior log: ${logs}\nRespond accordingly.`);
    }
}

let _agent = null;
const modes_map = {};
for (let mode of modes_list) {
    modes_map[mode.name] = mode;
}

class ModeController {
    /*
    SECURITY WARNING:
    ModesController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor() {
        this.behavior_log = '';
    }

    exists(mode_name) {
        return modes_map[mode_name] != null;
    }

    setOn(mode_name, on) {
        modes_map[mode_name].on = on;
    }

    isOn(mode_name) {
        return modes_map[mode_name].on;
    }

    pause(mode_name) {
        modes_map[mode_name].paused = true;
    }

    unpause(mode_name) {
        const mode = modes_map[mode_name];
        //if  unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of modes_list) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    async update() {
        if (_agent.runtimeGuard?.isQuarantined?.() || _agent.actions.actionState === 'quarantined') {
            const hardQuarantine = _agent.actions.actionState === 'quarantined'
                || _agent.runtimeGuard?.quarantineUntil === 0;
            if (hardQuarantine && !_agent.runtimeGuard?.quarantineAnnounced) {
                console.error('Runtime quarantined after action did not quiesce; awaiting restart or manual reset.');
                _agent.runtimeGuard.quarantineAnnounced = true;
            }
            _agent.bot.pathfinder?.stop?.();
            _agent.bot.clearControlStates?.();
            if (hardQuarantine) _agent.self_prompter.pauseForRuntime?.(15_000);
            return;
        }
        if (_agent.isIdle()) {
            this.unPauseAll();
        }
        for (let mode of modes_list) {
            let interruptible = mode.interrupts.some(i => i === 'all') || mode.interrupts.some(i => i === _agent.actions.currentActionLabel);
            const guard = settings.enable_mode_scheduler === false || mode.name === 'self_preservation'
                ? { allowed: true }
                : _agent.runtimeGuard?.canRunMode(mode.name) || { allowed: true };
            if (!guard.allowed) {
                if (settings.log_all_prompts) console.debug(`mode skipped: ${guard.reasonCode}`);
                continue;
            }
            if (mode.on && !mode.paused && !mode.active && (_agent.isIdle() || interruptible)) {
                await mode.update(_agent);
            }
            if (mode.active) break;
        }
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = '';
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of modes_list) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    loadJson(json) {
        for (let mode of modes_list) {
            if (json[mode.name] != undefined) {
                mode.on = json[mode.name];
            }
        }
    }
}

export function initModes(agent) {
    _agent = agent;
    // the mode controller is added to the bot object so it is accessible from anywhere the bot is used
    agent.bot.modes = new ModeController();
    if (agent.task) {
        agent.bot.restrict_to_inventory = agent.task.restrict_to_inventory;
    }
    let modes_json = agent.prompter.getInitModes();
    if (modes_json) {
        agent.bot.modes.loadJson(modes_json);
    }
}
