import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanupMotion } from '../../src/agent/runtime/motion_cleanup.js';

test('motion cleanup stops controllers in order and returns a quiescent report', async () => {
    const calls = [];
    const window = { id: 1 };
    const bot = {
        collectBlock: {
            cancelTask() {
                calls.push('collectBlock');
            },
        },
        pvp: {
            target: { id: 2 },
            stop() {
                calls.push('pvp');
                this.target = null;
            },
        },
        pathfinder: {
            goal: { x: 1 },
            setGoal(goal) {
                calls.push('pathfinderGoal');
                this.goal = goal;
            },
            stop() {
                calls.push('pathfinder');
            },
        },
        targetDigBlock: { name: 'stone' },
        stopDigging() {
            calls.push('digging');
            this.targetDigBlock = null;
        },
        deactivateItem() {
            calls.push('itemUse');
        },
        currentWindow: window,
        closeWindow(openWindow) {
            calls.push('window');
            assert.equal(openWindow, window);
            this.currentWindow = null;
        },
        controlState: { forward: true, jump: false },
        clearControlStates() {
            calls.push('controls');
            this.controlState.forward = false;
        },
    };

    const report = await cleanupMotion({ actions: { currentActionLabel: 'action:test' }, bot });

    assert.deepEqual(calls, [
        'collectBlock',
        'pvp',
        'pathfinderGoal',
        'pathfinder',
        'digging',
        'itemUse',
        'window',
        'controls',
    ]);
    assert.deepEqual(report.steps, {
        collectBlock: 'stopped',
        pvp: 'stopped',
        pathfinderGoal: 'stopped',
        pathfinder: 'stopped',
        digging: 'stopped',
        itemUse: 'stopped',
        window: 'stopped',
        controls: 'stopped',
    });
    assert.equal(report.actionLabel, 'action:test');
    assert.equal(report.quiescent, true);
});

test('motion cleanup records a failed subsystem and continues with later cleanup', async () => {
    const calls = [];
    const bot = {
        pvp: {
            target: null,
            stop() {
                calls.push('pvp');
                throw new Error('pvp stop failed');
            },
        },
        clearControlStates() {
            calls.push('controls');
        },
    };

    const report = await cleanupMotion({ bot });

    assert.equal(report.steps.pvp, 'failed');
    assert.deepEqual(report.errors, [{ step: 'pvp', message: 'pvp stop failed' }]);
    assert.deepEqual(calls, ['pvp', 'controls']);
    assert.equal(report.quiescent, false);
});
