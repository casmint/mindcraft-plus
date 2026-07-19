import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChat, resolveChatConfig, routePlayerChat } from '../../src/agent/chat_router.js';

test('chat router classifies casual, instruction, urgent, and task-update messages', () => {
    assert.equal(classifyChat('lol').category, 'casual_chat');
    assert.equal(classifyChat('what are you doing?').category, 'question');
    assert.equal(classifyChat('mine that iron').category, 'instruction');
    assert.equal(classifyChat('stop').category, 'urgent_interrupt');
    assert.equal(classifyChat('continue your goal of full diamond armor').category, 'task_update');
});

test('casual chat replies without interrupting or changing the durable task', async () => {
    const calls = { chat: 0, interrupt: 0, task: 0 };
    const agent = {
        instincts: { chat: {} },
        profile: { chat: { enableQuickChat: true } },
        actions: { currentActionLabel: 'action:collectBlocks', stop: async () => { calls.interrupt++; } },
        durableTask: { activeGoal: 'Mine diamonds' },
        self_prompter: {},
        bot: { entity: { position: { x: 1, y: 64, z: 2 } } },
        async openChat() { calls.chat++; },
        setDurableGoal() { calls.task++; },
    };

    const result = await routePlayerChat(agent, 'Player', 'lol');
    assert.equal(result.handled, true);
    assert.equal(calls.chat, 1);
    assert.equal(calls.interrupt, 0);
    assert.equal(calls.task, 0);
});

test('task update persists through the agent durable-goal method', async () => {
    let planned = false;
    const agent = {
        instincts: { chat: {} },
        profile: { chat: { enableQuickChat: true } },
        actions: {},
        self_prompter: {},
        async openChat() {},
    };

    const result = await routePlayerChat(agent, 'Player', 'continue your goal of full diamond armor');
    planned = !result.handled && result.category === 'task_update';
    assert.equal(planned, true);
});

test('quick chat disabled preserves the legacy message path', async () => {
    let replied = false;
    const agent = {
        instincts: { chat: {} },
        profile: { chat: { enableQuickChat: false } },
        async openChat() { replied = true; },
    };

    const result = await routePlayerChat(agent, 'Player', 'lol');
    assert.equal(result.handled, false);
    assert.equal(result.category, 'legacy');
    assert.equal(replied, false);
});

test('profile chat enablement overrides the default-disabled global setting', () => {
    assert.equal(resolveChatConfig({ instincts: { chat: {} }, profile: { chat: { enableQuickChat: true } } }).enableQuickChat, true);
    assert.equal(resolveChatConfig({ instincts: { chat: {} }, profile: { chat: { enableQuickChat: false } } }).enableQuickChat, false);
});
