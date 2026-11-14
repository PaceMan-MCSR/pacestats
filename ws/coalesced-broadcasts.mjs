/** Preserve each UUID's first-event deadline with one timer for the whole queue. */
export class CoalescedBroadcasts {
    constructor(broadcast, delayMs, {now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout,
        defer = setImmediate, cancelDefer = clearImmediate, weightFor = () => 1, budget = 256} = {}) {
        this.broadcast = broadcast;
        this.delayMs = Math.max(0, delayMs);
        this.now = now;
        this.schedule = schedule;
        this.cancel = cancel;
        this.defer = defer;this.cancelDefer = cancelDefer;
        this.weightFor = weightFor;this.budget = budget;
        this.pending = new Map();
        this.timer = null;
        this.continuation = null;this.flushing = false;
    }

    add(uuid, message = 'refresh') {
        const existing = this.pending.get(uuid);
        if (existing) {
            if (message === 'reloadPage') existing.message = message;
            return;
        }
        this.pending.set(uuid, {message, due: this.now() + this.delayMs});
        if (this.timer === null && this.continuation === null && !this.flushing) this.arm();
    }

    arm() {
        const first = this.pending.values().next().value;
        if (!first) return;
        // Map insertion order is deadline order. New UUIDs never postpone an
        // older event, and callbacks can enqueue new events during a flush.
        this.timer = this.schedule(() => {
            this.timer = null;
            this.flush();
        }, Math.max(0, Math.ceil(first.due - this.now())));
        this.timer.unref?.();
    }

    flush() {
        const due = this.now();
        let remaining = this.budget, emitted = false;
        this.flushing = true;
        try {
            for (const [uuid, pending] of this.pending) {
                if (pending.due > due) break;
                const weight = Math.max(1,this.weightFor(uuid));
                if(emitted && weight > remaining) break;
                this.pending.delete(uuid);
                this.broadcast(uuid, pending.message);
                remaining -= weight;emitted = true;
                if(remaining <= 0) break;
            }
        } finally {this.flushing = false;}
        const first = this.pending.values().next().value;
        if(first && first.due <= this.now()) {
            // Preserve FIFO deadlines and allow network I/O between batches.
            // A single configured UUID group remains atomic, as before.
            this.continuation = this.defer(() => {this.continuation = null;this.flush();});
            this.continuation.unref?.();
        } else this.arm();
    }

    clear() {
        if (this.timer !== null) this.cancel(this.timer);
        if (this.continuation !== null) this.cancelDefer(this.continuation);
        this.timer = null;
        this.continuation = null;
        this.pending.clear();
    }
}
