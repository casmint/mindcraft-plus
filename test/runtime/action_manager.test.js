import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionManager } from '../../src/agent/action_manager.js';
import { createFakeAgent, deferred } from '../helpers/fake_agent.js';

function createHarness(options) {
    const agent = createFakeAgent(options);
    const manager = new ActionManager(agent);
    agent.actions = manager;
    return { agent, manager };
}

test('ordinary completion reports success and emits idle', async () => {
    const { agent, manager } = createHarness();
    agent.bot.output = 'ignored because action start clears prior output';

    const result = await manager.runAction('action:test', async () => {
        agent.bot.output = 'collected one log';
    }, { timeout: -1 });

    assert.deepEqual(result, {
        success: true,
        message: 'Action output:\ncollected one log',
        interrupted: false,
        timedout: false,
    });
    assert.equal(manager.executing, false);
    assert.equal(manager.currentActionLabel, '');
    assert.equal(manager.currentActionFn, null);
    assert.equal(agent.calls.idle, 1);
});

test('a new action interrupts the active action before it starts', async () => {
    const firstAction = deferred();
    const { agent, manager } = createHarness({
        onInterrupt() {
            firstAction.resolve();
        },
    });

    let firstContext;
    const firstResultPromise = manager.runAction('action:first', async (context) => {
        firstContext = context;
        await firstAction.promise;
    }, { timeout: -1 });

    await Promise.resolve();
    const secondResultPromise = manager.runAction('action:second', async () => {}, {
        timeout: -1,
    });

    const [firstResult, secondResult] = await Promise.all([
        firstResultPromise,
        secondResultPromise,
    ]);

    assert.equal(agent.calls.interrupts, 1);
    assert.equal(firstResult.success, true);
    assert.equal(firstResult.interrupted, true);
    assert.equal(secondResult.success, true);
    assert.equal(secondResult.interrupted, false);
    assert.equal(agent.calls.idle, 1);
    assert.equal(firstContext.id, 'action-1');
    assert.equal(firstContext.generation, 1);
    assert.equal(firstContext.signal.aborted, true);
    assert.equal(firstContext.cancelReason, 'replaced');
});

test('duplicate active label is rejected without interrupting the active action', async () => {
    const firstAction = deferred();
    const { agent, manager } = createHarness({
        onInterrupt() {
            firstAction.resolve();
        },
    });
    let executions = 0;

    const firstResultPromise = manager.runAction('action:newAction', async () => {
        executions++;
        await firstAction.promise;
    }, { timeout: -1 });

    await Promise.resolve();
    const secondResult = await manager.runAction('action:newAction', async () => {
        executions++;
    }, { timeout: -1 });

    firstAction.resolve();
    const firstResult = await firstResultPromise;

    assert.equal(executions, 1);
    assert.equal(agent.calls.interrupts, 0);
    assert.equal(firstResult.success, true);
    assert.equal(firstResult.interrupted, false);
    assert.deepEqual(secondResult, {
        success: false,
        message: 'Action rejected: duplicate active label "action:newAction".',
        interrupted: false,
        timedout: false,
    });
});

test('timeout state is reset for the next action result', async () => {
    const timedAction = deferred();
    const { agent, manager } = createHarness({
        onInterrupt() {
            timedAction.resolve();
        },
    });

    const timedResult = await manager.runAction('action:slow', async () => {
        await timedAction.promise;
    }, { timeout: 0.0005 });

    assert.equal(timedResult.success, true);
    assert.equal(timedResult.interrupted, true);
    assert.equal(timedResult.timedout, true);
    assert.equal(agent.calls.history.length, 1);

    const nextResult = await manager.runAction('action:next', async () => {}, {
        timeout: -1,
    });

    assert.equal(nextResult.success, true);
    assert.equal(nextResult.interrupted, false);
    assert.equal(nextResult.timedout, false);
});

test('thrown action preserves its stack and cleans up before clearing state', async () => {
    const { agent, manager } = createHarness();

    const result = await manager.runAction('action:throws', async () => {
        agent.bot.output = 'before failure';
        throw new Error('fixture failure');
    }, { timeout: -1 });

    assert.equal(result.success, false);
    assert.equal(result.interrupted, true);
    assert.match(result.message, /Error: Error: fixture failure/);
    assert.match(result.message, /Stack trace:\nError: fixture failure/);
    assert.equal(manager.executing, false);
    assert.equal(agent.calls.interrupts, 1);
    assert.equal(agent.calls.idle, 0);
});

test('GoalChanged is an expected cancellation rather than a code exception', async () => {
    const { agent, manager } = createHarness();
    const error = new Error('The goal was changed before it could be completed');
    error.name = 'GoalChanged';

    const result = await manager.runAction('mode:item_collecting', async () => {
        throw error;
    }, { timeout: -1 });

    assert.equal(result.interrupted, true);
    assert.equal(result.success, false);
    assert.match(result.message, /expected_goal_changed/);
    assert.doesNotMatch(result.message, /!!Code threw exception!!/);
    assert.equal(agent.calls.interrupts, 1);
});

test('GoalChanged from interrupted unstuck is also an expected cancellation', async () => {
    const { manager } = createHarness();
    const result = await manager.runAction('mode:unstuck', async () => {
        throw { name: 'GoalChanged', message: 'GoalChanged' };
    }, { timeout: -1 });

    assert.equal(result.interrupted, true);
    assert.match(result.message, /expected_goal_changed/);
    assert.doesNotMatch(result.message, /!!Code threw exception!!/);
});

test('empty resume request is a no-op', async () => {
    const { manager } = createHarness();

    const result = await manager.resumeAction();

    assert.deepEqual(result, {
        success: false,
        message: null,
        interrupted: false,
        timedout: false,
    });
});

test('registering a resumable action executes through the normal lifecycle', async () => {
    const { manager } = createHarness();

    const result = await manager.runAction('action:resume', async () => {}, {
        resume: true,
        timeout: -1,
    });

    assert.equal(result.success, true);
});

test('non-cooperative action is quarantined and cannot admit a successor', async () => {
    const { agent, manager } = createHarness();
    let context;

    void manager.runAction('action:stuck', async (actionContext) => {
        context = actionContext;
        await new Promise(() => {});
    }, { timeout: -1 });

    await Promise.resolve();
    const stopped = await manager.stop({ timeoutMs: 0 });

    assert.equal(stopped, false);
    assert.equal(manager.actionState, 'quarantined');
    assert.equal(manager.executing, true);
    assert.equal(context.signal.aborted, true);
    assert.equal(context.cancelReason, 'interrupted');
    assert.equal(agent.calls.cleanKill.length, 0);

    const successor = await manager.runAction('action:next', async () => {}, { timeout: -1 });
    assert.deepEqual(successor, {
        success: false,
        message: 'Action runtime quarantined after action "action:stuck" did not quiesce.',
        interrupted: true,
        timedout: false,
    });
});

test('a failed cleanup report quarantines an action even after its promise settles', async () => {
    const action = deferred();
    const { manager } = createHarness({
        interruptReport: { quiescent: false },
        onInterrupt() {
            action.resolve();
        },
    });

    const resultPromise = manager.runAction('action:cleanupFailure', async () => {
        await action.promise;
    }, { timeout: -1 });

    await Promise.resolve();
    const stopped = await manager.stop({ timeoutMs: 100 });
    const result = await resultPromise;

    assert.equal(stopped, false);
    assert.equal(manager.actionState, 'quarantined');
    assert.equal(result.success, false);
    assert.match(result.message, /Action runtime quarantined/);
});
