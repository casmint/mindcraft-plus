import Vec3 from 'vec3';

const AIR_NAMES = new Set(['air', 'cave_air', 'void_air']);
const CONTAINER_NAMES = new Set(['barrel', 'chest', 'trapped_chest', 'ender_chest', 'shulker_box']);
const FACE_DIRECTIONS = [
    { name: 'down', x: 0, y: -1, z: 0 },
    { name: 'up', x: 0, y: 1, z: 0 },
    { name: 'north', x: 0, y: 0, z: -1 },
    { name: 'south', x: 0, y: 0, z: 1 },
    { name: 'west', x: -1, y: 0, z: 0 },
    { name: 'east', x: 1, y: 0, z: 0 },
];

function coordinateKey({ x, y, z }) {
    return `${x},${y},${z}`;
}

function floorPosition(position) {
    return {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
    };
}

function normalizedOptions({ radius = 4, heightUp = 3, heightDown = 3, ttlMs = 500 } = {}) {
    for (const [name, value] of Object.entries({ radius, heightUp, heightDown, ttlMs })) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`${name} must be a non-negative finite number.`);
        }
    }
    return {
        radius: Math.floor(radius),
        heightUp: Math.floor(heightUp),
        heightDown: Math.floor(heightDown),
        ttlMs: Math.floor(ttlMs),
    };
}

function classifyBlock(block, position, relative, scanIndex) {
    if (!block) {
        return Object.freeze({
            observed: false,
            position: Object.freeze(position),
            relative: Object.freeze(relative),
            scanIndex,
        });
    }
    const name = block.name || 'unknown';
    const isAir = AIR_NAMES.has(name);
    const isLiquid = name === 'water' || name === 'lava';
    const isSolid = !isAir && !isLiquid && block.boundingBox === 'block';
    return Object.freeze({
        observed: true,
        position: Object.freeze(position),
        relative: Object.freeze(relative),
        scanIndex,
        name,
        type: block.type ?? null,
        metadata: block.metadata ?? null,
        stateId: block.stateId ?? null,
        boundingBox: block.boundingBox ?? null,
        isAir,
        isLiquid,
        isSolid,
        isPassable: isAir || isLiquid || block.boundingBox === 'empty',
        isDoor: name.endsWith('_door') || name.endsWith('_trapdoor') || name.endsWith('_fence_gate'),
        isContainer: CONTAINER_NAMES.has(name) || name.endsWith('_shulker_box'),
        isBed: name.endsWith('_bed'),
        isLog: name.endsWith('_log') || name.endsWith('_wood') || name.endsWith('_stem') || name.endsWith('_hyphae'),
        isOre: name.endsWith('_ore'),
    });
}

function compareCellsByDistance(origin, left, right) {
    const leftDistance = (left.position.x - origin.x) ** 2 + (left.position.y - origin.y) ** 2 + (left.position.z - origin.z) ** 2;
    const rightDistance = (right.position.x - origin.x) ** 2 + (right.position.y - origin.y) ** 2 + (right.position.z - origin.z) ** 2;
    return leftDistance - rightDistance || left.scanIndex - right.scanIndex;
}

export class BlockSnapshot {
    #cells;

    constructor({ id, capturedAt, dimension, origin, options, cells }) {
        this.id = id;
        this.schemaVersion = 1;
        this.capturedAt = capturedAt;
        this.dimension = dimension;
        this.origin = Object.freeze(origin);
        this.options = Object.freeze(options);
        this.bounds = Object.freeze({
            min: Object.freeze({ x: origin.x - options.radius, y: origin.y - options.heightDown, z: origin.z - options.radius }),
            max: Object.freeze({ x: origin.x + options.radius, y: origin.y + options.heightUp, z: origin.z + options.radius }),
        });
        this.#cells = cells;
        this.cells = Object.freeze([...cells.values()]);
        this.scanStats = Object.freeze({
            requested: this.cells.length,
            observed: this.cells.filter(cell => cell.observed).length,
            unloaded: this.cells.filter(cell => !cell.observed).length,
            missing: this.cells.filter(cell => !cell.observed).length,
        });
        Object.freeze(this);
    }

    getAbsolute(position) {
        return this.#cells.get(coordinateKey(position)) || null;
    }

    getRelative(relative) {
        return this.getAbsolute({
            x: this.origin.x + relative.x,
            y: this.origin.y + relative.y,
            z: this.origin.z + relative.z,
        });
    }

    findAll({ names, types, predicate } = {}) {
        const nameSet = names ? new Set(Array.isArray(names) ? names : [names]) : null;
        const typeSet = types ? new Set(Array.isArray(types) ? types : [types]) : null;
        return this.cells.filter(cell => cell.observed
            && (!nameSet || nameSet.has(cell.name))
            && (!typeSet || typeSet.has(cell.type))
            && (!predicate || predicate(cell)));
    }

    findNearest(query = {}) {
        return this.findAll(query)
            .filter(cell => query.maxDistance == null || Math.hypot(
                cell.position.x - this.origin.x,
                cell.position.y - this.origin.y,
                cell.position.z - this.origin.z,
            ) <= query.maxDistance)
            .sort((left, right) => compareCellsByDistance(this.origin, left, right))[0] || null;
    }

    getFloor(position) {
        return this.getAbsolute({ x: position.x, y: position.y - 1, z: position.z });
    }

