import assert from 'node:assert/strict';
import test from 'node:test';

import { loadInstinctLayers } from '../../src/agent/instincts.js';

test('instinct layers deep-merge in order without mutating earlier layers', () => {
    const logs = [];
    const { layers, instincts } = loadInstinctLayers([
        './instincts/default.yaml',
        './instincts/survival-basic.yaml',
        './instincts/autonomous.yaml',
    ], { logger: { info: message => logs.push(message) } });

    assert.deepEqual(layers.map(layer => layer.path), [
        'instincts/default.yaml',
        'instincts/survival-basic.yaml',
        'instincts/autonomous.yaml',
    ]);
    assert.equal(instincts.resources.startupWood.mode, 'trees');
    assert.equal(instincts.resources.startupWood.count, 2);
    assert.equal(instincts.resources.minimums.food, 8);
    assert.equal(instincts.resources.minimums.coal, undefined);
    assert.equal(instincts.survival.shelterBeforeNight, true);
    assert.equal(instincts.autonomy.idleGoalIntervalSeconds, 30);
    assert.equal(Object.isFrozen(instincts), true);
    assert.equal(logs.length, 3);
});

test('missing configured instinct layers fail explicitly', () => {
    assert.throws(
        () => loadInstinctLayers(['./instincts/not-present.yaml'], { logger: {} }),
        /missing or unreadable/,
    );
});

test('debug validation warns for unknown top-level and invalid known values', () => {
    const warnings = [];
    loadInstinctLayers(['./test/fixtures/instincts/unknown-and-invalid.yaml'], {
        debug: true,
        logger: { warn: message => warnings.push(message) },
    });

    assert.equal(warnings.some(message => message.includes('unknown top-level field')), true);
    assert.equal(warnings.some(message => message.includes('resources.minimums.food')), true);
});

test('profiles without instinct layers receive an empty immutable object', () => {
    const { layers, instincts } = loadInstinctLayers(undefined, { logger: {} });

    assert.deepEqual(layers, []);
    assert.deepEqual(instincts, {});
    assert.equal(Object.isFrozen(instincts), true);
});
