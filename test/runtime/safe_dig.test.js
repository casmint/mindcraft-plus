import assert from 'node:assert/strict';
import test from 'node:test';

import { safeDigBlock, safeDigTimeoutMs } from '../../src/agent/runtime/safe_dig.js';

function digBot({ blockName = 'diamond_ore', heldName = 'iron_pickaxe', interrupted = false } = {}) {
    let block = {
        name: blockName,
        position: { x: 1, y: 20, z: 1 },
        boundingBox: 'block',
        canHarvest: () => heldName !== 'wooden_pickaxe',
    };
    return {
        interrupt_code: interrupted,
        heldItem: { name: heldName, type: 1 },
        tool: { equipForBlock: async () => {} },
        blockAt: () => block,
        async dig() { block = { name: 'air', boundingBox: 'empty' }; },
    };
}

test('diamond ore waits for one continuous valid dig and verifies block change', async () => {
    const bot = digBot();
    const target = bot.blockAt();
    const result = await safeDigBlock(bot, target);

    assert.equal(result.status, 'completed');
    assert.equal(result.retries, 0);
    assert.equal(bot.blockAt().name, 'air');
});

test('deepslate ore receives a longer timeout than normal diamond ore', () => {
    assert.ok(safeDigTimeoutMs({ name: 'deepslate_diamond_ore' }) > safeDigTimeoutMs({ name: 'diamond_ore' }));
});

test('logs and hard ores receive sane non-tiny dig windows', () => {
    assert.ok(safeDigTimeoutMs({ name: 'oak_log' }) >= 8_000);
    assert.ok(safeDigTimeoutMs({ name: 'diamond_ore' }) >= 12_000);
});

test('wrong diamond tool fails immediately without digging', async () => {
    const bot = digBot({ heldName: 'wooden_pickaxe' });
    const result = await safeDigBlock(bot, bot.blockAt());

    assert.equal(result.reasonCode, 'wrong_tool');
    assert.equal(bot.blockAt().name, 'diamond_ore');
});

test('interrupted dig returns cancellation rather than a timeout', async () => {
    const bot = digBot({ interrupted: true });
    const result = await safeDigBlock(bot, bot.blockAt());

    assert.equal(result.status, 'cancelled');
    assert.equal(result.reasonCode, 'interrupted');
});
