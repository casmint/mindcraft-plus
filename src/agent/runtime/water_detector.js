function floorPosition(position) {
    return { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) };
}

function isWaterCell(cell) {
    return Boolean(cell?.observed && cell.name === 'water');
}

export function isInWater(bot, snapshot) {
    if (typeof bot.entity?.isInWater === 'function') return Boolean(bot.entity.isInWater());
    if (typeof bot.entity?.isInWater === 'boolean') return bot.entity.isInWater;
    const feet = floorPosition(bot.entity.position);
    return isWaterCell(snapshot?.getAbsolute(feet)) || isWaterCell(snapshot?.getAbsolute({ ...feet, y: feet.y + 1 }));
}

export function isHeadUnderwater(bot, snapshot) {
    const position = floorPosition(bot.entity.position);
    return isWaterCell(snapshot?.getAbsolute({ ...position, y: position.y + 1 }));
}

export class WaterDetector {
    constructor({ now = () => Date.now(), stagnantMs = 1_500, drowningOxygen = 4 } = {}) {
        this.now = now;
        this.stagnantMs = stagnantMs;
        this.drowningOxygen = drowningOxygen;
        this.lastPosition = null;
        this.lastMovementAt = null;
    }

    reset() {
        this.lastPosition = null;
        this.lastMovementAt = null;
    }

    observe(bot, snapshot) {
        const now = this.now();
        const position = floorPosition(bot.entity.position);
        const sampledPosition = bot.entity.position;
        const inWater = isInWater(bot, snapshot);
        const headUnderwater = isHeadUnderwater(bot, snapshot);
        const velocityY = bot.entity.velocity?.y ?? 0;
        const oxygen = bot.oxygenLevel ?? bot.entity.oxygenLevel ?? null;
        const moved = this.lastPosition && Math.hypot(
            sampledPosition.x - this.lastPosition.x,
            sampledPosition.y - this.lastPosition.y,
            sampledPosition.z - this.lastPosition.z,
        ) > 0.05;

        if (moved || !inWater) this.lastMovementAt = now;
        if (this.lastMovementAt == null) this.lastMovementAt = now;
        this.lastPosition = { x: sampledPosition.x, y: sampledPosition.y, z: sampledPosition.z };

        const sinking = inWater && velocityY < -0.03;
        const drowningRisk = headUnderwater && oxygen != null && oxygen <= this.drowningOxygen;
        const stuck = inWater && now - this.lastMovementAt >= this.stagnantMs;
        const feet = snapshot?.getAbsolute(position) || null;
        const head = snapshot?.getAbsolute({ ...position, y: position.y + 1 }) || null;
        const lavaAdjacent = snapshot?.detectHazards?.({ maxDistance: 1 })?.some(cell => cell.name === 'lava') || false;
        const state = !inWater ? 'dry'
            : lavaAdjacent ? 'hazardous_water'
            : drowningRisk ? 'drowning_risk'
            : headUnderwater ? 'submerged'
            : sinking ? 'sinking'
            : stuck ? 'trapped_water'
            : 'swimming_surface';

        return {
            state,
            inWater,
            headUnderwater,
            sinking,
            drowningRisk,
            stuck,
            lavaAdjacent,
            oxygen,
            velocityY,
            feet,
            head,
            position,
            snapshotId: snapshot?.id ?? null,
            requiresRecovery: ['hazardous_water', 'drowning_risk', 'submerged', 'sinking', 'trapped_water'].includes(state),
        };
    }
}
