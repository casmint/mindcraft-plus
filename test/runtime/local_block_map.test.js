import assert from 'node:assert/strict';
import test from 'node:test';

import { LocalBlockMap } from '../../src/agent/runtime/local_block_map.js';

function block(name, { boundingBox = 'block', type = 1 } = {}) {
    return { name, boundingBox, type, metadata: 0, stateId: type };
}

function createBot(entries = {}, { position = { x: 0.2, y: 64, z: 0.8 }, dimension = 'minecraft:overworld' } = {}) {
    return {
        entity: { position },
        game: { dimension },
        blockAt(vector) {
            return entries[`${vector.x},${vector.y},${vector.z}`] || null;
        },
    };
}

test('snapshot indexes an ordered cube and retains unloaded cells as unknown', () => {
    const bot = createBot({
        '0,64,0': block('chest'),
        '1,64,0': block('diamond_ore'),
    });
    const snapshot = new LocalBlockMap({ now: () => 10 }).getSnapshot(bot, { radius: 1, heightUp: 0, heightDown: 0 });

    assert.equal(snapshot.cells.length, 9);
    assert.equal(snapshot.getRelative({ x: 0, y: 0, z: 0 }).name, 'chest');
    assert.equal(snapshot.getRelative({ x: -1, y: 0, z: -1 }).scanIndex, 0);
    assert.equal(snapshot.getRelative({ x: 0, y: 0, z: 1 }).observed, false);
    assert.deepEqual(snapshot.scanStats, { requested: 9, observed: 2, unloaded: 7, missing: 7 });
    assert.equal(snapshot.findNearest({ predicate: cell => cell.isOre }).name, 'diamond_ore');
});

test('standability and placeable faces reject unknown, liquid, and blocked geometry', () => {
    const bot = createBot({
        '0,63,0': block('stone'),
        '0,64,0': block('air', { boundingBox: 'empty', type: 0 }),
        '0,65,0': block('air', { boundingBox: 'empty', type: 0 }),
        '1,63,0': block('air', { boundingBox: 'empty', type: 0 }),
        '1,64,0': block('water', { boundingBox: 'empty', type: 9 }),
        '1,65,0': block('air', { boundingBox: 'empty', type: 0 }),
        '2,63,0': block('stone'),
        '2,64,0': block('stone'),
        '2,65,0': block('air', { boundingBox: 'empty', type: 0 }),
    });
    const snapshot = new LocalBlockMap().getSnapshot(bot, { radius: 2, heightUp: 1, heightDown: 1 });

    assert.equal(snapshot.isStandable({ x: 0, y: 64, z: 0 }), true);
    assert.equal(snapshot.evaluateStandable({ x: 1, y: 64, z: 0 }).reasonCode, 'missing_solid_floor');
    assert.equal(snapshot.evaluateStandable({ x: 2, y: 64, z: 0 }).reasonCode, 'occupancy_blocked');
    assert.equal(snapshot.hasHeadroom({ x: 0, y: 64, z: 0 }), true);
    assert.equal(snapshot.detectHole({ x: 1, y: 64, z: 0 }).reasonCode, 'missing_floor');
    assert.deepEqual(snapshot.getPlaceableFaces({ x: 0, y: 64, z: 0 }).map(face => face.face), ['up']);
});

test('cache is bounded by TTL, origin/dimension, explicit invalidation, and deterministic nearest ties', () => {
    let now = 100;
    const map = new LocalBlockMap({ now: () => now });
    const bot = createBot({
        '-1,64,0': block('oak_log'),
        '1,64,0': block('oak_log'),
    });
    const first = map.getSnapshot(bot, { radius: 1, heightUp: 0, heightDown: 0, ttlMs: 10 });
    const cached = map.getSnapshot(bot, { radius: 1, heightUp: 0, heightDown: 0, ttlMs: 10 });
    now += 11;
    const expired = map.getSnapshot(bot, { radius: 1, heightUp: 0, heightDown: 0, ttlMs: 10 });
    map.invalidate();
    const invalidated = map.getSnapshot(bot, { radius: 1, heightUp: 0, heightDown: 0, ttlMs: 10 });

    assert.equal(first, cached);
    assert.notEqual(first.id, expired.id);
    assert.notEqual(expired.id, invalidated.id);
    assert.deepEqual(first.findNearest({ names: 'oak_log' }).position, { x: -1, y: 64, z: 0 });
});
