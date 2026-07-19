import settings from '../../../settings.js';

const agents = new WeakMap();

export function registerPhysicalActionLimiter(bot, agent) {
    agents.set(bot, agent);
}

function pauseForSpam(agent, reason) {
    const { runtimeGuard: guard, bot, self_prompter: prompter } = agent;
    if (!guard.softQuarantineAnnounced) {
        guard.softQuarantineAnnounced = true;
        console.warn(`runtime soft-quarantine: spam fuse triggered ${reason}`);
    }
    bot.pathfinder?.stop?.();
    bot.clearControlStates?.();
    prompter?.pauseForRuntime?.(15_000);
}

export function admitPhysicalAction(bot, label, { emergency = false } = {}) {
    if (settings.enable_mode_scheduler === false) return { allowed: true };
    const agent = agents.get(bot);
    if (!agent?.runtimeGuard) return { allowed: true };
    const decision = agent.runtimeGuard.recordPhysicalAction(label, { emergency });
    if (!decision.allowed) pauseForSpam(agent, decision.reasonCode);
    return decision;
}
