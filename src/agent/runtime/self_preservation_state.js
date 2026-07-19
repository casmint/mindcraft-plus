const DEFAULT_MIN_INTERVAL_MS = 1_500;
const DEFAULT_LOOP_WINDOW_MS = 15_000;
const DEFAULT_LOOP_LIMIT = 3;
const DEFAULT_COOLDOWN_MS = 20_000;

function isSolidCell(cell) {
    return Boolean(cell?.observed && (cell.isSolid || cell.boundingBox === 'block'
        || (cell.name && !['air', 'cave_air', 'void_air', 'water', 'lava'].includes(cell.name))));
}

export function hasStableLiveState({ below, feet, head, lowHealth = false, activeDamage = false, falling = false }) {
    const feetName = feet?.name || 'air';
    const headName = head?.name || 'air';
    const hazardous = ['water', 'lava', 'fire'];
    return isSolidCell(below) && !hazardous.includes(feetName) && !hazardous.includes(headName)
        && !lowHealth && !activeDamage && !falling;
}

export function shouldDeferSelfPreservation({ currentAction = '', actionState = 'idle', emergency = false }) {
    if (emergency) return null;
    if (['cancelling', 'quarantined'].includes(actionState)) return 'cleanup_in_progress';
    if (currentAction === 'mode:unstuck') return 'unstuck_active_no_emergency';
    return null;
}

export function waterHazardSignature({ position, feet, below, head, ceilingOffset, drowning, grounded }) {
    const blockName = block => block?.name || 'unknown';
    return [
        'water',
        `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`,
        `feet_${blockName(feet)}`,
        `below_${blockName(below)}`,
        `head_${blockName(head)}`,
        `ceiling_${ceilingOffset ?? 'none'}`,
        drowning ? 'drowning' : 'not_drowning',
        grounded ? 'grounded' : 'not_grounded',
    ].join(':');
}

export function shouldUseHorizontalWaterExit({ shallowStanding, lavaAdjacent, crampedHeadroom }) {
    return Boolean(!lavaAdjacent && (shallowStanding || crampedHeadroom));
}

export class SelfPreservationState {
    constructor({
        now = () => Date.now(),
        minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
        loopWindowMs = DEFAULT_LOOP_WINDOW_MS,
        loopLimit = DEFAULT_LOOP_LIMIT,
        cooldownMs = DEFAULT_COOLDOWN_MS,
    } = {}) {
        this.now = now;
        this.minIntervalMs = minIntervalMs;
        this.loopWindowMs = loopWindowMs;
        this.loopLimit = loopLimit;
        this.cooldownMs = cooldownMs;
        this.active = false;
        this.lastRunAt = 0;
        this.lastSignature = null;
        this.lastResult = null;
        this.repeatCount = 0;
        this.attempts = [];
        this.cooldowns = new Map();
        this.resolvedCooldowns = new Map();
    }

    begin(signature, { emergency = false } = {}) {
        const now = this.now();
        if (this.active) return { start: false, reasonCode: 'self_preservation_active' };
        if (!emergency && now < (this.resolvedCooldowns.get(signature) || 0)) {
            return { start: false, reasonCode: 'resolved_water_cooldown' };
        }
        if (!emergency && now < (this.cooldowns.get(signature) || 0)) {
            return { start: false, reasonCode: 'self_preservation_cooldown' };
        }
        if (!emergency && this.lastSignature === signature && now - this.lastRunAt < this.minIntervalMs) {
            return { start: false, reasonCode: 'self_preservation_rate_limited' };
        }
        this.attempts = this.attempts.filter(attempt => now - attempt.at <= this.loopWindowMs);
        const repeats = this.attempts.filter(attempt => attempt.signature === signature).length;
        if (repeats >= this.loopLimit - 1) {
            this.cooldowns.set(signature, now + this.cooldownMs);
            this.lastSignature = signature;
            this.lastRunAt = now;
            this.lastResult = 'self_preservation_loop_detected';
            this.repeatCount = repeats + 1;
            return { start: false, reasonCode: 'self_preservation_loop_detected', loopDetected: true };
        }
        this.active = true;
        this.lastSignature = signature;
        this.lastRunAt = now;
        this.repeatCount = repeats + 1;
        this.attempts.push({ signature, at: now });
        return { start: true };
    }

    finish(result, { resolvedCooldownMs = this.cooldownMs } = {}) {
        this.active = false;
        this.lastResult = result?.reasonCode || result?.status || 'unknown';
        if (result?.status === 'completed' && /(?:verified|already_grounded)$/.test(result.reasonCode || '')) {
            this.resolvedCooldowns.set(this.lastSignature, this.now() + resolvedCooldownMs);
        }
    }
}
