import assert from 'node:assert/strict';
import test from 'node:test';

import { exitWater, findNearestWaterExit, verifyOnSolidGround } from '../../src/agent/runtime/exit_water.js';
import { SwimController } from '../../src/agent/runtime/swim_controller.js';
import { WaterDetector } from '../../src/agent/runtime/water_detector.js';

function waterCell(position) {
    return { observed: true, name: 'water', position };
}

test('water detector classifies submerged, drowning, and stagnant water deterministically', () => {
    let now = 0;
    const detector = new WaterDetector({ now: () => now, stagnantMs: 100, drowningOxygen: 4 });
    const bot = {
        entity: { position: { x: 0, y: 64, z: 0 }, velocity: { y: -0.1 }, isInWater: true },
        oxygenLevel: 3,
    };
    const snapshot = {
        id: 1,
        getAbsolute(position) {
            return waterCell(position);
        },
        detectHazards: () => [],
    };

    const drowning = detector.observe(bot, snapshot);
    now = 101;
    bot.oxygenLevel = 10;
    bot.entity.velocity.y = 0;
    const surfaceSnapshot = {
        ...snapshot,
        getAbsolute(position) {
            return position.y === 64 ? waterCell(position) : { observed: true, name: 'air', position };
        },
    };
    const stuck = detector.observe(bot, surfaceSnapshot);

    assert.equal(drowning.state, 'drowning_risk');
    assert.equal(drowning.requiresRecovery, true);
    assert.equal(stuck.state, 'trapped_water');
});

test('swim controller surfaces with bounded jump control and clears owned controls', async () => {
    let now = 0;
    let underwater = true;
    const controls = [];
    const bot = { setControlState: (name, active) => controls.push([name, active]) };
    const controller = new SwimController(bot, {
        sleep: async () => {
            now += 10;
            underwater = false;
        },
    });

    const result = await controller.surface({
        now: () => now,
        timeoutMs: 30,
        pollMs: 10,
        observe: () => ({ headUnderwater: underwater }),
    });
    controller.clear();

    assert.equal(result.status, 'surfaced');
    assert.deepEqual(controls, [['jump', true], ['forward', false], ['jump', false]]);
});

test('exit selection rejects lava-adjacent candidates and grounding is evidence-based', () => {
    const bot = { entity: { position: { x: 0, y: 64, z: 0 }, isInWater: true, velocity: { y: 0 } } };
    const snapshot = {
        id: 7,
        options: { radius: 8 },
        findStandablePositions: () => [
            { x: 1, y: 64, z: 0 },
            { x: 3, y: 64, z: 0 },
        ],
        findAll: () => [{ name: 'lava', position: { x: 1, y: 64, z: 1 } }],
        getAbsolute: () => ({ observed: true, name: 'air' }),
        evaluateStandable: () => ({ standable: true, reasonCode: 'standable' }),
    };

    assert.deepEqual(findNearestWaterExit(bot, snapshot), { x: 3, y: 64, z: 0 });
    bot.entity.isInWater = false;
    assert.equal(verifyOnSolidGround(bot, snapshot).grounded, true);
});

test('exitWater verifies solid ground before success and clears water controls', async () => {
    const controls = [];
    const bot = {
        entity: { position: { x: 0, y: 64, z: 0 }, velocity: { y: 0 }, isInWater: true },
        setControlState: (name, active) => controls.push([name, active]),
        lookAt: async () => {},
    };
    const snapshot = {
        id: 9,
        options: { radius: 8 },
        getAbsolute: () => ({ observed: true, name: 'air' }),
        detectHazards: () => [],
        findAll: () => [],
        findStandablePositions: () => [{ x: 2, y: 64, z: 0 }],
        evaluateStandable: () => ({ standable: true, reasonCode: 'standable' }),
    };
    const localMap = { getSnapshot: () => snapshot };
    const detector = { observe: () => ({ inWater: bot.entity.isInWater, headUnderwater: false, sinking: false, drowningRisk: false }) };
    const controller = new SwimController(bot, {
        sleep: async () => {
            bot.entity.position = { x: 2, y: 64, z: 0 };
            bot.entity.isInWater = false;
        },
    });

    const result = await exitWater(bot, { detector, localMap, controller, exitTimeoutMs: 1_000 });

    assert.equal(result.status, 'completed');
    assert.equal(result.reasonCode, 'water_exit_verified');
    assert.deepEqual(controls, [['jump', true], ['forward', true], ['jump', false], ['forward', false]]);
});
