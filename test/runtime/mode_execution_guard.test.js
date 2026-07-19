import assert from 'node:assert/strict';
import test from 'node:test';

import { ModeExecutionGuard } from '../../src/agent/runtime/mode_execution_guard.js';

test('mode guard admits a first mode run and enforces its cooldown afterward', () => {
    let now = 0;
    const guard = new ModeExecutionGuard({ now: () => now });

    assert.equal(guard.canRunMode('cowardice').allowed, true);
    guard.beginMode('cowardice');
    assert.deepEqual(guard.canRunMode('cowardice'), {
        allowed: false,
        reasonCode: 'cooldown cowardice',
    });

    now += 8_000;
    assert.equal(guard.canRunMode('cowardice').allowed, true);
});

test('mode guard suppresses repeated cowardice results without suppressing emergencies', () => {
    let now = 0;
    const guard = new ModeExecutionGuard({ now: () => now });

    for (let i = 0; i < 3; i++) {
        guard.beginMode('cowardice');
        const result = guard.finishMode('cowardice', 'Action output: Moved 16 away from enemies.');
        now += 8_000;
        if (i === 2) assert.equal(result.suppressed, true);
    }

    assert.match(guard.canRunMode('cowardice').reasonCode, /^repeated_result/);
    assert.equal(guard.canRunMode('self_preservation', { emergency: true }).allowed, true);
});

test('cleanup blocks non-emergency modes but admits emergency self preservation', () => {
    const guard = new ModeExecutionGuard();
    guard.cleanupInProgress = true;

    assert.equal(guard.canRunMode('unstuck').reasonCode, 'cleanup_in_progress');
    assert.equal(guard.canRunMode('self_preservation', { emergency: true }).allowed, true);
});

test('self preservation fuses repeated results for the same hazard signature', () => {
    let now = 0;
    const guard = new ModeExecutionGuard({ now: () => now });

    for (let i = 0; i < 3; i++) {
        guard.beginMode('self_preservation');
        guard.finishMode('self_preservation', 'Action output: no_single_source', 'water:71,63,-70:head_air');
        now += 4_000;
    }

    assert.match(guard.canRunMode('self_preservation').reasonCode, /^repeated_result/);
});

test('interrupt fuse rejects a fourth non-emergency interrupt in five seconds', () => {
    const guard = new ModeExecutionGuard();
    assert.equal(guard.recordInterrupt().allowed, true);
    assert.equal(guard.recordInterrupt().allowed, true);
    assert.equal(guard.recordInterrupt().allowed, true);
    assert.equal(guard.recordInterrupt().reasonCode, 'interrupt_spam');
});

test('physical action fuse soft-quarantines and expires', () => {
    let now = 0;
    const guard = new ModeExecutionGuard({ now: () => now });

    for (let i = 0; i < 6; i++) assert.equal(guard.recordPhysicalAction(`move:${i}`).allowed, true);
    assert.equal(guard.recordPhysicalAction('move:limit').reasonCode, 'physical_action_spam');
    assert.equal(guard.isQuarantined(), true);

    now += 15_000;
    assert.equal(guard.isQuarantined(), false);
});

test('physical actions with the same label are briefly deduplicated', () => {
    const guard = new ModeExecutionGuard();
    assert.equal(guard.recordPhysicalAction('dig:diamond_ore').allowed, true);
    assert.equal(guard.recordPhysicalAction('dig:diamond_ore').deduped, true);
    assert.equal(guard.physicalRuns.length, 1);
});

test('an emergency action can pass a soft fuse once, but not every tick', () => {
    let now = 0;
    const guard = new ModeExecutionGuard({ now: () => now });
    guard.enterSoftQuarantine('physical_action_spam', 15_000);

    assert.equal(guard.recordPhysicalAction('emergency_exit', { emergency: true }).allowed, true);
    assert.equal(guard.recordPhysicalAction('emergency_exit', { emergency: true }).reasonCode, 'emergency_action_cooldown');
    now += 2_500;
    assert.equal(guard.recordPhysicalAction('emergency_exit', { emergency: true }).allowed, true);
});

test('self prompt restart fuse pauses after two restarts in thirty seconds', () => {
    const guard = new ModeExecutionGuard();
    assert.equal(guard.recordSelfPromptRestart().allowed, true);
    assert.equal(guard.recordSelfPromptRestart().allowed, true);
    assert.equal(guard.recordSelfPromptRestart().reasonCode, 'self_prompt_restart_spam');
});

test('hard quarantine remains active until explicitly cleared', () => {
    const guard = new ModeExecutionGuard();
    guard.enterQuarantine('cleanup_not_quiescent');

    assert.equal(guard.isQuarantined(), true);
    guard.clearQuarantine();
    assert.equal(guard.isQuarantined(), false);
});
