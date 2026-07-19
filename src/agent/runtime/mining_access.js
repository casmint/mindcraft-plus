import Vec3 from 'vec3';

const NATURAL_ACCESS_BLOCKS = new Set([
    'stone', 'deepslate', 'cobblestone', 'cobbled_deepslate', 'andesite', 'diorite',
    'granite', 'dripstone_block', 'dirt', 'gravel',
]);
const UTILITY_BLOCKS = new Set(['crafting_table', 'furnace', 'torch', 'chest', 'barrel', 'bed']);
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function key(position) {
    return `${position.x},${position.y},${position.z}`;
}

function isSolid(block) {
    return Boolean(block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air'
        && block.name !== 'water' && block.name !== 'lava' && block.boundingBox === 'block');
}

function isPassable(block) {
    return !block || ['air', 'cave_air', 'void_air'].includes(block.name) || block.boundingBox === 'empty';
}

function adjacentBlocks(bot, position) {
    return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
        .map(([x, y, z]) => bot.blockAt(new Vec3(position.x + x, position.y + y, position.z + z)));
}

export function isSafeAccessCandidate(bot, candidate, targetPosition, { preservePlacedUtilityBlocks = true } = {}) {
    if (!candidate?.position || !NATURAL_ACCESS_BLOCKS.has(candidate.name)) return false;
    if (preservePlacedUtilityBlocks && UTILITY_BLOCKS.has(candidate.name)) return false;
    const feet = bot.entity.position;
    const botFloor = { x: Math.floor(feet.x), y: Math.floor(feet.y), z: Math.floor(feet.z) };
    if (candidate.position.y < botFloor.y) return false;
    const below = bot.blockAt(new Vec3(candidate.position.x, candidate.position.y - 1, candidate.position.z));
    const above = bot.blockAt(new Vec3(candidate.position.x, candidate.position.y + 1, candidate.position.z));
    if (!isSolid(below) || !isPassable(above)) return false;
    if (candidate.name === 'gravel' && isSolid(bot.blockAt(new Vec3(candidate.position.x, candidate.position.y + 1, candidate.position.z)))) return false;
    if (adjacentBlocks(bot, candidate.position).some(block => block?.name === 'lava' || block?.name === 'water')) return false;
    const candidateDistance = Math.hypot(candidate.position.x - botFloor.x, candidate.position.z - botFloor.z);
    const targetDistance = Math.hypot(targetPosition.x - botFloor.x, targetPosition.z - botFloor.z);
    const afterDistance = Math.hypot(targetPosition.x - candidate.position.x, targetPosition.z - candidate.position.z);
    return candidateDistance <= 1.5 && afterDistance < targetDistance;
}

export async function ensureMiningReachability(bot, targetBlock, {
    moveTo,
    log = () => {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    instincts = bot.instincts || {},
    force = false,
    digBlock = candidate => bot.dig(candidate),
} = {}) {
    const mining = instincts.mining || {};
    if (mining.allowAccessExcavation === false || mining.allowBreakingNaturalBlocksForOreAccess === false) {
        return { status: 'blocked', reasonCode: 'access_excavation_disabled' };
    }
    if (!targetBlock?.position) return { status: 'blocked', reasonCode: 'unknown_target' };
    const maxBlocks = Math.max(1, mining.maxAccessExcavationBlocks ?? 6);
    const maxMs = Math.max(1_000, (mining.maxAccessExcavationSeconds ?? 20) * 1_000);
    const maxDistance = Math.max(1, mining.maxAccessExcavationDistance ?? 4);
    const start = { ...bot.entity.position };
    const deadline = Date.now() + maxMs;
    const target = targetBlock.position;
    if (!force && Math.hypot(target.x - start.x, target.y - start.y, target.z - start.z) <= 4.5) {
        return { status: 'completed', reasonCode: 'ore_reachable', attempts: 0 };
    }

    log('Mining access: target visible but unreachable.');
    for (let attempt = 0; attempt < maxBlocks && Date.now() < deadline; attempt++) {
        if (bot.interrupt_code) return { status: 'cancelled', reasonCode: 'interrupted', attempts: attempt };
        const current = bot.entity.position;
        if (Math.hypot(current.x - start.x, current.y - start.y, current.z - start.z) > maxDistance) {
            return { status: 'blocked', reasonCode: 'max_access_excavation_reached', attempts: attempt };
        }
        const floorY = Math.floor(current.y);
        const candidates = DIRECTIONS
            .map(([x, z]) => bot.blockAt(new Vec3(Math.floor(current.x) + x, floorY, Math.floor(current.z) + z)))
            .filter(candidate => candidate?.position && key(candidate.position) !== key(target))
            .filter(candidate => isSafeAccessCandidate(bot, candidate, target, {
                preservePlacedUtilityBlocks: mining.preservePlacedUtilityBlocks !== false,
            }));
        const candidate = candidates[0];
        if (!candidate) return { status: 'blocked', reasonCode: 'no_safe_standable_position', attempts: attempt };
        try {
            log(`Mining access: breaking ${candidate.name} at ${candidate.position.x} ${candidate.position.y} ${candidate.position.z} for headroom.`);
            const dug = await digBlock(candidate);
            if (dug?.status && dug.status !== 'completed') {
                return { status: dug.status, reasonCode: dug.reasonCode || 'access_excavation_failed', attempts: attempt + 1 };
            }
            await sleep(100);
            const opened = bot.blockAt(new Vec3(candidate.position.x, candidate.position.y, candidate.position.z));
            if (!isPassable(opened)) return { status: 'blocked', reasonCode: 'access_excavation_failed', attempts: attempt + 1 };
            if (typeof moveTo === 'function') {
                const moved = await moveTo(candidate.position);
                if (moved) log('Mining access: moved into opened pocket.');
            }
            if (Math.hypot(target.x - bot.entity.position.x, target.y - bot.entity.position.y, target.z - bot.entity.position.z) <= 4.5) {
                log('Mining access: ore now reachable.');
                return { status: 'completed', reasonCode: 'ore_reachable', attempts: attempt + 1 };
            }
        } catch (error) {
            return { status: 'blocked', reasonCode: 'access_excavation_failed', attempts: attempt + 1 };
        }
    }
    return { status: 'blocked', reasonCode: 'max_access_excavation_reached', attempts: maxBlocks };
}
