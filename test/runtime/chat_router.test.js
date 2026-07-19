import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChat, quickChatReply, resolveChatConfig, routePlayerChat } from '../../src/agent/chat_router.js';

test('chat router classifies casual, instruction, urgent, and task-update messages', () => {
    assert.equal(classifyChat('lol').category, 'casual_chat');
    assert.equal(classifyChat('what are you doing?').category, 'question');
    assert.equal(classifyChat('mine that iron').category, 'instruction');
    assert.equal(classifyChat('stop').category, 'urgent_interrupt');
    assert.equal(classifyChat('continue your goal of full diamond armor').category, 'task_update');
});

test('embedded operational requests outrank casual wording and questions', () => {
    for (const message of [
        'as you continue on your goal, build a 3-wide stair tunnel',
        'while mining, place torches on the right',
        'before diamonds, get more food',
        "don't go into caves yet",
        'keep doing your goal but avoid lava',
        'next make a shield',
        'hey lol, mine that coal',
        'can you come here?',
        'nice, follow me',
    ]) assert.equal(classifyChat(message).category, 'instruction', message);
});

test('warnings and reminders never take the casual-chat path', () => {
    assert.equal(classifyChat('your items are gonna despawn').category, 'urgent_interrupt');
    assert.equal(classifyChat('stop, your items are gonna despawn').category, 'urgent_interrupt');
    assert.equal(classifyChat("don't forget to build the tunnel system").category, 'instruction');
    assert.equal(classifyChat('go back for your pile').category, 'instruction');
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

test('quick chat uses a tiny model call and rejects command-like output', async () => {
    const agent = {
        actions: { currentActionLabel: 'action:mine' },
        prompter: { chat_model: { sendRequest: async () => 'heyy !collectBlocks("iron", 1)' } },
    };
    assert.equal(await quickChatReply(agent, 'haii :3', { quickChatUsesLLM: true, maxQuickChatChars: 120 }), null);
});

test('quick chat status and failure fallbacks are context-aware rather than yeah', async () => {
    const agent = { actions: { currentActionLabel: 'action:collectBlocks' }, prompter: { chat_model: { sendRequest: async () => { throw new Error('offline'); } } } };
    assert.match(await quickChatReply(agent, 'what are you doing?', { quickChatUsesLLM: true }), /working on collect blocks/);
    assert.equal(await quickChatReply(agent, 'w?', { quickChatUsesLLM: true }), "what's up?");
    assert.equal(await quickChatReply(agent, 'bro', { quickChatUsesLLM: true }), 'i know, that was bad lol');
});
