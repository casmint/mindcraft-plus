import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureMiningReachability, isSafeAccessCandidate } from '../../src/agent/runtime/mining_access.js';

function createBot({ candidateName = 'stone', water = false } = {}) {
    const blocks = new Map();
    const put = (name, x, y, z, boundingBox = 'block') => blocks.set(`${x},${y},${z}`, {
        name,
        position: { x, y, z },
        boundingBox,
        canHarvest: () => true,
    });
    put('stone', 0, 63, 0);
    put(candidateName, 1, 64, 0);
    put('stone', 1, 63, 0);
    put('air', 1, 65, 0, 'empty');
    put('diamond_ore', 5, 64, 0);
    if (water) put('water', 2, 64, 0, 'empty');
    const bot = {
        entity: { position: { x: 0, y: 64, z: 0 } },
        inventory: { items: () => [] },
        tool: { equipForBlock: async () => {} },
        heldItem: { type: 1 },
        blockAt(position) { return blocks.get(`${position.x},${position.y},${position.z}`) || { name: 'air', boundingBox: 'empty' }; },
        async dig(block) { put('air', block.position.x, block.position.y, block.position.z, 'empty'); },
    };
    return { bot, target: blocks.get('5,64,0'), candidate: blocks.get('1,64,0') };
}

test('access excavation opens a safe natural pocket toward visible ore', async () => {
    const { bot, target } = createBot();
    const logs = [];
    const result = await ensureMiningReachability(bot, target, {
        log: message => logs.push(message),
        moveTo: async position => {
            bot.entity.position = { ...position };
            return true;
        },
        sleep: async () => {},
    });

    assert.equal(result.reasonCode, 'ore_reachable');
    assert.equal(bot.entity.position.x, 1);
    assert.equal(bot.blockAt({ x: 1, y: 64, z: 0 }).name, 'air');
    assert.equal(logs.some(message => message.includes('breaking stone')), true);
});

test('access excavation rejects liquid-adjacent or utility candidates', () => {
    const wet = createBot({ water: true });
    assert.equal(isSafeAccessCandidate(wet.bot, wet.candidate, wet.target.position), false);
    const utility = createBot({ candidateName: 'furnace' });
    assert.equal(isSafeAccessCandidate(utility.bot, utility.candidate, utility.target.position), false);
});
