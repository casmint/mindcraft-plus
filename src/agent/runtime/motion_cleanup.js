async function runCleanupStep(report, name, action) {
    try {
        await action();
        report.steps[name] = 'stopped';
    } catch (error) {
        if (/GoalChanged/i.test(error instanceof Error ? error.message : String(error))) {
            report.steps[name] = 'cleanup_cancelled_goal';
            return;
        }
        report.steps[name] = 'failed';
        report.errors.push({
            step: name,
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

function markUnavailable(report, name) {
    report.steps[name] = 'unavailable';
}

function getControlStates(bot) {
    if (!bot.controlState) return [];
    return Object.entries(bot.controlState)
        .filter(([, active]) => Boolean(active))
        .map(([name]) => name);
}

function observeMotionState(bot) {
    return {
        activeControls: getControlStates(bot),
        currentWindow: Boolean(bot.currentWindow),
        digging: Boolean(bot.targetDigBlock),
        pathfinderGoal: Boolean(bot.pathfinder?.goal),
        pvpTarget: Boolean(bot.pvp?.target),
    };
}

export async function cleanupMotion(agent, { reason = 'interrupt' } = {}) {
    const { bot } = agent;
    const report = {
        actionLabel: agent.actions?.currentActionLabel || '',
        errors: [],
        reason,
        steps: {},
        startedAt: Date.now(),
    };

    if (bot.collectBlock?.cancelTask) {
        await runCleanupStep(report, 'collectBlock', () => bot.collectBlock.cancelTask());
    } else {
        markUnavailable(report, 'collectBlock');
    }

    if (bot.pvp?.stop) {
        await runCleanupStep(report, 'pvp', () => bot.pvp.stop());
    } else {
        markUnavailable(report, 'pvp');
    }

    if (bot.pathfinder?.setGoal) {
        await runCleanupStep(report, 'pathfinderGoal', () => bot.pathfinder.setGoal(null));
    } else {
        markUnavailable(report, 'pathfinderGoal');
    }

    if (bot.pathfinder?.stop) {
        await runCleanupStep(report, 'pathfinder', () => bot.pathfinder.stop());
    } else {
        markUnavailable(report, 'pathfinder');
    }

    if (bot.stopDigging) {
        await runCleanupStep(report, 'digging', () => bot.stopDigging());
    } else {
        markUnavailable(report, 'digging');
    }

    if (bot.deactivateItem) {
        await runCleanupStep(report, 'itemUse', () => bot.deactivateItem());
    } else {
        markUnavailable(report, 'itemUse');
    }

    if (bot.currentWindow && bot.closeWindow) {
        await runCleanupStep(report, 'window', () => bot.closeWindow(bot.currentWindow));
    } else {
        report.steps.window = bot.currentWindow ? 'unavailable' : 'not_open';
    }

    if (bot.clearControlStates) {
        await runCleanupStep(report, 'controls', () => bot.clearControlStates());
    } else {
        markUnavailable(report, 'controls');
    }

    report.observed = observeMotionState(bot);
    report.quiescent = report.errors.length === 0 &&
        report.observed.activeControls.length === 0 &&
        !report.observed.currentWindow &&
        !report.observed.digging &&
        !report.observed.pathfinderGoal &&
        !report.observed.pvpTarget;
    report.endedAt = Date.now();
    return report;
}
