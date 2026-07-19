import assert from 'node:assert/strict';
import test from 'node:test';

import { claimCombatState, clearCombatState, getCombatState } from '../../src/agent/runtime/combat_state.js';

function threat(stance, reasonCode = 'test') {
    return { stance, reasonCode };
}

test('combat state keeps an encounter stance stable unless it escalates to escape', () => {
    const agent = { bot: {} };
    const enemy = { id: 9, name: 'skeleton', type: 'mob' };
    const engaged = claimCombatState(agent, enemy, threat('ENGAGE'), 100);
    const retreat = claimCombatState(agent, enemy, threat('RETREAT'), 200);
    const escape = claimCombatState(agent, enemy, threat('ESCAPE'), 300);

    assert.equal(engaged.stance, 'ENGAGE');
    assert.equal(engaged.ownerMode, 'self_defense');
    assert.equal(engaged.targetType, 'mob');
    assert.equal(retreat.stance, 'ENGAGE');
    assert.equal(retreat.startedAt, 100);
    assert.equal(escape.stance, 'ESCAPE');
    assert.equal(escape.ownerMode, 'cowardice');
    assert.equal(escape.startedAt, 100);
});

test('combat state expires and can be explicitly cleared when a target is gone', () => {
    const agent = { bot: {} };
    claimCombatState(agent, { id: 4, name: 'zombie' }, threat('RETREAT'), 100);

    assert.equal(getCombatState(agent, 5_101), null);
    claimCombatState(agent, { id: 4, name: 'zombie' }, threat('RETREAT'), 6_000);
    clearCombatState(agent, 'target_gone');

    assert.equal(agent.combatState, null);
    assert.equal(agent.bot.combatStateReason, 'target_gone');
});
