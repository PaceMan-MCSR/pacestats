import type {PlayerInfo} from "./playerInfoCache";

type Pending = {attempt: number; readyAt: number};
type Batch = {names: Map<string, Pending>; controller: AbortController};
type Options = {
    needed: (name: string) => boolean;
    lookup: (name: string) => PlayerInfo | null | undefined;
    store: (name: string, info: PlayerInfo | null) => void;
    fetch: (names: string[], signal: AbortSignal) => Promise<Record<string, PlayerInfo | null>>;
};

/** Coalesce visible identities without allowing slow requests to accumulate. */
export class PlayerInfoRequests {
    private pending = new Map<string, Pending>();
    private active = new Set<Batch>();
    private activeNames = new Map<string, Batch>();
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private options: Options) {}

    request(name: string) {
        if (!this.needs(name) || this.pending.has(name) || this.activeNames.has(name)) return;
        this.pending.set(name, {attempt: 0, readyAt: Date.now() + 20});
        this.schedule();
    }

    // A page seed supersedes an older request. A departing row also releases
    // its queued identity immediately, and an entirely orphaned batch aborts.
    cancel(name: string) {
        this.pending.delete(name);
        const batch = this.activeNames.get(name);
        if (batch) {
            batch.names.delete(name);
            this.activeNames.delete(name);
            if (batch.names.size === 0) batch.controller.abort();
        }
        this.schedule();
    }

    private needs(name: string) {
        return this.options.needed(name) && this.options.lookup(name) === undefined;
    }

    private schedule() {
        clearTimeout(this.timer);
        this.timer = undefined;
        if (this.active.size >= 2) return;
        let next = Infinity;
        for (const [name, pending] of this.pending) {
            if (!this.needs(name)) this.pending.delete(name);
            else next = Math.min(next, pending.readyAt);
        }
        if (next !== Infinity) this.timer = setTimeout(() => this.flush(), Math.max(0, next - Date.now()));
    }

    private flush() {
        this.timer = undefined;
        const now = Date.now();
        while (this.active.size < 2) {
            const names = new Map<string, Pending>();
            for (const [name, pending] of this.pending) {
                if (!this.needs(name)) this.pending.delete(name);
                else if (pending.readyAt <= now) {
                    this.pending.delete(name);
                    names.set(name, pending);
                    if (names.size === 20) break;
                }
            }
            if (names.size === 0) break;
            const batch = {names, controller: new AbortController()};
            this.active.add(batch);
            for (const name of names.keys()) this.activeNames.set(name, batch);
            void this.run(batch);
        }
        this.schedule();
    }

    private async run(batch: Batch) {
        const timeout = setTimeout(() => batch.controller.abort(), 8_000);
        try {
            const result = await this.options.fetch([...batch.names.keys()], batch.controller.signal);
            if (!batch.controller.signal.aborted) {
                for (const name of batch.names.keys()) {
                    if (this.needs(name)) this.options.store(name, result[name] ?? null);
                }
            }
        } catch {
            // One delayed retry recovers a transient failure for rows that
            // remain visible; an outage cannot create an endless retry loop.
            for (const [name, pending] of batch.names) {
                if (pending.attempt === 0 && this.needs(name)) {
                    this.pending.set(name, {attempt: 1, readyAt: Date.now() + 1_000});
                }
            }
        } finally {
            clearTimeout(timeout);
            this.active.delete(batch);
            for (const name of batch.names.keys()) this.activeNames.delete(name);
            this.schedule();
        }
    }
}
