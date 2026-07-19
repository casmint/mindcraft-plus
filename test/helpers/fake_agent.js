import { EventEmitter } from 'node:events';

export function createFakeAgent({ interruptReport, onInterrupt } = {}) {
    const bot = new EventEmitter();
    bot.output = '';
    bot.interrupt_code = false;

    const calls = {
        cleanKill: [],
        clearBotLogs: 0,
        history: [],
        interrupts: 0,
        idle: 0,
    };

    bot.on('idle', () => {
        calls.idle++;
    });

    const agent = {
        bot,
        calls,
        history: {
            add(source, message) {
                calls.history.push({ source, message });
            },
        },
        self_prompter: {
            isActive() {
                return false;
            },
        },
        cleanKill(message) {
            calls.cleanKill.push(message);
        },
        clearBotLogs() {
            calls.clearBotLogs++;
            bot.output = '';
            bot.interrupt_code = false;
        },
        requestInterrupt() {
            calls.interrupts++;
            bot.interrupt_code = true;
            onInterrupt?.();
            return interruptReport;
        },
        isIdle() {
            return !agent.actions?.executing;
        },
    };

    return agent;
}

export function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, reject, resolve };
}
