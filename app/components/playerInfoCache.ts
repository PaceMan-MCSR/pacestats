export type PlayerInfo = {
    id: string;
    displayName: string | null;
    color: string | null;
    bgColor: string | null;
};

const sameInfo = (left: PlayerInfo | null, right: PlayerInfo | null) => left === right
    || (left !== null && right !== null && left.id === right.id && left.displayName === right.displayName
        && left.color === right.color && left.bgColor === right.bgColor);

/** Retain only a bounded history plus identities still displayed by the UI. */
export class PlayerInfoCache {
    private values = new Map<string, PlayerInfo | null>();
    private listeners = new Map<string, Set<() => void>>();
    constructor(private capacity = 256) {}

    get size() { return this.values.size; }
    get(name: string) { return this.values.get(name); }
    hasSubscribers(name: string) { return this.listeners.has(name); }

    set(name: string, info: PlayerInfo | null) {
        const previous = this.values.get(name);
        if (previous !== undefined && sameInfo(previous, info)) return;
        this.values.delete(name);
        this.values.set(name, info);
        this.trim();
        this.listeners.get(name)?.forEach(listener => listener());
    }

    subscribe(name: string, listener: () => void) {
        let subscribers = this.listeners.get(name);
        if (!subscribers) {
            subscribers = new Set();
            this.listeners.set(name, subscribers);
        }
        subscribers.add(listener);
        return () => {
            subscribers.delete(listener);
            if (subscribers.size === 0) this.listeners.delete(name);
            this.trim();
        };
    }

    private trim() {
        if (this.values.size <= this.capacity) return;
        for (const name of this.values.keys()) {
            // Evicting a mounted identity would turn its snapshot unknown
            // and repeatedly refetch it while it is still on screen.
            if (this.listeners.has(name)) continue;
            this.values.delete(name);
            if (this.values.size <= this.capacity) break;
        }
    }
}
