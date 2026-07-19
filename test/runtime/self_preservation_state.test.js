import assert from 'node:assert/strict';
import test from 'node:test';

import {
    SelfPreservationState,
    hasStableLiveState,
    shouldDeferSelfPreservation,
    shouldUseHorizontalWaterExit,
    waterHazardSignature,
} from '../../src/agent/runtime/self_preservation_state.js';

test('self preservation cannot re-enter while active and rate limits unchanged non-emergencies', () => {
    let now = 0;
    const state = new SelfPreservationState({ now: () => now, minIntervalMs: 100 });

    assert.equal(state.begin('water:one').start, true);
    assert.equal(state.begin('water:one').reasonCode, 'self_preservation_active');
    state.finish({ reasonCode: 'shallow_water_exit_unverified' });
    now = 50;
    assert.equal(state.begin('water:one').reasonCode, 'self_preservation_rate_limited');
    assert.equal(state.begin('water:one', { emergency: true }).start, true);
});

test('repeated hazard signature triggers a loop breaker cooldown', () => {
    let now = 0;
    const state = new SelfPreservationState({
        now: () => now,
        minIntervalMs: 0,
        loopLimit: 3,
        cooldownMs: 500,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal(state.begin('water:same').start, true);
        state.finish({ reasonCode: 'failed' });
        now += 1;
    }
    const loop = state.begin('water:same');

    assert.equal(loop.reasonCode, 'self_preservation_loop_detected');
    assert.equal(state.begin('water:same').reasonCode, 'self_preservation_cooldown');
});

test('verified water exit suppresses the same hazard while drowning bypasses the cooldown', () => {
    let now = 0;
    const state = new SelfPreservationState({ now: () => now, cooldownMs: 500 });

    assert.equal(state.begin('water:resolved').start, true);
    state.finish({ status: 'completed', reasonCode: 'shallow_water_exit_verified' });
    now = 1;
    assert.equal(state.begin('water:resolved').reasonCode, 'resolved_water_cooldown');
    assert.equal(state.begin('water:resolved', { emergency: true }).start, true);
});

test('stable footing near water does not create a water recovery signature', () => {
    const signature = waterHazardSignature({
        position: { x: 1, y: 64, z: 1 },
        feet: { name: 'air' },
        below: { name: 'stone' },
        head: { name: 'air' },
        ceilingOffset: null,
        drowning: false,
        grounded: true,
    });

    assert.doesNotMatch(signature, /feet_water/);
});

test('live stable footing ignores nearby water while shallow feet-water is not stable', () => {
    const solid = { observed: true, name: 'stone', isSolid: true };
    assert.equal(hasStableLiveState({
        below: solid,
        feet: { name: 'air' },
        head: { name: 'air' },
    }), true);
    assert.equal(hasStableLiveState({
        below: solid,
        feet: { name: 'water' },
        head: { name: 'air' },
    }), false);
});

test('self preservation defers to unstuck and cleanup unless there is an emergency', () => {
    assert.equal(shouldDeferSelfPreservation({ currentAction: 'mode:unstuck', actionState: 'running' }), 'unstuck_active_no_emergency');
    assert.equal(shouldDeferSelfPreservation({ currentAction: 'mode:item_collecting', actionState: 'cancelling' }), 'cleanup_in_progress');
    assert.equal(shouldDeferSelfPreservation({ currentAction: 'mode:unstuck', actionState: 'cancelling', emergency: true }), null);
});

test('water hazard signature records feet, head, ground, ceiling, and drowning state', () => {
    const signature = waterHazardSignature({
        position: { x: 2.9, y: 63.1, z: -1.2 },
        feet: { name: 'water' },
        below: { name: 'stone' },
        head: { name: 'air' },
        ceilingOffset: 0,
        drowning: false,
        grounded: true,
    });

    assert.match(signature, /feet_water:below_stone:head_air:ceiling_0:not_drowning:grounded/);
});

test('cramped water headroom selects a horizontal exit instead of upward swimming', () => {
    assert.equal(shouldUseHorizontalWaterExit({
        shallowStanding: false,
        lavaAdjacent: false,
        crampedHeadroom: true,
    }), true);
    assert.equal(shouldUseHorizontalWaterExit({
        shallowStanding: true,
        lavaAdjacent: true,
        crampedHeadroom: true,
    }), false);
});
