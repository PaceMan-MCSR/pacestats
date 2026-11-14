type ClockGroup = {
    callbacks: Set<() => void>;
    timer?: ReturnType<typeof setInterval>;
};

// Hundreds of displayed runs share only the few refresh rates the relative
// formatter uses. Hidden tabs do no timer work; returning refreshes once.
const groups = new Map<number, ClockGroup>();

function startGroup(delay: number, group: ClockGroup) {
    if (group.timer !== undefined || document.visibilityState === 'hidden') return;
    group.timer = setInterval(() => group.callbacks.forEach((callback) => callback()), delay);
}

function updateVisibility() {
    groups.forEach((group, delay) => {
        clearInterval(group.timer);
        group.timer = undefined;
        if (document.visibilityState !== 'hidden') {
            group.callbacks.forEach((callback) => callback());
            startGroup(delay, group);
        }
    });
}

export function subscribeRelativeClock(callback: () => void, delay: number) {
    if (groups.size === 0) document.addEventListener('visibilitychange', updateVisibility);
    let group = groups.get(delay);
    if (!group) {
        group = {callbacks: new Set()};
        groups.set(delay, group);
    }
    group.callbacks.add(callback);
    startGroup(delay, group);

    return () => {
        group.callbacks.delete(callback);
        if (group.callbacks.size === 0) {
            clearInterval(group.timer);
            groups.delete(delay);
        }
        if (groups.size === 0) document.removeEventListener('visibilitychange', updateVisibility);
    };
}
