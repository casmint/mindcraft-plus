import assert from 'node:assert/strict';
import test from 'node:test';

import {
    composePromptWithInstructionLayers,
    loadInstructionLayers,
} from '../../src/agent/profile_instructions.js';

test('instruction layers load in profile order with a stable manifest', () => {
    const logs = [];
    const layers = loadInstructionLayers([
        './agents/default.md',
        './agents/surfski.md',
    ], { logger: { info: message => logs.push(message) } });

    assert.deepEqual(layers.map(layer => layer.path), ['agents/default.md', 'agents/surfski.md']);
    assert.equal(layers.every(layer => layer.bytes > 0 && layer.sha256.length === 64), true);
    assert.deepEqual(logs.map(message => message.includes('[profile instructions] loaded')), [true, true]);
});

test('instruction layers are injected after static rules and before memory/context markers', () => {
    const layers = loadInstructionLayers(['./agents/default.md', './agents/surfski.md'], { logger: {} });
    const prompt = composePromptWithInstructionLayers('Core runtime rules.\n$MEMORY\n$STATS', layers);

    assert.equal(prompt.indexOf('Core runtime rules.') < prompt.indexOf('## Profile instruction layers'), true);
    assert.equal(prompt.indexOf('agents/default.md') < prompt.indexOf('agents/surfski.md'), true);
    assert.equal(prompt.indexOf('agents/surfski.md') < prompt.indexOf('$MEMORY'), true);
});

test('profiles without instruction layers preserve the existing prompt', () => {
    assert.equal(composePromptWithInstructionLayers('Core\n$MEMORY', []), 'Core\n$MEMORY');
    assert.deepEqual(loadInstructionLayers(undefined, { logger: {} }), []);
});

test('missing or escaping instruction layers fail explicitly', () => {
    assert.throws(
        () => loadInstructionLayers(['./agents/not-present.md'], { logger: {} }),
        /missing or unreadable/,
    );
    assert.throws(
        () => loadInstructionLayers(['../outside.md'], { logger: {} }),
        /escapes the repository/,
    );
});
