const PREFETCH_INTERVAL_MS = 50;
const PREFETCH_TTL_MS = 30_000;
const MAX_PREFETCHED_PATHS = 64;

type PrefetchTask = {
    path: string;
    prefetch: () => void;
    subscribers: number;
    cancelled: boolean;
};

const prefetchedPaths = new Map<string, number>();
const pendingPaths = new Map<string, PrefetchTask>();
const queue: PrefetchTask[] = [];
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

    while (queue[0]?.cancelled) queue.shift();
    if (queue.length === 0) return;

    const delay = Math.max(0, PREFETCH_INTERVAL_MS - (Date.now() - lastPrefetchAt));
    queueTimer = setTimeout(() => {
        queueTimer = undefined;

        let task: PrefetchTask | undefined;
        while ((task = queue.shift())?.cancelled) {
            // Drop routes that left the viewport before reaching the front.
        }

        if (task && task.subscribers > 0) {
            pendingPaths.delete(task.path);
            rememberPrefetch(task.path);
            lastPrefetchAt = Date.now();
            try {
                task.prefetch();
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
        task = {path, prefetch, subscribers: 1, cancelled: false};
        pendingPaths.set(path, task);
        queue.push(task);
        runQueue();
    }

    let released = false;
    return () => {
        if (released || !task) return;
        released = true;
        task.subscribers -= 1;
        if (task.subscribers === 0 && pendingPaths.get(path) === task) {
            task.cancelled = true;
            pendingPaths.delete(path);
        }
    };
}
