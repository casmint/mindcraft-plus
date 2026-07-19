import { createActionResult } from './action_result.js';

function isCancelled(bot, signal) {
    return Boolean(signal?.aborted || bot.interrupt_code);
}

function verticalSafetyThreshold(bot) {
    const survival = bot.instincts?.survival || {};
    return survival.stopMiningBelowHealth ?? survival.restBelowHealth ?? 8;
}

export async function pillarUp(bot, {
    blockType,
    height = 1,
    maxAttempts = 16,
    signal,
    placeBlock,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    const requested = Math.max(1, Math.floor(height));
    const attempts = Math.min(requested, Math.max(1, Math.floor(maxAttempts)));
    const threshold = verticalSafetyThreshold(bot);
    const evidence = { attempts: [], requested, threshold };

    if (typeof bot.health === 'number' && bot.health < threshold) {
        bot.setControlState?.('jump', false);
        bot.clearControlStates?.();
        return createActionResult({
            status: 'blocked',
            reasonCode: 'health_below_vertical_safety_threshold',
            message: `Refusing vertical movement at health ${bot.health}; threshold is ${threshold}.`,
            retryable: true,
            evidence,
        });
    }
    if (typeof placeBlock !== 'function') {
        throw new Error('pillarUp requires a placement function.');
    }

    bot.pathfinder?.setGoal?.(null);
    bot.pathfinder?.stop?.();
    bot.pvp?.stop?.();
    let completed = 0;
    let stagnant = 0;
    try {
        for (let index = 0; index < attempts; index++) {
            if (isCancelled(bot, signal)) {
                return createActionResult({
                    status: 'cancelled',
                    reasonCode: 'pillar_cancelled',
                    message: 'Vertical placement was cancelled.',
                    retryable: true,
                    evidence,
                });
            }
            const beforeY = bot.entity.position.y;
            let placed = false;
            let target;
            try {
                bot.setControlState?.('jump', true);
                await sleep(150);
                const position = bot.entity.position;
                target = {
                    x: Math.floor(position.x),
                    y: Math.floor(position.y) - 1,
                    z: Math.floor(position.z),
                };
                placed = await placeBlock(
                    blockType,
                    target.x,
                    target.y,
                    target.z,
                );
            } finally {
                // A placement failure, exception, or cancellation may never leave jump held.
                bot.setControlState?.('jump', false);
            }
            await sleep(150);
            const afterY = bot.entity.position.y;
            const rose = afterY > beforeY + 0.2;
            const observedBlock = bot.blockAt?.(target);
            const placementObserved = observedBlock ? observedBlock.name === blockType : placed;
            evidence.attempts.push({ afterY, beforeY, placed, placementObserved, rose, target });
            if (!placed) {
                return createActionResult({
                    status: 'blocked',
                    reasonCode: 'pillar_placement_failed',
                    message: `Pillar placement failed at step ${index + 1}.`,
                    retryable: true,
                    evidence,
                });
            }
            if (!rose && !placementObserved) {
                return createActionResult({
                    status: 'blocked',
                    reasonCode: 'pillar_placement_unverified',
                    message: `Pillar step ${index + 1} produced no vertical or block-placement evidence.`,
                    retryable: true,
                    evidence,
                });
            }
            completed++;
            stagnant = rose ? 0 : stagnant + 1;
            if (stagnant >= 2) {
                return createActionResult({
                    status: 'blocked',
                    reasonCode: 'pillar_stuck_no_vertical_progress',
                    message: 'Pillar placement succeeded but the bot made no vertical progress.',
                    retryable: true,
                    evidence,
                });
            }
        }
        return createActionResult({
            status: completed === requested ? 'completed' : 'partial',
            reasonCode: completed === requested ? 'pillar_completed' : 'pillar_attempt_limit',
            message: `Completed ${completed} of ${requested} vertical placement steps.`,
            retryable: completed !== requested,
            evidence,
        });
    } finally {
        bot.setControlState?.('jump', false);
        bot.clearControlStates?.();
        bot.pathfinder?.stop?.();
        bot.pvp?.stop?.();
    }
}
