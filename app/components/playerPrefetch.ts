const PREFETCH_INTERVAL_MS = 50;
const PREFETCH_TTL_MS = 30_000;
const MAX_PREFETCHED_PATHS = 64;
const MAX_PENDING_PATHS = 64;

type PrefetchTask = {
    path: string;
    prefetch: () => void;
    subscribers: number;
};

const prefetchedPaths = new Map<string, number>();
const pendingPaths = new Map<string, PrefetchTask>();
let queueTimer: ReturnType<typeof setTimeout> | undefined;
let lastPrefetchAt = 0;

function rememberPrefetch(path: string) {
    const now = Date.now();
    for (const [cachedPath, expiresAt] of prefetchedPaths) {
        if (expiresAt <= now) prefetchedPaths.delete(cachedPath);
    }
    prefetchedPaths.delete(path);
    prefetchedPaths.set(path, now + PREFETCH_TTL_MS);
    while (prefetchedPaths.size > MAX_PREFETCHED_PATHS) {
        const oldest = prefetchedPaths.keys().next().value;
        if (oldest === undefined) break;
        prefetchedPaths.delete(oldest);
    }
}

function runQueue() {
    if (queueTimer !== undefined) return;

    if (pendingPaths.size === 0) return;

    const delay = Math.max(0, PREFETCH_INTERVAL_MS - (Date.now() - lastPrefetchAt));
    queueTimer = setTimeout(() => {
        queueTimer = undefined;

        const task = pendingPaths.values().next().value;

        if (task && task.subscribers > 0) {
            pendingPaths.delete(task.path);
            lastPrefetchAt = Date.now();
            try {
                task.prefetch();
                rememberPrefetch(task.path);
            } catch {
                // Speculative work may be tried again on the next intent.
            } finally {
                runQueue();
            }
            return;
        }

        runQueue();
    }, delay);
}

export function schedulePlayerPrefetch(path: string, prefetch: () => void) {
    if ((prefetchedPaths.get(path) ?? 0) > Date.now()) return () => {};

    let task = pendingPaths.get(path);
    if (task) {
        task.subscribers += 1;
    } else {
        // This is tentative search preparation. Strong hover/keyboard intent
        // bypasses this queue; omitted paths remain eligible on the next call.
        if (pendingPaths.size >= MAX_PENDING_PATHS) return () => {};
        task = {path, prefetch, subscribers: 1};
        pendingPaths.set(path, task);
        runQueue();
    }

    let released = false;
    return () => {
        if (released || !task) return;
        released = true;
        task.subscribers -= 1;
        if (task.subscribers === 0 && pendingPaths.get(path) === task) {
            pendingPaths.delete(path);
            if (pendingPaths.size === 0) {
                clearTimeout(queueTimer);
                queueTimer = undefined;
            }
        }
    };
}
