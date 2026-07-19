import assert from 'node:assert/strict';
import test from 'node:test';

import {
    inventoryDelta,
    snapshotInventory,
    verifyAnyInventoryIncrease,
    verifyInventoryIncrease,
} from '../../src/agent/runtime/verifiers.js';

function botWithItems(items) {
    return { inventory: { items: () => items } };
}

test('inventory snapshots aggregate stacks and deltas are deterministic', () => {
    const before = snapshotInventory(botWithItems([
        { name: 'oak_log', count: 2 },
        { name: 'oak_log', count: 3 },
        { name: 'stick', count: 4 },
    ]));
    const after = snapshotInventory(botWithItems([
        { name: 'oak_log', count: 1 },
        { name: 'stick', count: 8 },
        { name: 'torch', count: 2 },
    ]));

    assert.deepEqual(before, { oak_log: 5, stick: 4 });
    assert.deepEqual(inventoryDelta(before, after), { oak_log: -4, stick: 4, torch: 2 });
});

test('inventory verifier reports completed only when the requested increase is observed', () => {
    const result = verifyInventoryIncrease({
        before: { oak_log: 1 },
        after: { oak_log: 4 },
        itemName: 'oak_log',
        requested: 3,
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.reasonCode, 'inventory_delta_verified');
    assert.equal(result.evidence.verifiedCount, 3);
});

test('inventory verifier distinguishes a partial result from no observed output', () => {
    const partial = verifyInventoryIncrease({
        before: { stick: 0 },
        after: { stick: 2 },
        itemName: 'stick',
        requested: 4,
    });
    const missing = verifyInventoryIncrease({
        before: { stick: 2 },
        after: { stick: 2, oak_planks: 4 },
        itemName: 'stick',
        requested: 1,
    });

    assert.equal(partial.status, 'partial');
    assert.equal(partial.retryable, true);
    assert.equal(missing.status, 'blocked');
    assert.equal(missing.reasonCode, 'inventory_delta_missing');
});

test('generic collection verification observes gains without assuming a block drop name', () => {
    const result = verifyAnyInventoryIncrease({
        before: { bucket: 1, torch: 2 },
        after: { water_bucket: 1, torch: 1 },
        requested: 1,
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.reasonCode, 'inventory_gain_verified');
    assert.equal(result.evidence.verifiedCount, 1);
});
