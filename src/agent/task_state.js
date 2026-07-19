import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const DURABLE_GOAL_PATTERN = /\b(goal|continue(?:\s+your)?\s+goal|obtain|gather|survive|build|craft|get|full\s+diamond\s+armor\s+and\s+tools)\b/i;

export function durableGoalFromMessage(message) {
    const text = String(message || '').trim();
    if (!DURABLE_GOAL_PATTERN.test(text)) return null;
    const goal = text
        .replace(/^\s*(?:please\s+)?(?:continue\s+(?:your\s+)?goal\s+(?:of\s+)?)/i, '')
        .replace(/^\s*(?:my\s+)?goal\s*(?:is|:)?\s*/i, '')
        .trim();
    if (!goal) return null;
    return goal.replace(/^obtaining\b/i, 'Obtain').replace(/^./, character => character.toUpperCase());
}

export class DurableTaskState {
    constructor(botName, { root = './bots', now = () => Date.now() } = {}) {
        this.filepath = root + '/' + botName + '/task_state.json';
        this.now = now;
    }

    load() {
        if (!existsSync(this.filepath)) return null;
        const state = JSON.parse(readFileSync(this.filepath, 'utf8'));
        return state?.status === 'active' || state?.status === 'paused' ? state : null;
    }

    save(state) {
        mkdirSync(this.filepath.slice(0, this.filepath.lastIndexOf('/')), { recursive: true });
        writeFileSync(this.filepath, JSON.stringify(state, null, 2), 'utf8');
        return state;
    }

    setActive(activeGoal, { sourcePlayer = null, previous = null } = {}) {
        const now = this.now();
        return this.save({
            activeGoal,
            sourcePlayer,
            createdAt: previous?.createdAt || now,
            updatedAt: now,
            status: 'active',
            lastKnownPosition: previous?.lastKnownPosition || null,
            lastProgressSummary: previous?.lastProgressSummary || '',
            nextSuggestedAction: previous?.nextSuggestedAction || '',
            lastRestartAt: previous?.lastRestartAt || null,
            restartCount: previous?.restartCount || 0,
        });
    }

    markRestart(state, position = null) {
        const now = this.now();
        return this.save({
            ...state,
            status: state.status === 'completed' ? 'completed' : 'active',
            updatedAt: now,
            lastRestartAt: now,
            restartCount: (state.restartCount || 0) + 1,
            lastKnownPosition: position || state.lastKnownPosition || null,
        });
    }

    complete(state) {
        return this.save({ ...state, status: 'completed', updatedAt: this.now() });
    }

    pause(state) {
        return this.save({ ...state, status: 'paused', updatedAt: this.now() });
    }

    clear(state = {}) {
        return this.save({ ...state, status: 'cleared', activeGoal: '', updatedAt: this.now() });
    }
}
