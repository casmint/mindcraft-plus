import assert from 'node:assert/strict';

import { ActionContext } from './runtime/action_context.js';

const STOP_TIMEOUT_MS = 10_000;

export class ActionManager {
    constructor(agent) {
        this.agent = agent;
        this.executing = false;
        this.currentActionLabel = '';
        this.currentActionFn = null;
        this.currentActionContext = null;
        this.currentActionGeneration = 0;
        this.actionState = 'idle';
        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';
        this.last_action_time = 0;
        this.recent_action_counter = 0;
        this.stopPromise = null;
    }

    async resumeAction(actionLabel, actionFn, timeout) {
        return this._executeResume(actionLabel, actionFn, timeout);
    }

    async runAction(actionLabel, actionFn, { timeout, resume = false } = {}) {
        if (resume) {
            return this._executeResume(actionLabel, actionFn, timeout);
        }
        return this._executeAction(actionLabel, actionFn, timeout);
    }

    async stop({ reason = 'interrupted', timeoutMs = STOP_TIMEOUT_MS } = {}) {
        if (this.actionState === 'quarantined') return false;
        if (!this.executing) return true;
        if (this.stopPromise) return this.stopPromise;

        const context = this.currentActionContext;
        const stopPromise = this._stopActiveAction(context, reason, timeoutMs);
        this.stopPromise = stopPromise;
        try {
            return await stopPromise;
        } finally {
            if (this.stopPromise === stopPromise) {
                this.stopPromise = null;
            }
        }
    }

    async _stopActiveAction(context, reason, timeoutMs) {
        if (!context || !this._isCurrent(context)) return true;

        context.cancel(reason);
        this.actionState = 'cancelling';
        const deadline = Date.now() + timeoutMs;

        while (this._isCurrent(context) && this.executing) {
            const cleanupReport = await this._requestCleanup(context);
            if (cleanupReport?.quiescent === false) {
                this._quarantine(context, `${reason}: cleanup not quiescent`);
                return false;
            }
            if (!this._isCurrent(context) || !this.executing) return true;

            if (Date.now() >= deadline) {
                this._quarantine(context, reason);
                return false;
            }

            console.log('waiting for code to finish executing...');
            await new Promise(resolve => setTimeout(resolve, Math.min(300, deadline - Date.now())));
        }

        return this.actionState !== 'quarantined';
    }

    async _requestCleanup(context) {
        const cleanupPromise = Promise.resolve(this.agent.requestInterrupt());
        context.cleanupPromise = cleanupPromise;
        const cleanupReport = await cleanupPromise;
        context.cleanupReport = cleanupReport;
        return cleanupReport;
    }

    async _awaitCleanupBarrier(context) {
        if (!context.signal.aborted || !context.cleanupPromise) return true;
        const cleanupReport = await context.cleanupPromise;
        context.cleanupReport = cleanupReport;
        if (cleanupReport?.quiescent === false) {
            this._quarantine(context, `${context.cancelReason}: cleanup not quiescent`);
            return false;
        }
        return true;
    }

    _quarantine(context, reason) {
        if (!this._isCurrent(context) || this.actionState === 'quarantined') return;
        this.actionState = 'quarantined';
        console.error(`Action runtime quarantined: ${context.label} did not quiesce after ${reason}.`);
    }

    _isCurrent(context) {
        return this.currentActionContext === context &&
            this.currentActionGeneration === context.generation;
    }

    _clearCurrentAction(context) {
        if (!this._isCurrent(context) || this.actionState === 'quarantined') return false;
        this.executing = false;
        this.currentActionLabel = '';
        this.currentActionFn = null;
        this.currentActionContext = null;
        this.actionState = 'idle';
        this.timedout = false;
        return true;
    }

    _quarantinedResult() {
        return {
            success: false,
            message: `Action runtime quarantined after action "${this.currentActionLabel}" did not quiesce.`,
            interrupted: true,
            timedout: this.timedout,
        };
    }

    _staleResult(context) {
        return {
            success: false,
            message: `Action result ignored: stale action generation ${context.generation}.`,
            interrupted: true,
            timedout: context.timedout,
        };
    }

    cancelResume() {
        this.resume_func = null;
        this.resume_name = null;
    }

    async _executeResume(actionLabel = null, actionFn = null, timeout = 10) {
        const newResume = actionFn != null;
        if (newResume) {
            assert.ok(actionLabel != null, 'actionLabel is required for new resume');
            this.resume_func = actionFn;
            this.resume_name = actionLabel;
        }
        if (this.resume_func != null && (this.agent.isIdle() || newResume) && (!this.agent.self_prompter.isActive() || newResume)) {
            return this._executeAction(this.resume_name, this.resume_func, timeout);
        }
        return { success: false, message: null, interrupted: false, timedout: false };
    }

