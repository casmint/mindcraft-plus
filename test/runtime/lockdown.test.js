import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isLockdownInitialized,
    lockdown,
    makeCompartment,
} from '../../src/agent/library/lockdown.js';

test('initializes SES once and exposes only explicit compartment endowments', () => {
    assert.equal(isLockdownInitialized(), false);

    const compartment = makeCompartment({
        add: (left, right) => left + right,
    });

    assert.equal(isLockdownInitialized(), true);
    assert.equal(lockdown(), false);
    assert.equal(compartment.evaluate('add(2, 3)'), 5);
    assert.equal(compartment.evaluate('typeof process'), 'undefined');
    assert.equal(compartment.evaluate('typeof require'), 'undefined');
    assert.equal(compartment.evaluate('typeof module'), 'undefined');
});
