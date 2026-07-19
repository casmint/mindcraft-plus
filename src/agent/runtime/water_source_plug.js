const DEFAULTS = {
    plugSingleSourceFlow: true,
    maxSourcePlugRadius: 5,
    maxWaterBlocksForPlugging: 12,
    avoidPluggingNearLava: true,
    preferPlugBlocks: ['cobblestone', 'deepslate', 'dirt', 'andesite', 'diorite', 'gravel'],
};

const VALUABLE_NEARBY = new Set([
    'chest', 'barrel', 'furnace', 'crafting_table', 'torch', 'bed', 'door',
]);

function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function key(position) {
    return `${position.x},${position.y},${position.z}`;
}

export class WaterSourcePlugState {
    constructor({ now = () => Date.now(), cooldownMs = 20_000 } = {}) {
        this.now = now;
        this.cooldownMs = cooldownMs;
        this.cooldowns = new Map();
    }

    active(position) {
        return this.now() < (this.cooldowns.get(key(position)) || 0);
    }

    fail(position) {
        this.cooldowns.set(key(position), this.now() + this.cooldownMs);
    }
}

function configured(bot, instincts) {
    return { ...DEFAULTS, ...(instincts?.water || bot.instincts?.water || {}) };
}

function cheapPlugBlock(bot, preferences) {
    const items = bot.inventory?.items?.() || [];
    for (const name of preferences) {
        if (items.some(item => item.name === name && item.count > 0)) return name;
    }
    return null;
}

function isNearby(position, cell, radius) {
    return distance(position, cell.position) <= radius;
}

function hasValuableBuildNearby(snapshot, position) {
    return snapshot.cells.some(cell => cell.observed && isNearby(position, cell, 1.5)
        && (VALUABLE_NEARBY.has(cell.name) || cell.name.endsWith('_door') || cell.name.endsWith('_torch')));
}

export async function plugWaterSourceIfSafe(bot, {
    localMap = bot.localBlockMap,
    state = bot.waterSourcePlugState,
    instincts,
    placeAt,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    const water = configured(bot, instincts);
    if (water.plugSingleSourceFlow === false) return { status: 'no_single_source', reasonCode: 'plugging_disabled' };
    if (!localMap || typeof placeAt !== 'function') return { status: 'no_single_source', reasonCode: 'plugging_unavailable' };
    if (bot.entity?.velocity?.y < -0.2) return { status: 'no_single_source', reasonCode: 'water_prevents_fall' };

    const snapshot = localMap.getSnapshot(bot, {
        radius: water.maxSourcePlugRadius ?? DEFAULTS.maxSourcePlugRadius,
        heightUp: 3,
        heightDown: 3,
        fresh: true,
    });
    const radius = water.maxSourcePlugRadius ?? DEFAULTS.maxSourcePlugRadius;
    const waterCells = snapshot.findAll({ names: 'water' })
        .filter(cell => isNearby(bot.entity.position, cell, radius));
    if (waterCells.length === 0 || waterCells.length > (water.maxWaterBlocksForPlugging ?? DEFAULTS.maxWaterBlocksForPlugging)) {
        return { status: 'no_single_source', reasonCode: 'water_cluster_not_small', evidence: { waterBlocks: waterCells.length } };
    }
    const sources = waterCells.filter(cell => cell.metadata === 0);
    const flowing = waterCells.filter(cell => cell.metadata != null && cell.metadata > 0);
    if (sources.length !== 1 || flowing.length === 0) {
        return { status: 'no_single_source', reasonCode: 'source_confidence_low', evidence: { sources: sources.length, flowing: flowing.length } };
    }
    const source = sources[0];
    if (state?.active(source.position)) return { status: 'cooldown_active', reasonCode: 'source_retry_cooldown', evidence: { source: source.position } };
    if (distance(bot.entity.position, source.position) > radius) {
        return { status: 'unreachable_source', reasonCode: 'source_out_of_range', evidence: { source: source.position } };
    }
    const sourceBelow = snapshot.getAbsolute({
        x: source.position.x,
        y: source.position.y - 1,
        z: source.position.z,
    });
    if (!sourceBelow?.observed || !sourceBelow.isSolid && sourceBelow.boundingBox !== 'block') {
        return { status: 'unreachable_source', reasonCode: 'source_above_unsafe_drop', evidence: { source: source.position } };
    }
    if (water.avoidPluggingNearLava !== false
        && snapshot.detectHazards({ maxDistance: radius }).some(cell => cell.name === 'lava' && distance(cell.position, source.position) <= 2)) {
        return { status: 'unsafe_near_lava', reasonCode: 'lava_near_source', evidence: { source: source.position } };
    }
    if (hasValuableBuildNearby(snapshot, source.position)) {
        return { status: 'no_single_source', reasonCode: 'possible_player_build', evidence: { source: source.position } };
    }
    const block = cheapPlugBlock(bot, water.preferPlugBlocks || DEFAULTS.preferPlugBlocks);
    if (!block) return { status: 'no_safe_plug_block', reasonCode: 'no_disposable_block' };

    let placed = false;
    try {
        placed = await placeAt(block, source.position);
    } catch (error) {
        placed = false;
    }
    if (!placed) {
        state?.fail(source.position);
        return { status: 'unreachable_source', reasonCode: 'placement_failed', evidence: { source: source.position, block } };
    }
    await sleep(350);
    const after = localMap.getSnapshot(bot, {
        radius,
        heightUp: 3,
        heightDown: 3,
        fresh: true,
    });
    const afterWater = after.findAll({ names: 'water' }).filter(cell => isNearby(bot.entity.position, cell, radius));
    const sourceAfter = after.getAbsolute(source.position);
    if (sourceAfter?.name !== 'water' || afterWater.length < waterCells.length) {
        return {
            status: 'plugged',
            reasonCode: 'flow_reduced',
            evidence: { source: source.position, block, beforeWaterBlocks: waterCells.length, afterWaterBlocks: afterWater.length },
        };
    }
    state?.fail(source.position);
    return { status: 'verification_failed', reasonCode: 'flow_not_reduced', evidence: { source: source.position, block } };
}
