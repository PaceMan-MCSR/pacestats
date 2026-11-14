/** Keep the newest drag value without committing more than once per paint. */
export function frameValue<T>(commit: (value: T) => void,
    request: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback),
    cancelFrame: (id: number) => void = id => cancelAnimationFrame(id)) {
    let frame: number | null = null;
    let pending: T;
    const cancel = () => {
        if (frame !== null) cancelFrame(frame);
        frame = null;
    };
    const flush = () => {
        if (frame === null) return;
        cancel();
        commit(pending);
    };
    return {
        schedule(value: T) {
            pending = value;
            if (frame === null) frame = request(flush);
        },
        immediately(value: T) { cancel(); commit(value); },
        flush,
        cancel,
    };
}
