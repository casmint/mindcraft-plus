const URGENT = /^(?:stop|wait|don't move|do not move|freeze|run|creeper|lava|help|come back|get out)\b/i;
const TASK_UPDATE = /\b(?:your goal is|new goal|continue (?:your )?goal|forget (?:that |your )?goal|pause (?:the )?goal|resume (?:the )?goal)\b/i;
const INSTRUCTION = /^(?:please\s+)?(?:mine|craft|come|follow|go|build|attack|run away|get|gather|collect|sleep|continue|make|find|bring|kill|move)\b/i;
const QUESTION = /\?|\b(?:what are you doing|where are you|are you okay|how(?:'s| is) it going|how much health)\b/i;
const CASUAL = /^(?:hi|hello|hey|lol|lmao|nice|thanks|thank you|good job|gg|yo|sup|howdy)(?:\W|$)/i;

export function classifyChat(message) {
    const text = String(message || '').trim();
    if (!text) return { category: 'unknown', text };
    if (URGENT.test(text)) return { category: 'urgent_interrupt', text };
    if (TASK_UPDATE.test(text)) return { category: 'task_update', text };
    if (INSTRUCTION.test(text)) return { category: 'instruction', text };
    if (QUESTION.test(text)) return { category: 'question', text };
    if (CASUAL.test(text)) return { category: 'casual_chat', text };
    return { category: 'casual_chat', text };
}

function short(text, maxChars) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

export function quickReply(agent, message, maxChars = 120) {
    const text = String(message || '').toLowerCase();
    if (/what are you doing/.test(text)) {
        return short(agent.actions?.currentActionLabel
            ? `working on ${agent.actions.currentActionLabel.replace(/^action:|^mode:/, '')} rn`
            : agent.durableTask?.activeGoal ? `working on ${agent.durableTask.activeGoal.toLowerCase()}` : 'waiting for the next thing', maxChars);
    }
    if (/where are you/.test(text)) {
        const p = agent.bot?.entity?.position;
        return p ? `at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}` : 'not sure yet';
    }
    if (/health/.test(text)) return typeof agent.bot?.health === 'number' ? `health is ${Math.round(agent.bot.health)}` : 'health looks okay';
    if (/are you okay|how(?:'s| is) it going/.test(text)) return 'yeah im good';
    if (/thanks|thank you/.test(text)) return 'np';
    if (/good job|nice|gg/.test(text)) return 'ty';
    if (/lol|lmao/.test(text)) return 'lol';
    if (/hi|hello|hey|yo|sup|howdy/.test(text)) return 'hey';
    return 'yeah';
}

export function resolveChatConfig(agent) {
    const profileChat = agent.prompter?.profile?.chat || agent.profile?.chat || {};
    return {
        ...(agent.instincts?.chat || {}),
        ...(settings.chat || {}),
        ...profileChat,
        enableQuickChat: agent.runtimeSettings?.data.chatlayer ?? profileChat.enableQuickChat ?? settings.chat?.enableQuickChat ?? false,
    };
}

export async function routePlayerChat(agent, source, message) {
    const chat = resolveChatConfig(agent);
    if (chat.enableQuickChat !== true || chat.classifyBeforePlanning === false) {
        console.log('chat_router disabled: legacy message path');
        return { handled: false, category: 'legacy' };
    }
    const classified = classifyChat(message);
    console.log(`chat_router enabled: ${classified.category}`);
    const maxChars = chat.maxCasualReplyChars ?? 120;

    if (classified.category === 'casual_chat' || classified.category === 'question') {
        const reply = quickReply(agent, classified.text, maxChars);
        await agent.openChat(reply);
        console.log('casual chat replied without action interrupt');
        return { handled: true, category: classified.category };
    }
    // Instructions, task updates, and urgent messages deliberately retain the
    // legacy scheduler/planning path. Only safe conversational messages exit early.
    return { handled: false, category: classified.category };
}
import settings from '../../settings.js';
