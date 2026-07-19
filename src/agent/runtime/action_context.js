export class ActionContext {
    constructor({ id, generation, label, instincts = {} }) {
        this.id = id;
        this.generation = generation;
        this.label = label;
        this.instincts = instincts;
        this.controller = new AbortController();
        this.cancelReason = null;
        this.cleanupPromise = null;
        this.cleanupReport = null;
        this.timedout = false;
    }

    get signal() {
        return this.controller.signal;
    }

    cancel(reason = 'cancelled') {
        if (this.signal.aborted) return false;
        this.cancelReason = reason;
        this.controller.abort(reason);
        return true;
    }
}
