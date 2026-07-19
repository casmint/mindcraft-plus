import Vec3 from 'vec3';

function abortError(signal) {
    return signal?.aborted ? signal.reason || new Error('Water recovery cancelled.') : null;
}

export class SwimController {
    constructor(bot, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
        this.bot = bot;
        this.sleep = sleep;
        this.ownedControls = new Set();
    }

    setControl(name, active) {
        this.bot.setControlState?.(name, active);
        if (active) this.ownedControls.add(name);
        else this.ownedControls.delete(name);
    }

    async surface({ observe, signal, timeoutMs = 4_000, pollMs = 200, now = () => Date.now() } = {}) {
        const startedAt = now();
        let samples = 0;
        this.setControl('jump', true);
        this.setControl('forward', false);
        while (now() - startedAt <= timeoutMs) {
            if (abortError(signal)) return { status: 'cancelled', samples };
            const observation = observe();
            samples++;
            if (!observation.headUnderwater) return { status: 'surfaced', observation, samples };
            await this.sleep(pollMs);
        }
        return { status: 'timeout', samples };
    }

    async swimTo(exitPosition, { signal, timeoutMs = 6_000, pollMs = 200, arrivalDistance = 1, now = () => Date.now() } = {}) {
        const startedAt = now();
        let samples = 0;
        let bestDistance = Infinity;
        let stagnantSamples = 0;
        this.setControl('jump', true);
        this.setControl('forward', true);
        while (now() - startedAt <= timeoutMs) {
            if (abortError(signal)) return { status: 'cancelled', samples };
            const position = this.bot.entity.position;
            const distance = Math.hypot(position.x - exitPosition.x, position.y - exitPosition.y, position.z - exitPosition.z);
            samples++;
            if (distance <= arrivalDistance) return { status: 'arrived', distance, samples };
            if (distance < bestDistance - 0.05) {
                bestDistance = distance;
                stagnantSamples = 0;
            } else {
                stagnantSamples++;
            }
            if (stagnantSamples >= 5) return { status: 'stalled', distance, samples };
            await this.bot.lookAt?.(new Vec3(exitPosition.x, exitPosition.y, exitPosition.z), true);
            await this.sleep(pollMs);
        }
        return { status: 'timeout', samples };
    }

    clear() {
        for (const control of this.ownedControls) {
            this.bot.setControlState?.(control, false);
        }
        this.ownedControls.clear();
    }
}
