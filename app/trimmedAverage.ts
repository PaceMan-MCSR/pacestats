/**
 * Outlier-trimmed statistics shared by the API routes and the cache jobs.
 *
 * A series with 50 or more values drops its slowest 2% before averaging. The
 * kept values are never sorted: one pass adds up every value while a small
 * min-heap tracks only the slowest 2%, and the heap's total is subtracted at
 * the end. Split times are non-negative integer milliseconds, so every partial
 * sum is exact and the result is bit-for-bit the same as sorting the series
 * and adding up its fastest 98%.
 */

export interface TrimmedStats {
    /** Number of values in the series. */
    count: number;
    /** Number of values that remain after the slowest 2% are dropped. */
    kept: number;
    /** Total of the kept values. */
    sum: number;
    /** Average of the kept values, or 0 for an empty series. */
    avg: number;
    /** Fastest value in the series, or 0 for an empty series. */
    min: number;
}

/** How many of a series' fastest values count towards its average. */
export function keptCount(length: number): number {
    return length >= 50 ? Math.floor(length * 0.98) : length;
}

// Scratch space for the slowest values. The function below is synchronous, so
// one buffer can be reused by every call.
let slowest = new Float64Array(64);

function siftDown(heap: Float64Array, size: number, start: number): void {
    const value = heap[start];
    let index = start;
    while (true) {
        let child = 2 * index + 1;
        if (child >= size) break;
        if (child + 1 < size && heap[child + 1] < heap[child]) child++;
        if (heap[child] >= value) break;
        heap[index] = heap[child];
        index = child;
    }
    heap[index] = value;
}

/**
 * Reference implementation: sort a copy and add up the fastest values. It also
 * serves any series the single-pass path cannot total exactly.
 */
export function trimmedStatsBySorting(data: ArrayLike<number>): TrimmedStats {
    const count = data.length;
    if (count === 0) return {count: 0, kept: 0, sum: 0, avg: 0, min: 0};
    const sorted = Array.from(data).sort((a, b) => a - b);
    const kept = keptCount(count);
    let sum = 0;
    for (let index = 0; index < kept; index++) sum += sorted[index];
    return {count, kept, sum, avg: sum / kept || 0, min: sorted[0]};
}

export function trimmedStats(data: ArrayLike<number> | null | undefined): TrimmedStats {
    if (!data || data.length === 0) return {count: 0, kept: 0, sum: 0, avg: 0, min: 0};
    const count = data.length;
    const kept = keptCount(count);
    const dropped = count - kept;
    let total = 0;
    let droppedTotal = 0;
    let min = Infinity;
    let exact = true;

    if (dropped === 0) {
        for (let index = 0; index < count; index++) {
            const value = data[index];
            if (!(value >= 0 && value === Math.floor(value))) exact = false;
            total += value;
            if (value < min) min = value;
        }
    } else {
        if (slowest.length < dropped) slowest = new Float64Array(Math.max(dropped, slowest.length * 2));
        const heap = slowest;
        for (let index = 0; index < dropped; index++) {
            const value = data[index];
            if (!(value >= 0 && value === Math.floor(value))) exact = false;
            total += value;
            if (value < min) min = value;
            heap[index] = value;
            droppedTotal += value;
        }
        for (let index = (dropped >> 1) - 1; index >= 0; index--) siftDown(heap, dropped, index);
        for (let index = dropped; index < count; index++) {
            const value = data[index];
            if (!(value >= 0 && value === Math.floor(value))) exact = false;
            total += value;
            if (value < min) min = value;
            // heap[0] is the fastest of the slowest values seen so far.
            if (value > heap[0]) {
                droppedTotal += value - heap[0];
                heap[0] = value;
                siftDown(heap, dropped, 0);
            }
        }
    }

    // Fractional, negative, non-numeric, or enormous values could round
    // differently when totalled in a different order, so sort those instead.
    if (!exact || total > Number.MAX_SAFE_INTEGER) return trimmedStatsBySorting(data);
    const sum = total - droppedTotal;
    return {count, kept, sum, avg: sum / kept || 0, min};
}

/** Average of a series without its slowest 2% (when it has 50+ values). */
export function calculateAvg(data: ArrayLike<number> | null | undefined): number {
    return trimmedStats(data).avg;
}
