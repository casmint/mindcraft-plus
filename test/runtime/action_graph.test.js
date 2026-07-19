import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionGraphRunner, resolveRuntimeMode } from '../../src/agent/runtime/action_graph.js';

test('direct remains the default runtime mode and graph requests fall back clearly', async () => {
    assert.equal(resolveRuntimeMode(), 'direct');
    const runner = new ActionGraphRunner({}, { mode: 'direct' });

    const result = await runner.run('basicStartup');

    assert.equal(result.status, 'fallback');
    assert.match(result.message, /legacy commands remain active/);
});

test('actiongraph mode runs only registered graphs through the existing ActionManager', async () => {
    const calls = [];
    const agent = {
        actions: {
            async runAction(label, action) {
                calls.push(label);
                await action({ signal: new AbortController().signal });
                return { success: true, message: 'legacy action manager completed' };
            },
        },
    };
    const runner = new ActionGraphRunner(agent, {
        mode: 'actiongraph',
        graphs: {
            basicStartup: async (_agent, context) => ({
                status: context.signal.aborted ? 'cancelled' : 'completed',
                message: 'fixture graph completed',
            }),
        },
    });

    const result = await runner.run('basicStartup');
    const unsupported = await runner.run('notRegistered');

    assert.deepEqual(calls, ['graph:basicStartup']);
    assert.equal(result.status, 'completed');
    assert.equal(unsupported.status, 'unsupported');
});
