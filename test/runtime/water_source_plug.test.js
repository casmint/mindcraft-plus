import assert from 'node:assert/strict';
import test from 'node:test';

import { WaterSourcePlugState, plugWaterSourceIfSafe } from '../../src/agent/runtime/water_source_plug.js';

function cell(name, x, y = 64, z = 0, metadata = null) {
    return { observed: true, name, metadata, position: { x, y, z } };
}

function snapshot(cells) {
    return {
        cells,
        findAll({ names } = {}) {
            return cells.filter(item => !names || item.name === names);
        },
        detectHazards() {
            return cells.filter(item => item.name === 'lava' || item.name === 'water');
        },
        getAbsolute(position) {
            return cells.find(item => item.position.x === position.x
                && item.position.y === position.y && item.position.z === position.z) || null;
        },
    };
}

function bot() {
    return {
        entity: { position: { x: 0, y: 64, z: 0 }, velocity: { y: 0 } },
        inventory: { items: () => [{ name: 'cobblestone', count: 3 }] },
        instincts: { water: { plugSingleSourceFlow: true } },
    };
}

test('plugs one visible small source and verifies that local flow was reduced', async () => {
    let plugged = false;
    const before = snapshot([
        cell('water', 1, 64, 0, 0),
        cell('water', 0, 64, 0, 1),
        { ...cell('stone', 1, 63, 0), isSolid: true },
    ]);
    const after = snapshot([
        cell('cobblestone', 1, 64, 0),
        cell('air', 0, 64, 0),
    ]);
    const localMap = { getSnapshot: () => plugged ? after : before };

    const result = await plugWaterSourceIfSafe(bot(), {
        localMap,
        sleep: async () => {},
        placeAt: async (block, position) => {
            assert.equal(block, 'cobblestone');
            assert.deepEqual(position, { x: 1, y: 64, z: 0 });
            plugged = true;
            return true;
        },
    });

    assert.equal(result.status, 'plugged');
    assert.equal(result.reasonCode, 'flow_reduced');
});

test('refuses lava-adjacent or repeated failed source plugs', async () => {
    const source = snapshot([
        cell('water', 1, 64, 0, 0),
        cell('water', 0, 64, 0, 1),
        cell('lava', 2, 64, 0),
        { ...cell('stone', 1, 63, 0), isSolid: true },
    ]);
    const localMap = { getSnapshot: () => source };
    const unsafe = await plugWaterSourceIfSafe(bot(), {
        localMap,
        placeAt: async () => true,
    });
    assert.equal(unsafe.status, 'unsafe_near_lava');

    let now = 0;
    const state = new WaterSourcePlugState({ now: () => now, cooldownMs: 100 });
    const failed = await plugWaterSourceIfSafe(bot(), {
        localMap: { getSnapshot: () => snapshot([
            cell('water', 1, 64, 0, 0),
            cell('water', 0, 64, 0, 1),
            { ...cell('stone', 1, 63, 0), isSolid: true },
        ]) },
        state,
        sleep: async () => {},
        placeAt: async () => true,
    });
    assert.equal(failed.status, 'verification_failed');
    const cooldown = await plugWaterSourceIfSafe(bot(), {
        localMap: { getSnapshot: () => snapshot([
            cell('water', 1, 64, 0, 0),
            cell('water', 0, 64, 0, 1),
            { ...cell('stone', 1, 63, 0), isSolid: true },
        ]) },
        state,
        placeAt: async () => true,
    });
    assert.equal(cooldown.status, 'cooldown_active');
});