    async _executeAction(actionLabel, actionFn, timeout = 10) {
        let timeoutHandle;
        let context;
        try {
            if (this.actionState === 'quarantined') {
                return this._quarantinedResult();
            }
            if (this.executing && this.currentActionLabel === actionLabel) {
                const message = `Action rejected: duplicate active label "${actionLabel}".`;
                console.warn(message);
                return { success: false, message, interrupted: false, timedout: false };
            }

            if (this.executing) {
                console.log(`action "${actionLabel}" trying to interrupt current action "${this.currentActionLabel}"`);
            }
            const stopped = await this.stop({ reason: 'replaced' });
            if (!stopped) return this._quarantinedResult();

            if (this.last_action_time > 0) {
                const timeDiff = Date.now() - this.last_action_time;
                this.recent_action_counter = timeDiff < 20 ? this.recent_action_counter + 1 : 0;
                if (this.recent_action_counter > 3) {
                    console.warn('Fast action loop detected, cancelling resume.');
                    this.cancelResume();
                }
                if (this.recent_action_counter > 5) {
                    console.error('Infinite action loop detected, shutting down.');
                    this.agent.cleanKill('Infinite action loop detected, shutting down.');
                    return { success: false, message: 'Infinite action loop detected, shutting down.', interrupted: false, timedout: false };
                }
            }

            this.last_action_time = Date.now();
            console.log('executing code...\n');
            this.agent.clearBotLogs();

            context = new ActionContext({
                id: `action-${this.currentActionGeneration + 1}`,
                generation: this.currentActionGeneration + 1,
                label: actionLabel,
            });
            this.currentActionGeneration = context.generation;
            this.currentActionContext = context;
            this.executing = true;
            this.actionState = 'running';
            this.timedout = false;
            this.currentActionLabel = actionLabel;
            this.currentActionFn = actionFn;

            if (timeout > 0) {
                timeoutHandle = this._startTimeout(context, timeout);
            }

            await actionFn(context);
            clearTimeout(timeoutHandle);

            if (!this._isCurrent(context)) return this._staleResult(context);
            if (this.actionState === 'quarantined') return this._quarantinedResult();
            if (!await this._awaitCleanupBarrier(context)) return this._quarantinedResult();

            const output = this.getBotOutputSummary();
            const interrupted = this.agent.bot.interrupt_code;
            const timedout = context.timedout;
            this._clearCurrentAction(context);
            this.agent.clearBotLogs();

            if (!interrupted) {
                this.agent.bot.emit('idle');
            }

            return { success: true, message: output, interrupted, timedout };
        } catch (err) {
            clearTimeout(timeoutHandle);
            this.cancelResume();
            console.error('Code execution triggered catch:', err);
            const errorMessage = err instanceof Error ? err.toString() : String(err);
            const errorStack = err instanceof Error && err.stack ? err.stack : errorMessage;
            console.error(errorStack);

            if (!context || !this._isCurrent(context)) return context ? this._staleResult(context) : {
                success: false,
                message: `!!Code threw exception!!\nError: ${errorMessage}\nStack trace:\n${errorStack}\n`,
                interrupted: false,
                timedout: false,
            };
            if (this.actionState === 'quarantined') return this._quarantinedResult();

            const output = this.getBotOutputSummary();
            context.cancel('error');
            this.actionState = 'cancelling';
            await this._requestCleanup(context);
            if (!await this._awaitCleanupBarrier(context)) return this._quarantinedResult();

            const interrupted = this.agent.bot.interrupt_code;
            const timedout = context.timedout;
            this._clearCurrentAction(context);
            this.agent.clearBotLogs();
            if (!interrupted) {
                this.agent.bot.emit('idle');
            }
            return {
                success: false,
                message: output +
                    '!!Code threw exception!!\n' +
                    `Error: ${errorMessage}\n` +
                    `Stack trace:\n${errorStack}\n`,
                interrupted,
                timedout,
            };
        }
    }

    getBotOutputSummary() {
        const { bot } = this.agent;
        if (bot.interrupt_code && !this.timedout) return '';
        let output = bot.output;
        const MAX_OUT = 500;
        if (output.length > MAX_OUT) {
            output = `Action output is very long (${output.length} chars) and has been shortened.\n
          First outputs:\n${output.substring(0, MAX_OUT / 2)}\n...skipping many lines.\nFinal outputs:\n ${output.substring(output.length - MAX_OUT / 2)}`;
        } else {
            output = 'Action output:\n' + output.toString();
        }
        bot.output = '';
        return output;
    }

    _startTimeout(context, timeoutMins = 10) {
        return setTimeout(() => {
            if (!this._isCurrent(context) || this.actionState === 'quarantined') return;
            console.warn(`Code execution timed out after ${timeoutMins} minutes. Attempting stop.`);
            context.timedout = true;
            this.timedout = true;
            this.agent.history.add('system', `Code execution timed out after ${timeoutMins} minutes. Attempting stop.`);
            void this.stop({ reason: 'timeout' });
        }, timeoutMins * 60 * 1000);
    }
}