    hasHeadroom(position, height = 2) {
        const occupants = Array.from({ length: height }, (_, offset) => this.getAbsolute({
            x: position.x,
            y: position.y + offset,
            z: position.z,
        }));
        return occupants.every(cell => cell?.observed && cell.isPassable && !cell.isLiquid);
    }

    getWalls(position) {
        return FACE_DIRECTIONS
            .filter(face => face.y === 0)
            .map(face => ({
                direction: face.name,
                cell: this.getAbsolute({ x: position.x + face.x, y: position.y, z: position.z + face.z }),
            }))
            .filter(({ cell }) => cell?.observed && cell.isSolid);
    }

    detectHole(position) {
        const floor = this.getFloor(position);
        if (!floor?.observed) return { isHole: false, reasonCode: 'geometry_unknown', floor };
        if (floor.isSolid) return { isHole: false, reasonCode: 'solid_floor', floor };
        return { isHole: true, reasonCode: floor.isLiquid ? 'liquid_below' : 'missing_floor', floor };
    }

    evaluateStandable(position, height = 2) {
        const floor = this.getFloor(position);
        const occupants = Array.from({ length: height }, (_, offset) => this.getAbsolute({
            x: position.x,
            y: position.y + offset,
            z: position.z,
        }));
        if (!floor?.observed || occupants.some(cell => !cell?.observed)) {
            return { standable: false, reasonCode: 'geometry_unknown', floor, occupants };
        }
        if (!floor.isSolid) {
            return { standable: false, reasonCode: 'missing_solid_floor', floor, occupants };
        }
        if (!this.hasHeadroom(position, height)) {
            return { standable: false, reasonCode: 'occupancy_blocked', floor, occupants };
        }
        return { standable: true, reasonCode: 'standable', floor, occupants };
    }

    isStandable(position, height = 2) {
        return this.evaluateStandable(position, height).standable;
    }

    findStandablePositions({ height = 2, maxDistance } = {}) {
        return this.cells
            .filter(cell => cell.observed && cell.isSolid)
            .map(cell => ({ x: cell.position.x, y: cell.position.y + 1, z: cell.position.z }))
            .filter(position => this.isStandable(position, height))
            .filter(position => maxDistance == null || Math.hypot(
                position.x - this.origin.x,
                position.y - this.origin.y,
                position.z - this.origin.z,
            ) <= maxDistance)
            .sort((left, right) => coordinateKey(left).localeCompare(coordinateKey(right)));
    }

    getPlaceableFaces(position) {
        const target = this.getAbsolute(position);
        if (!target?.observed || !target.isPassable || target.isLiquid) return [];
        return FACE_DIRECTIONS
            .map(face => {
                const supportPosition = { x: position.x - face.x, y: position.y - face.y, z: position.z - face.z };
                const support = this.getAbsolute(supportPosition);
                return support?.observed && support.isSolid
                    ? { face: face.name, normal: { x: face.x, y: face.y, z: face.z }, supportPosition, targetPosition: position }
                    : null;
            })
            .filter(Boolean);
    }

    detectHazards({ maxDistance = this.options.radius } = {}) {
        return this.findAll({ predicate: cell => cell.name === 'lava' || cell.name === 'water' })
            .filter(cell => Math.hypot(
                cell.position.x - this.origin.x,
                cell.position.y - this.origin.y,
                cell.position.z - this.origin.z,
            ) <= maxDistance)
            .sort((left, right) => compareCellsByDistance(this.origin, left, right));
    }

    summarize() {
        const counts = {};
        for (const cell of this.cells) {
            if (!cell.observed) continue;
            counts[cell.name] = (counts[cell.name] || 0) + 1;
        }
        return Object.freeze({
            snapshotId: this.id,
            bounds: this.bounds,
            scanStats: this.scanStats,
            blockCounts: Object.freeze(counts),
        });
    }
}

export class LocalBlockMap {
    constructor({ now = () => Date.now() } = {}) {
        this.now = now;
        this.cache = new Map();
        this.nextSnapshotId = 1;
    }

    invalidate() {
        this.cache.clear();
    }

    getSnapshot(bot, requestedOptions = {}) {
        const options = normalizedOptions(requestedOptions);
        const origin = floorPosition(bot.entity.position);
        const dimension = bot.game?.dimension || bot.dimension || 'unknown';
        const key = JSON.stringify({ dimension, origin, radius: options.radius, heightUp: options.heightUp, heightDown: options.heightDown });
        const cached = this.cache.get(key);
        const now = this.now();
        if (!requestedOptions.fresh && cached && now - cached.capturedAt <= options.ttlMs) {
            return cached;
        }

        const cells = new Map();
        let scanIndex = 0;
        for (let y = -options.heightDown; y <= options.heightUp; y++) {
            for (let z = -options.radius; z <= options.radius; z++) {
                for (let x = -options.radius; x <= options.radius; x++) {
                    const relative = { x, y, z };
                    const position = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
                    const block = bot.blockAt(new Vec3(position.x, position.y, position.z));
                    cells.set(coordinateKey(position), classifyBlock(block, position, relative, scanIndex++));
                }
            }
        }
        const snapshot = new BlockSnapshot({
            id: this.nextSnapshotId++,
            capturedAt: now,
            dimension,
            origin,
            options,
            cells,
        });
        this.cache.set(key, snapshot);
        return snapshot;
    }
}
