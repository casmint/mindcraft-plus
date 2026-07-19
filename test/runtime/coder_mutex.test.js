import assert from 'node:assert/strict';
import test from 'node:test';

import { Coder } from '../../src/agent/coder.js';
import { Prompter } from '../../src/models/prompter.js';

function createPrompterHarness(sendRequest) {
    const prompter = Object.create(Prompter.prototype);
    prompter.awaiting_coding = false;
    prompter.profile = { coding: 'coding prompt' };
    prompter.coding_examples = null;
    prompter.code_model = { sendRequest };
    prompter.checkCooldown = async () => {};
    prompter.replaceStrings = async (prompt) => prompt;
    prompter._saveLog = async () => {};
    return prompter;
}

test('coding mutex returns a typed busy result without calling the provider', async () => {
    let providerCalls = 0;
    const prompter = createPrompterHarness(async () => {
        providerCalls++;
        return '```await skills.wait(bot, 1);```';
    });
    prompter.awaiting_coding = true;

    const result = await prompter.promptCoding([]);

    assert.deepEqual(result, {
        status: 'busy',
        message: 'Coding request already in progress.',
    });
    assert.equal(providerCalls, 0);
});

test('coding mutex is released after a failed provider request', async () => {
    const prompter = createPrompterHarness(async () => {
        throw new Error('provider unavailable');
    });

    const failed = await prompter.promptCoding([]);

    assert.deepEqual(failed, {
        status: 'error',
        message: 'provider unavailable',
    });
    assert.equal(prompter.awaiting_coding, false);

    prompter.code_model.sendRequest = async () => '```await skills.wait(bot, 1);```';
    const recovered = await prompter.promptCoding([]);

    assert.deepEqual(recovered, {
        status: 'ok',
        response: '```await skills.wait(bot, 1);```',
    });
    assert.equal(prompter.awaiting_coding, false);
});

test('coder returns busy without staging a synthetic program', async () => {
    let staged = false;
    const coder = Object.create(Coder.prototype);
    coder.agent = {
        bot: {
            interrupt_code: false,
            modes: { pause() {} },
        },
        prompter: {
            async promptCoding() {
                return { status: 'busy', message: 'Coding request already in progress.' };
            },
        },
    };
    coder._stageCode = async () => {
        staged = true;
    };

    const result = await coder.generateCode({
        getHistory() {
            return [];
        },
    });

    assert.equal(result, 'Code generation unavailable: coding request already in progress.');
    assert.equal(staged, false);
});
