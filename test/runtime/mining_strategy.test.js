import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyMiningIntent,
    getResourceMiningTarget,
    isPreparedForTargetedMining,
    planTargetYDescent,
    shouldUseTargetedMining,
} from '../../src/agent/runtime/mining_strategy.js';

function botAt(y, items = [{ name: 'iron_pickaxe' }]) {
    return {
        entity: { position: { y } },
        health: 20,
        food: 20,
        inventory: { items: () => items, emptySlotCount: () => 4 },
    };
}

test('visible ore remains a casual grab even for a targeted resource request', () => {
    assert.equal(classifyMiningIntent('mine for diamonds', { visibleOre: true }), 'casual_ore_grab');
    assert.equal(shouldUseTargetedMining('diamond', { goalText: 'mine for diamonds', visibleOre: true }), false);
});

test('explicit resource requests select targeted mining targets', () => {
    assert.equal(classifyMiningIntent('mine for diamonds'), 'targeted_resource_mining');
    assert.equal(getResourceMiningTarget('diamond').preferredY, -58);
    assert.equal(getResourceMiningTarget('iron').preferredY, 16);
    assert.equal(getResourceMiningTarget('copper').preferredY, 48);
    assert.equal(getResourceMiningTarget('coal').preferredY, 80);
});

test('targeted diamond mining requires the configured pickaxe tier', () => {
    const unprepared = isPreparedForTargetedMining('diamond', botAt(10, [{ name: 'stone_pickaxe' }]));
    assert.deepEqual(unprepared, { prepared: false, reasonCode: 'missing_iron_pickaxe' });
    assert.equal(isPreparedForTargetedMining('diamond', botAt(10)).prepared, true);
});

test('target plan searches inside its band and otherwise makes a bounded descent plan', () => {
    assert.equal(planTargetYDescent('diamond', botAt(-58)).action, 'search');
    const descent = planTargetYDescent('iron', botAt(32));
    assert.equal(descent.action, 'descend');
    assert.equal(descent.targetY, 16);
});
