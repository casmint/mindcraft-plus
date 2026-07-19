import { createActionResult } from './action_result.js';
import { isInWater } from './water_detector.js';
import { SwimController } from './swim_controller.js';

function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function findNearestWaterExit(bot, snapshot) {
    const candidates = snapshot.findStandablePositions({ maxDistance: snapshot.options.radius })
        .filter(position => !isInWater({ entity: { position } }, snapshot))
        .filter(position => !snapshot.findAll({ names: 'lava' }).some(cell =>
            cell.name === 'lava' && distance(cell.position, position) <= 1.5,
        ))
        .sort((left, right) => distance(bot.entity.position, left) - distance(bot.entity.position, right)
            || left.y - right.y
            || `${left.x},${left.y},${left.z}`.localeCompare(`${right.x},${right.y},${right.z}`));
    return candidates[0] || null;
}

export function verifyOnSolidGround(bot, snapshot) {
    const position = {
        x: Math.floor(bot.entity.position.x),
        y: Math.floor(bot.entity.position.y),
        z: Math.floor(bot.entity.position.z),
    };
    const standability = snapshot.evaluateStandable(position);
    const inWater = isInWater(bot, snapshot);
    const velocityY = bot.entity.velocity?.y ?? 0;
    return {
        grounded: standability.standable && !inWater && Math.abs(velocityY) <= 0.1,
        position,
        standability,
        inWater,
        velocityY,
        snapshotId: snapshot.id,
    };
}

export async function exitWater(bot, {
    detector,
    localMap,
    signal,
    surfaceTimeoutMs = 4_000,
    exitTimeoutMs = 6_000,
    controller = new SwimController(bot),
} = {}) {
    if (!detector || !localMap) throw new Error('exitWater requires a WaterDetector and LocalBlockMap.');
    const evidence = { attempts: [] };
    try {
        let snapshot = localMap.getSnapshot(bot, { radius: 8, heightUp: 4, heightDown: 4, fresh: true });
        let observation = detector.observe(bot, snapshot);
        evidence.initial = observation;
        if (!observation.inWater) {
            const ground = verifyOnSolidGround(bot, snapshot);
            return createActionResult({
                status: ground.grounded ? 'completed' : 'blocked',
                reasonCode: ground.grounded ? 'already_grounded' : 'ground_verification_failed',
                message: ground.grounded ? 'Already on verified solid ground.' : 'Not in water, but solid-ground verification failed.',
                retryable: !ground.grounded,
                evidence: { ...evidence, ground },
            });
        }
        if (observation.headUnderwater || observation.sinking || observation.drowningRisk) {
            const surface = await controller.surface({
                signal,
                timeoutMs: surfaceTimeoutMs,
                observe: () => {
                    snapshot = localMap.getSnapshot(bot, { radius: 8, heightUp: 4, heightDown: 4, fresh: true });
                    observation = detector.observe(bot, snapshot);
                    return observation;
                },
            });
            evidence.attempts.push({ stage: 'surface', ...surface });
            if (surface.status !== 'surfaced') {
                return createActionResult({
                    status: surface.status === 'cancelled' ? 'cancelled' : 'blocked',
                    reasonCode: surface.status === 'cancelled' ? 'cancelled' : 'surface_timeout',
                    message: 'Could not reach the water surface within the recovery budget.',
                    retryable: true,
                    evidence,
                });
            }
        }
        snapshot = localMap.getSnapshot(bot, { radius: 8, heightUp: 4, heightDown: 4, fresh: true });
        const exit = findNearestWaterExit(bot, snapshot);
        if (!exit) {
            return createActionResult({
                status: 'blocked',
                reasonCode: 'water_exit_not_found',
                message: 'No observed safe water exit was available in the local scan.',
                retryable: true,
                evidence: { ...evidence, snapshotId: snapshot.id },
            });
        }
        evidence.exit = exit;
        const swim = await controller.swimTo(exit, { signal, timeoutMs: exitTimeoutMs });
        evidence.attempts.push({ stage: 'exit', ...swim });
        if (swim.status !== 'arrived') {
            return createActionResult({
                status: swim.status === 'cancelled' ? 'cancelled' : 'blocked',
                reasonCode: swim.status === 'stalled' ? 'water_exit_stalled' : swim.status === 'cancelled' ? 'cancelled' : 'water_exit_timeout',
                message: 'Water exit did not reach its selected safe stand position.',
                retryable: true,
                evidence,
            });
        }
        snapshot = localMap.getSnapshot(bot, { radius: 8, heightUp: 4, heightDown: 4, fresh: true });
        const ground = verifyOnSolidGround(bot, snapshot);
        return createActionResult({
            status: ground.grounded ? 'completed' : 'blocked',
            reasonCode: ground.grounded ? 'water_exit_verified' : 'ground_verification_failed',
            message: ground.grounded ? 'Exited water onto verified solid ground.' : 'Reached an exit candidate but grounding could not be verified.',
            retryable: !ground.grounded,
            evidence: { ...evidence, ground },
        });
    } finally {
        controller.clear();
    }
}
