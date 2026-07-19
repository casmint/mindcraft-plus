import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHostileThreat } from '../../src/agent/runtime/threat_classifier.js';

function position(x, y = 64, z = 0) {
    return { x, y, z };
}

function snapshotWith({ solid = [], unknown = [] } = {}) {
    const solids = new Set(solid.map(point => point.join(',')));
    const unknowns = new Set(unknown.map(point => point.join(',')));
    return {
        getAbsolute(point) {
            const key = `${point.x},${point.y},${point.z}`;
            if (unknowns.has(key)) return { observed: false };
            return { observed: true, isSolid: solids.has(key) };
        },
    };
}

function botAt(positionValue = position(0)) {
    return {
        entity: { position: positionValue, height: 1.6, id: 12 },
        lastDamageTime: 0,
    };
}

test('hidden unreachable cave hostile is ignored instead of fleeing', async () => {
    const bot = botAt();
    const hostile = { name: 'zombie', position: position(6), height: 1 };
    const threat = await classifyHostileThreat(bot, hostile, snapshotWith({ solid: [[2, 65, 0]] }), {
        reachabilityCheck: async () => false,
    });

    assert.equal(threat.level, 'IGNORE');
    assert.equal(threat.reasonCode, 'hidden_unreachable');
    assert.equal(threat.shouldFlee, false);
});

test('visible, close, and reachable hostiles are avoidable threats', async () => {
    const bot = botAt();
    const visible = await classifyHostileThreat(bot, { name: 'zombie', position: position(6), height: 1 }, snapshotWith(), {
        reachabilityCheck: async () => false,
    });
    const close = await classifyHostileThreat(bot, { name: 'zombie', position: position(2), height: 1 }, snapshotWith(), {
        reachabilityCheck: async () => false,
    });
    const reachable = await classifyHostileThreat(bot, { name: 'zombie', position: position(6), height: 1 }, snapshotWith({ solid: [[2, 65, 0]] }), {
        reachabilityCheck: async () => true,
    });

    assert.equal(visible.reasonCode, 'clear_line_of_sight');
    assert.equal(close.reasonCode, 'very_close');
    assert.equal(reachable.reasonCode, 'reachable_path');
    assert.equal(reachable.eligibleForDefense, true);
});

test('nearby creepers and recent damage escalate even without line of sight', async () => {
    const blocked = snapshotWith({ solid: [[1, 65, 0]] });
    const creeper = await classifyHostileThreat(botAt(), { name: 'creeper', position: position(5), height: 1 }, blocked, {
        reachabilityCheck: async () => false,
    });
    const bot = botAt();
    bot.lastDamageTime = 95;
    const damaged = await classifyHostileThreat(bot, { name: 'zombie', position: position(6), height: 1 }, blocked, {
        now: () => 100,
        reachabilityCheck: async () => false,
    });

    assert.equal(creeper.level, 'EMERGENCY');
    assert.equal(damaged.reasonCode, 'recent_damage');
});

test('combat instincts can refuse engagement while retaining a credible flee threat', async () => {
    const bot = botAt();
    bot.health = 7;
    bot.food = 5;
    const threat = await classifyHostileThreat(bot, { name: 'zombie', position: position(2), height: 1 }, snapshotWith(), {
        instincts: {
            combat: {
                engageHostiles: true,
                fightOnlyWhenHealthy: true,
                minimumHealthToFight: 10,
                minimumFoodToFight: 8,
                fleeBelowHealth: 8,
            },
        },
        reachabilityCheck: async () => false,
    });

    assert.equal(threat.shouldFlee, true);
    assert.equal(threat.eligibleForDefense, false);
    assert.equal(threat.lowHealth, true);
});
