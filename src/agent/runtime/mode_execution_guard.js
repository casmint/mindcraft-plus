const COOLDOWNS = { cowardice: 8_000, self_preservation: 4_000, unstuck: 5_000, item_collecting: 2_000 };

export class ModeExecutionGuard {
    constructor({ now = () => Date.now() } = {}) {
        this.now = now;
        this.lastModeRuns = new Map();
        this.lastModeResult = new Map();
        this.repeats = new Map();
        this.suppressedUntil = new Map();
        this.physicalRuns = [];
        this.currentActionLabel = '';
        this.currentModeLabel = '';
        this.lastInterruptAt = 0;
        this.recentInterrupts = [];
        this.interruptsByAction = new Map();
        this.cleanupInProgress = false;
        this.quarantineActive = false;
        this.quarantineUntil = 0;
        this.quarantineReason = '';
        this.quarantineAnnounced = false;
        this.softQuarantineAnnounced = false;
        this.lastPhysicalByLabel = new Map();
        this.lastEmergencyByLabel = new Map();
        this.selfPromptRestarts = [];
    }

    canRunMode(name, { emergency = false } = {}) {
        const now = this.now();
        if (this.isQuarantined()) return { allowed: false, reasonCode: 'runtime_quarantined' };
        if (this.cleanupInProgress && !emergency) return { allowed: false, reasonCode: 'cleanup_in_progress' };
        if (!emergency && now < (this.suppressedUntil.get(name) || 0)) return { allowed: false, reasonCode: `repeated_result ${name}` };
        const cooldown = COOLDOWNS[name] ?? 2_000;
        const lastRun = this.lastModeRuns.get(name);
        if (!emergency && lastRun != null && now - lastRun < cooldown) {
            return { allowed: false, reasonCode: `cooldown ${name}` };
        }
        return { allowed: true };
    }

    beginMode(name) {
        this.lastModeRuns.set(name, this.now());
        this.currentModeLabel = name;
        return { allowed: true };
    }

    recordPhysicalAction(label = 'physical_action', { emergency = false } = {}) {
        const now = this.now();
        if (this.isQuarantined()) {
            if (this.quarantineUntil === 0 || !emergency) return { allowed: false, reasonCode: 'runtime_quarantined' };
            const lastEmergency = this.lastEmergencyByLabel.get(label);
            if (lastEmergency != null && now - lastEmergency < 2_500) {
                return { allowed: false, reasonCode: 'emergency_action_cooldown' };
            }
            this.lastEmergencyByLabel.set(label, now);
            return { allowed: true, emergency: true };
        }
        const previous = this.lastPhysicalByLabel.get(label);
        this.lastPhysicalByLabel.set(label, now);
        if (previous != null && now - previous < 750) return { allowed: true, deduped: true };
        this.physicalRuns = this.physicalRuns.filter(at => now - at <= 10_000);
        this.physicalRuns.push(now);
        if (this.physicalRuns.length > 6) {
            this.enterSoftQuarantine('physical_action_spam', 15_000);
            return { allowed: false, reasonCode: 'physical_action_spam' };
        }
        return { allowed: true };
    }

    recordInterrupt(actionLabel = '', { emergency = false } = {}) {
        const now = this.now();
        this.lastInterruptAt = now;
        this.recentInterrupts = this.recentInterrupts.filter(at => now - at <= 5_000);
        this.recentInterrupts.push(now);
        const key = actionLabel || 'unknown_action';
        const actionInterrupts = (this.interruptsByAction.get(key) || []).filter(at => now - at <= 5_000);
        actionInterrupts.push(now);
        this.interruptsByAction.set(key, actionInterrupts);
        if (!emergency && actionInterrupts.length > 3) {
            return { allowed: false, reasonCode: 'interrupt_spam' };
        }
        return { allowed: true };
    }

    recordSelfPromptRestart() {
        const now = this.now();
        this.selfPromptRestarts = this.selfPromptRestarts.filter(at => now - at <= 30_000);
        this.selfPromptRestarts.push(now);
        return this.selfPromptRestarts.length <= 2
            ? { allowed: true }
            : { allowed: false, reasonCode: 'self_prompt_restart_spam' };
    }

    finishMode(name, result = '', signatureOverride = '') {
        const now = this.now();
        const signature = String(signatureOverride || result || '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'empty';
        const previous = this.lastModeResult.get(name);
        const key = `${name}:${signature}`;
        const repeat = previous?.signature === signature && now - previous.at <= 20_000
            ? (this.repeats.get(key) || 0) + 1
            : 1;
        this.lastModeResult.set(name, { signature, at: now });
        if (this.currentModeLabel === name) this.currentModeLabel = '';
        this.repeats.set(key, repeat);
        if ((name === 'cowardice' || name === 'self_preservation') && repeat > 2) {
            this.suppressedUntil.set(name, now + 30_000);
            return { suppressed: true, signature, repeat };
        }
        return { suppressed: false, signature, repeat };
    }

    isQuarantined() {
        if (!this.quarantineActive) return false;
        if (this.quarantineUntil > 0 && this.now() >= this.quarantineUntil) {
            this.clearQuarantine();
            return false;
        }
        return true;
    }

    enterSoftQuarantine(reason, durationMs = 15_000) {
        this.quarantineActive = true;
        this.quarantineReason = reason;
        this.quarantineUntil = this.now() + durationMs;
    }

    enterQuarantine(reason) {
        this.quarantineActive = true;
        this.quarantineReason = reason;
        this.quarantineUntil = 0;
    }

    clearQuarantine() {
        this.quarantineActive = false;
        this.quarantineUntil = 0;
        this.quarantineReason = '';
        this.quarantineAnnounced = false;
        this.softQuarantineAnnounced = false;
    }
}
