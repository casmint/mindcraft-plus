import assert from 'node:assert/strict';
import test from 'node:test';

import { findConnectedOreVein, isOreBlockName, oreCollectionLimit } from '../../src/agent/runtime/ore_vein.js';

function block(name, x, y = 12, z = 0) {
    return { name, position: { x, y, z } };
}

test('ore vein planner includes diagonal ore and respects only an explicit emergency cap', () => {
    const blocks = new Map([
        ['0,12,0', block('diamond_ore', 0)],
        ['1,12,0', block('diamond_ore', 1)],
        ['2,12,0', block('diamond_ore', 2)],
        ['2,13,1', block('deepslate_diamond_ore', 2, 13, 1)], // corner-connected
        ['5,12,0', block('diamond_ore', 5)], // disconnected
    ]);
    const vein = findConnectedOreVein(blocks.get('0,12,0'),
        ['diamond_ore', 'deepslate_diamond_ore'],
        position => blocks.get(`${position.x},${position.y},${position.z}`) || null,
        { radius: 4, maxBlocks: 64 });

    assert.deepEqual(vein.map(item => `${item.position.x},${item.position.y},${item.position.z}`), [
        '0,12,0', '1,12,0', '2,12,0', '2,13,1',
    ]);
    assert.equal(isOreBlockName('diamond_ore'), true);
    assert.equal(isOreBlockName('deepslate_diamond_ore'), true);
    assert.equal(isOreBlockName('ancient_debris'), true);
    assert.equal(isOreBlockName('stone'), false);
});

test('ore vein planner still honors its anti-bug hard cap', () => {
    const blocks = new Map();
    for (let x = 0; x < 6; x++) blocks.set(`${x},12,0`, block('coal_ore', x));
    const vein = findConnectedOreVein(blocks.get('0,12,0'), ['coal_ore'],
        position => blocks.get(`${position.x},${position.y},${position.z}`) || null,
        { radius: 12, maxBlocks: 4 });
    assert.equal(vein.length, 4);
});

test('ore vein planner has no normal eight-block limit', () => {
    const blocks = new Map();
    for (let x = 0; x < 10; x++) blocks.set(`${x},12,0`, block('iron_ore', x));
    const vein = findConnectedOreVein(blocks.get('0,12,0'), ['iron_ore'],
        position => blocks.get(`${position.x},${position.y},${position.z}`) || null);
    assert.equal(vein.length, 10);
});

test('ore requests continue through a full vein unless exact count is explicit', () => {
    assert.equal(oreCollectionLimit({ requestedMinimum: 1, hardCap: 64 }), 64);
    assert.equal(oreCollectionLimit({ requestedMinimum: 4, hardCap: 64 }), 64);
    assert.equal(oreCollectionLimit({ requestedMinimum: 4, exactCount: true, hardCap: 64 }), 4);
    assert.equal(oreCollectionLimit({ requestedMinimum: 4, mineFullVein: false, hardCap: 64 }), 4);
});
