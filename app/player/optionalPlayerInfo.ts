import {clearTimeout, setTimeout} from "node:timers";

/** Header customization must not hold up the statistics on a slow cache miss. */
export async function optionalPlayerInfo<T>(lookup: Promise<T>): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            // Keep a rejection handler attached even if the deadline wins.
            // The existing cached lookup can finish for another request.
            lookup.catch(() => undefined),
            new Promise<undefined>(resolve => {timer = setTimeout(() => resolve(undefined), 100);}),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
