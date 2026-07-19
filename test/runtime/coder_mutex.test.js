import assert from 'node:assert/strict';
import test from 'node:test';

import { Coder, sanitizeGeneratedCode, summarizeGeneratedCodeResult } from '../../src/agent/coder.js';
import { COMPACT_CODE_STYLE_RULES, Prompter, addCompactCodeStyle } from '../../src/models/prompter.js';
import { SkillLibrary } from '../../src/agent/library/skill_library.js';

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

test('generated code sanitizer fixes empty catches and simple missing semicolons', () => {
    const code = sanitizeGeneratedCode('javascript\nconst n = 1\nawait skills.wait(bot, n)\ncatch (err) {}');

    assert.match(code, /const n = 1;/);
    assert.match(code, /await skills\.wait\(bot, n\);/);
    assert.match(code, /catch \{ log\(bot, 'Generated action failed\.'\); \}/);
});

test('generated-code history summary excludes source and bounds runtime output', () => {
    const summary = summarizeGeneratedCodeResult('await skills.wait(bot, 1);', 'x'.repeat(1000));

    assert.match(summary, /^Generated code: 1 lines \/ 26 chars\. Result: success\./);
    assert.ok(summary.length < 650);
    assert.doesNotMatch(summary, /await skills/);
});

test('coding prompts receive compact code style rules before dynamic context', () => {
    const prompt = addCompactCodeStyle('Core\n$SELF_PROMPT\n$MEMORY');

    assert.match(COMPACT_CODE_STYLE_RULES, /Write compact lint-safe JavaScript/);
    assert.ok(prompt.indexOf(COMPACT_CODE_STYLE_RULES) < prompt.indexOf('$SELF_PROMPT'));
});

test('generated code with an undocumented skill is rejected before staging or execution', async () => {
    let staged = false;
    const coder = Object.create(Coder.prototype);
    coder.agent = {
        bot: { interrupt_code: false, modes: { pause() {} } },
        prompter: {
            skill_libary: { async getAllSkillDocs() { return []; } },
            async promptCoding() { return { status: 'ok', response: '```await skills.goToPosition(bot, 1, 2, 3);```' }; },
        },
    };
    coder._stageCode = async () => {
        staged = true;
    };

    const result = await coder.generateCode({ getHistory() { return []; } });

    assert.equal(result, 'Generated code failed validation: nonexistent skill skills.goToPosition');
    assert.equal(staged, false);
});

test('generated syntax staging failure returns cleanly without execution', async () => {
    const coder = Object.create(Coder.prototype);
    coder.agent = {
        bot: { interrupt_code: false, modes: { pause() {} } },
        prompter: {
            skill_libary: { async getAllSkillDocs() { return ['skills.wait\ndoc']; } },
            async promptCoding() { return { status: 'ok', response: '```await skills.wait(bot, 1);```' }; },
        },
    };
    coder._stageCode = async () => {
        throw new SyntaxError('Unexpected token ;');
    };

    const result = await coder.generateCode({ getHistory() { return []; } });

    assert.match(result, /^Generated code failed syntax check: Unexpected token/);
});

test('furnace and container tasks prioritize their matching skill docs', async () => {
    const library = new SkillLibrary({}, null);
    await library.initSkillLibrary();

    const docs = await library.getRelevantSkillDocs('smelt raw iron in a furnace, then store it in a chest', 1);

    assert.match(docs, /skills\.smeltItem/);
    assert.match(docs, /skills\.putInChest/);
    assert.match(docs, /skills\.takeFromChest/);
});
