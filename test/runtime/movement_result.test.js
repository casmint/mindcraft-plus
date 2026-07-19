import assert from 'node:assert/strict';
import test from 'node:test';
import minecraftData from 'minecraft-data';

import {
    goToNearestEntity,
    goToPosition,
    goToPositionResult,
} from '../../src/agent/library/skills.js';

function position(x, y = 64, z = 0) {
    return {
        x,
        y,
        z,
        clone() {
            return position(this.x, this.y, this.z);
        },
        distanceTo(other) {
            return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
        },
        offset(dx, dy, dz) {
            return position(this.x + dx, this.y + dy, this.z + dz);
        },
    };
}

function createMovementBot({ goto, nearestEntity } = {}) {
    const bot = {
        entity: { position: position(0) },
        interrupt_code: false,
        modes: { isOn: () => false },
        output: '',
        registry: minecraftData('1.20.4'),
        nearestEntity: nearestEntity || (() => null),
        blockAt: () => null,
        pathfinder: {
            getPathTo: async () => ({ status: 'success' }),
            setMovements() {},
            goto: goto || (async (goal) => {
                bot.entity.position = position(goal.x, goal.y, goal.z);
            }),
            stop() {},
        },
    };
    return bot;
}

test('movement result reports observed arrival and preserves the Boolean adapter', async () => {
    const bot = createMovementBot();

    const result = await goToPositionResult(bot, 4, 64, 0, 1);

    assert.equal(result.status, 'arrived');
    assert.equal(result.reasonCode, 'within_goal_radius');
    assert.equal(result.evidence.beforeDistance, 4);
    assert.equal(result.evidence.afterDistance, 0);
    assert.equal(await goToPosition(bot, 4, 64, 0, 1), true);
});

test('movement result distinguishes progress from arrival and Boolean callers receive failure', async () => {
    const bot = createMovementBot({
        goto: async () => {
            bot.entity.position = position(3);
        },
    });

    const result = await goToPositionResult(bot, 10, 64, 0, 1);

    assert.equal(result.status, 'progressed');
    assert.equal(result.reasonCode, 'goal_not_reached');
    assert.equal(result.retryable, true);
    assert.equal(await goToPosition(bot, 10, 64, 0, 1), false);
});

test('nearest-entity Boolean wrapper propagates a failed nested movement', async () => {
    const enemy = { name: 'zombie', position: position(10), type: 'mob' };
    const bot = createMovementBot({
        goto: async () => {},
        nearestEntity: (predicate) => predicate(enemy) ? enemy : null,
    });

    const result = await goToNearestEntity(bot, 'zombie', 1, 16);

    assert.equal(result, false);
});

test('movement result reports cancellation before pathfinding', async () => {
    const bot = createMovementBot();
    const controller = new AbortController();
    controller.abort('test');

    const result = await goToPositionResult(bot, 4, 64, 0, 1, { signal: controller.signal });

    assert.equal(result.status, 'cancelled');
    assert.equal(result.reasonCode, 'cancelled_before_start');
});
