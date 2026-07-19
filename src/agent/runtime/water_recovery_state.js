const DEFAULT_COOLDOWN_MS = 5_000;
const DEFAULT_LOOP_WINDOW_MS = 30_000;
const DEFAULT_LOOP_LIMIT = 3;

function positionKey(position) {
    return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
}

export class WaterRecoveryState {
    constructor({
        now = () => Date.now(),
        cooldownMs = DEFAULT_COOLDOWN_MS,
        loopWindowMs = DEFAULT_LOOP_WINDOW_MS,
        loopLimit = DEFAULT_LOOP_LIMIT,
    } = {}) {
        this.now = now;
        this.cooldownMs = cooldownMs;
        this.loopWindowMs = loopWindowMs;
        this.loopLimit = loopLimit;
        this.phase = 'idle';
        this.last = null;
        this.attempts = [];
        this.cooldownUntil = 0;
        this.avoidEdgeUntil = 0;
    }

    begin(observation, position) {
        const now = this.now();
        const edge = positionKey(position);
        const emergency = observation.drowningRisk || observation.lavaAdjacent || observation.sinking
            || observation.stuck || observation.resourceRisk;
        if (this.phase === 'active') return { start: false, reasonCode: 'recovery_active' };
        if (now < this.cooldownUntil && !emergency) return { start: false, reasonCode: 'recovery_cooldown' };
        if (now < this.avoidEdgeUntil && this.last?.edge === edge && !emergency) {
            return { start: false, reasonCode: 'water_edge_avoidance' };
        }

        this.attempts = this.attempts.filter(attempt => now - attempt.at <= this.loopWindowMs);
        const repeats = this.attempts.filter(attempt => attempt.edge === edge).length;
        if (repeats >= this.loopLimit) {
            this.phase = 'failed';
            this.cooldownUntil = now + this.loopWindowMs;
            this.last = { edge, at: now, result: 'water_recovery_loop_detected' };
            return { start: false, reasonCode: 'water_recovery_loop_detected', loopDetected: true };
        }

        this.phase = 'active';
        this.attempts.push({ edge, at: now });
        this.last = { edge, at: now, result: 'active' };
        return { start: true, edge };
    }

    finish(result, position, { avoidMs } = {}) {
        const now = this.now();
        const edge = positionKey(position);
        const succeeded = result.status === 'completed';
        this.phase = succeeded ? 'success' : 'failed';
        this.cooldownUntil = now + this.cooldownMs;
        this.avoidEdgeUntil = succeeded
            ? now + (avoidMs ?? this.cooldownMs * 4)
            : now + this.cooldownMs;
        this.last = {
            edge,
            at: now,
            result: succeeded ? 'success' : 'failed',
            reasonCode: result.reasonCode,
        };
        return this.last;
    }

    markSafe(position) {
        if (this.phase !== 'active') return;
        this.finish({ status: 'completed', reasonCode: 'already_safe' }, position);
    }
}
