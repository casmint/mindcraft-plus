const URGENT = /(?:^|\b)(?:stop|wait|don't move|do not move|freeze|run|help|come back|get out|items? (?:are )?(?:gonna )?despawn|despawn(?:ing)?)\b/i;
const IMMEDIATE_HAZARD = /\b(?:creeper|lava)\b/i;
const TASK_UPDATE = /\b(?:your goal is|new goal|continue (?:your )?goal|forget (?:that |your )?goal|pause (?:the )?goal|resume (?:the )?goal)\b/i;
// Imperatives can occur after greetings or goal context. Match operational verbs
// anywhere so "hey, while mining place torches" cannot take the casual path.
const INSTRUCTION = /\b(?:mine|craft|come|follow|go|build|attack|run away|get|gather|collect|sleep|continue|make|find|bring|kill|move|place|avoid|keep|use|equip|return)\b/i;
const OPERATIONAL_CONSTRAINT = /\b(?:before|while|don't|do not|never|next)\b.{0,80}\b(?:mine|craft|go|build|attack|get|gather|collect|place|avoid|food|lava|cave|shield|torch|tunnel)\b/i;
const QUESTION = /\?|\b(?:what are you doing|where are you|are you okay|how(?:'s| is) it going|how much health)\b/i;
const CASUAL = /^(?:hi|hello|hey|lol|lmao|nice|thanks|thank you|good job|gg|yo|sup|howdy)(?:\W|$)/i;
const fallbackCounters = new WeakMap();

export function classifyChat(message) {
    const text = String(message || '').trim();
    if (!text) return { category: 'unknown', text };
    if (URGENT.test(text)) return { category: 'urgent_interrupt', text };
    if (TASK_UPDATE.test(text)) return { category: 'task_update', text };
    if (INSTRUCTION.test(text) || OPERATIONAL_CONSTRAINT.test(text)) return { category: 'instruction', text };
    if (IMMEDIATE_HAZARD.test(text)) return { category: 'urgent_interrupt', text };
    if (QUESTION.test(text)) return { category: 'question', text };
    if (CASUAL.test(text)) return { category: 'casual_chat', text };
    return { category: 'casual_chat', text };
}

function short(text, maxChars) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function rotatedFallback(agent, key, choices) {
    if (!agent || typeof agent !== 'object') return choices[0];
    const counters = fallbackCounters.get(agent) || {};
    const index = counters[key] || 0;
    counters[key] = index + 1;
    fallbackCounters.set(agent, counters);
    return choices[index % choices.length];
}

function fallbackReply(message, agent, maxChars) {
    const text = String(message || '').toLowerCase();
    if (/what are you doing/.test(text)) {
        const activity = agent.actions?.currentActionLabel?.replace(/^action:|^mode:/, '') || agent.durableTask?.activeGoal;
        return short(activity ? `working on ${activity.replace(/([A-Z])/g, ' $1').toLowerCase()}` : "not sure, checking my state", maxChars);
    }
    if (/^(?:w\?|what\?)$/.test(text.trim())) return rotatedFallback(agent, 'what', ["what's up?", 'what happened?', 'what is it?']);
    if (/\bbro\b/.test(text)) return rotatedFallback(agent, 'bro', ['i know, that was bad lol', 'yeah, that was rough lol']);
    if (/hai|hello|hey/.test(text)) return rotatedFallback(agent, 'greeting', ['hey :3', 'heyy', 'yo :3']);
    if (/thanks|thank you/.test(text)) return 'np';
    if (/good job|nice|gg/.test(text)) return 'ty :3';
    if (/lol|lmao/.test(text)) return rotatedFallback(agent, 'lol', ['lol fair', 'real lol']);
    return rotatedFallback(agent, 'unknown', ["what's up?", 'im listening']);
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
    return fallbackReply(message, agent, maxChars);
}

function sanitizeQuickReply(reply, maxChars) {
    const text = String(reply || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > maxChars || /!\w+/.test(text)) return null;
    if (/^(?:yeah|yep|sure|ok)$/i.test(text)) return null;
    if (/working on (?:hey|lol|bro|what)\b/i.test(text)) return null;
    if (/\b(?:i(?:'ll| will)|on it|going to)\b/i.test(text)) return null;
    return text;
}

export async function quickChatReply(agent, message, chat) {
    const maxChars = chat.maxQuickChatChars ?? chat.maxCasualReplyChars ?? 120;
    if (/what are you doing/i.test(message)) return fallbackReply(message, agent, maxChars);
    if (chat.quickChatUsesLLM === false || !agent.prompter?.chat_model?.sendRequest) {
        return fallbackReply(message, agent, maxChars);
    }
    const activity = agent.actions?.currentActionLabel || 'unknown';
    const prompt = `You are Surfski, a casual Minecraft bot. Reply to this player in <=${maxChars} characters. Do not respond like an old chatbot. Do not use generic canned replies. Use the current message and known state. If the user gives a warning or instruction, do not treat it as casual chat. Be short, varied, friendly, and lowercase okay. No commands, tools, plans, promises, or exclamation-command syntax. Coarse activity: ${activity}. Player: ${message}`;
    const timeoutMs = chat.quickChatTimeoutMs ?? 5_000;
    let timeoutHandle;
    try {
        console.log('quick_chat llm start');
        const response = await Promise.race([
            agent.prompter.chat_model.sendRequest([], prompt),
            new Promise((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
        ]);
        const sanitized = sanitizeQuickReply(response, maxChars);
        if (sanitized) {
            console.log(`quick_chat llm replied chars=${sanitized.length}`);
            return sanitized;
        }
        console.warn('quick_chat rejected unsafe output');
        return null;
    } catch (error) {
        console.warn(`quick_chat fallback: ${error.message || 'error'}`);
    } finally {
        clearTimeout(timeoutHandle);
    }
    return fallbackReply(message, agent, maxChars);
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
        const reply = await quickChatReply(agent, classified.text, chat);
        if (reply) {
            await agent.openChat(reply);
            console.log('casual chat replied without action interrupt');
        } else console.log('quick_chat suppressed unsafe reply');
        return { handled: true, category: classified.category };
    }
    // Instructions, task updates, and urgent messages deliberately retain the
    // legacy scheduler/planning path. Only safe conversational messages exit early.
    return { handled: false, category: classified.category };
}
import settings from '../../settings.js';
