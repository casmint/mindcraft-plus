import assert from 'node:assert/strict';
import test from 'node:test';

import { MovementStuckError, withMovementWatchdog } from '../../src/agent/runtime/movement_watchdog.js';

function stuckBot() {
    return {
        entity: { position: { x: 0, y: 64, z: 0 } },
        output: '',
        pathfinder: {
            goal: { x: 1 },
            setGoal(goal) { this.goal = goal; },
            stop() { this.stopped = true; },
        },
        clearControlStates() { this.controlsCleared = true; },
    };
}

test('movement watchdog stops a path with no horizontal progress', async () => {
    const bot = stuckBot();
    await assert.rejects(
        withMovementWatchdog(bot, 'test_move', () => new Promise(() => {}), {
            sampleIntervalMs: 10,
            stuckWindowMs: 30,
            minHorizontalProgress: 0.2,
        }),
        error => error instanceof MovementStuckError && error.reasonCode === 'no_horizontal_progress',
    );
    assert.equal(bot.pathfinder.stopped, true);
    assert.equal(bot.controlsCleared, true);
    assert.match(bot.output, /Movement watchdog cleared controls/);
});

test('watchdog does not classify an immediately completed non-movement action as stuck', async () => {
    const bot = stuckBot();
    const result = await withMovementWatchdog(bot, 'craft_recipe', async () => 'crafted', {
        sampleIntervalMs: 10,
        stuckWindowMs: 20,
    });
    assert.equal(result, 'crafted');
    assert.equal(bot.pathfinder.stopped, undefined);
});
