import assert from 'node:assert/strict';
import test from 'node:test';
import minecraftData from 'minecraft-data';

import { avoidEnemies, defendSelf } from '../../src/agent/library/skills.js';

function position(x, y = 64, z = 0) {
    return {
        x,
        y,
        z,
        distanceTo(other) {
            return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
        },
    };
}

function createModes() {
    return {
        paused: [],
        pause(name) {
            this.paused.push(name);
        },
    };
}

test('cowardice flee loop never attacks or starts PVP', async () => {
    const enemy = { name: 'zombie', position: position(2), type: 'mob' };
    let scans = 0;
    const calls = [];
    const bot = {
        entity: { position: position(0) },
        interrupt_code: false,
        modes: createModes(),
        output: '',
        registry: minecraftData('1.20.4'),
        nearestEntity(predicate) {
            scans++;
            return scans === 1 && predicate(enemy) ? enemy : null;
        },
        pathfinder: {
            setMovements() {
                calls.push('setMovements');
            },
            setGoal() {
                calls.push('setGoal');
            },
            stop() {
                calls.push('stop');
            },
        },
        pvp: {
            attack() {
                calls.push('pvp.attack');
            },
        },
        attack() {
            calls.push('attack');
        },
    };

    const result = await avoidEnemies(bot, 8, { pollMs: 0 });

    assert.equal(result, true);
    assert.deepEqual(calls, ['setMovements', 'setGoal', 'stop']);
    assert.deepEqual(bot.modes.paused, ['self_preservation']);
});

test('close defense attacks only an already-close hostile without pathfinding or PVP pursuit', async () => {
    const enemy = { name: 'zombie', position: position(2), type: 'mob' };
    let visible = true;
    const calls = [];
    const bot = {
        entity: { position: position(0) },
        health: 20,
        interrupt_code: false,
        modes: createModes(),
        output: '',
        inventory: { items: () => [] },
        nearestEntity(predicate) {
            return visible && predicate(enemy) ? enemy : null;
        },
        attack: async () => {
            calls.push('attack');
            visible = false;
        },
        pathfinder: {
            goto() {
                calls.push('pathfinder.goto');
            },
            setGoal() {
                calls.push('pathfinder.setGoal');
            },
        },
        pvp: {
            attack() {
                calls.push('pvp.attack');
            },
            stop() {
                calls.push('pvp.stop');
            },
        },
    };

    const result = await defendSelf(bot, 8, { attackIntervalMs: 0, durationMs: 100 });

    assert.equal(result, true);
    assert.deepEqual(calls, ['attack', 'pvp.stop']);
    assert.deepEqual(bot.modes.paused, ['self_defense', 'cowardice']);
});

test('close defense refuses a distant hostile instead of chasing', async () => {
    const enemy = { name: 'zombie', position: position(6), type: 'mob' };
    const calls = [];
    const bot = {
        entity: { position: position(0) },
        health: 20,
        interrupt_code: false,
        modes: createModes(),
        output: '',
        inventory: { items: () => [] },
        nearestEntity(predicate) {
            return predicate(enemy) ? enemy : null;
        },
        attack() {
            calls.push('attack');
        },
        pathfinder: {
            goto() {
                calls.push('pathfinder.goto');
            },
        },
        pvp: {
            attack() {
                calls.push('pvp.attack');
            },
            stop() {
                calls.push('pvp.stop');
            },
        },
    };

    const result = await defendSelf(bot, 8, { durationMs: 100 });

    assert.equal(result, false);
    assert.deepEqual(calls, ['pvp.stop']);
    assert.match(bot.output, /Holding position/);
});
