import assert from 'node:assert/strict';
import test from 'node:test';

import { pillarUp } from '../../src/agent/runtime/pillar_controller.js';

function createBot({ health = 20 } = {}) {
    const calls = [];
    return {
        health,
        instincts: { survival: { stopMiningBelowHealth: 10 } },
        entity: { position: { x: 0, y: 64, z: 0 } },
        setControlState(name, active) { calls.push(`${name}:${active}`); },
        clearControlStates() { calls.push('clear'); },
        pathfinder: { setGoal() { calls.push('goal'); }, stop() { calls.push('pathfinder.stop'); } },
        pvp: { stop() { calls.push('pvp.stop'); } },
        calls,
    };
}

test('pillar controller releases jump and clears controls after verified progress', async () => {
    const bot = createBot();
    const result = await pillarUp(bot, {
        blockType: 'dirt',
        height: 2,
        sleep: async () => {},
        placeBlock: async () => {
            bot.entity.position.y += 1;
            return true;
        },
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(bot.calls.filter(call => call.startsWith('jump:')), ['jump:true', 'jump:false', 'jump:true', 'jump:false', 'jump:false']);
    assert.equal(bot.calls.includes('clear'), true);
});

test('pillar controller aborts a failed or unsafe attempt without leaving jump held', async () => {
    const failedBot = createBot();
    const failed = await pillarUp(failedBot, {
        blockType: 'dirt',
        sleep: async () => {},
        placeBlock: async () => false,
    });
    const unsafeBot = createBot({ health: 9 });
    const unsafe = await pillarUp(unsafeBot, { blockType: 'dirt', placeBlock: async () => true });

    assert.equal(failed.reasonCode, 'pillar_placement_failed');
    assert.equal(failedBot.calls.includes('jump:false'), true);
    assert.equal(failedBot.calls.includes('clear'), true);
    assert.equal(unsafe.reasonCode, 'health_below_vertical_safety_threshold');
    assert.deepEqual(unsafeBot.calls, ['jump:false', 'clear']);
});

test('pillar controller honors cancellation and clears controls', async () => {
    const bot = createBot();
    const controller = new AbortController();
    controller.abort('stop');
    const result = await pillarUp(bot, {
        blockType: 'dirt',
        signal: controller.signal,
        placeBlock: async () => true,
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(bot.calls.includes('clear'), true);
    assert.equal(bot.calls.includes('jump:false'), true);
});
