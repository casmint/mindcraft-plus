const DEFAULTS = {
    enableProgressWatchdog: true,
    stuckWindowMs: 3_000,
    sampleIntervalMs: 500,
    minHorizontalProgress: 0.2,
    maxRecoveryAttempts: 2,
    preferLocalNudgeRecovery: true,
    avoidJumpSpamWhenStuck: true,
    clearControlsOnStuck: true,
};

function horizontalDistance(left, right) {
    return Math.hypot(left.x - right.x, left.z - right.z);
}

function position(bot) {
    const current = bot.entity?.position || { x: 0, y: 0, z: 0 };
    return { x: current.x, y: current.y, z: current.z };
}

export class MovementStuckError extends Error {
    constructor(reasonCode = 'no_horizontal_progress') {
        super(`Movement stuck: ${reasonCode}`);
        this.name = 'MovementStuckError';
        this.reasonCode = reasonCode;
    }
}

export function movementWatchdogOptions(bot, options = {}) {
    return { ...DEFAULTS, ...(bot.instincts?.movement || {}), ...options };
}

export async function withMovementWatchdog(bot, actionLabel, action, options = {}) {
    const config = movementWatchdogOptions(bot, options);
    if (config.enableProgressWatchdog === false) return action();

    const startedAt = Date.now();
    let lastPosition = position(bot);
    let lastProgressAt = startedAt;
    let stuck = false;
    let timer = null;
    let rejectWatchdog;
    const watchdog = new Promise((_, reject) => {
        rejectWatchdog = reject;
        timer = setInterval(() => {
            // Digging is intentional stationary work, not failed navigation.
            if (bot.targetDigBlock) {
                lastProgressAt = Date.now();
                return;
            }
            if (stuck || !bot.pathfinder?.goal) return;
            const current = position(bot);
            if (horizontalDistance(current, lastPosition) >= config.minHorizontalProgress) {
                lastPosition = current;
                lastProgressAt = Date.now();
                return;
            }
            if (Date.now() - lastProgressAt < config.stuckWindowMs) return;
            stuck = true;
            bot.pathfinder?.setGoal?.(null);
            bot.pathfinder?.stop?.();
            if (config.clearControlsOnStuck !== false) bot.clearControlStates?.();
            rejectWatchdog(new MovementStuckError('no_horizontal_progress'));
        }, Math.max(50, config.sampleIntervalMs));
    });

    if (bot.output != null) bot.output += `Movement watchdog started: ${actionLabel}\n`;
    try {
        const result = await Promise.race([Promise.resolve().then(action), watchdog]);
        return result;
    } finally {
        if (timer) clearInterval(timer);
        if (stuck && bot.output != null) bot.output += 'Movement watchdog cleared controls.\n';
    }
}

export function isMovementStuckError(error) {
    return error instanceof MovementStuckError || error?.name === 'MovementStuckError';
}
