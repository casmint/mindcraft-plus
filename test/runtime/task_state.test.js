import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { DurableTaskState, durableGoalFromMessage } from '../../src/agent/task_state.js';

test('active task survives reload even when memory is empty', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-task-state-'));
    try {
        let now = 100;
        const store = new DurableTaskState('Surfski', { root, now: () => now });
        const saved = store.setActive('obtain full diamond armor and tools', { sourcePlayer: 'player' });
        now = 200;
        const reloaded = new DurableTaskState('Surfski', { root, now: () => now }).load();

        assert.equal(reloaded.activeGoal, saved.activeGoal);
        assert.equal(reloaded.status, 'active');
        assert.equal(reloaded.sourcePlayer, 'player');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('completed durable tasks are not resumed', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-task-state-'));
    try {
        const store = new DurableTaskState('Surfski', { root });
        const active = store.setActive('mine diamonds');
        store.complete(active);

        assert.equal(store.load(), null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('durable player goal language is saved without relying on memory', () => {
    assert.equal(
        durableGoalFromMessage('continue your goal of obtaining a full set of diamond armor and tools'),
        'Obtain a full set of diamond armor and tools',
    );
    assert.equal(durableGoalFromMessage('hello there'), null);
});
