/**
 * Precomputed split summaries for the combined endpoints.
 *
 * getCombinedStats/getCombinedNethers without a session gap average every run
 * of several players in a window, dropping the slowest 2% of the union. For a
 * long window that meant streaming every row from MySQL on each request. The
 * run-history job (scripts/recent.ts) instead keeps, per player and per fixed
 * 30-day bucket of insertTime, each split's count, total and slowest values.
 * A request adds up the buckets that lie wholly inside its window, reads only
 * the rows outside them from MySQL (the window's edge and the newest, still
 * open period) and takes the union's slowest 2% from the stored tails.
 *
 * The result is exact: a bucket whose stored tail is too short to settle the
 * union's slowest values is read from MySQL instead, as is every bucket of a
 * player whose older rows changed since the job last looked.
 */

import {keptCount, type TrimmedStats} from "./trimmedAverage";

export const COMBINED_SUMMARY_VERSION = 1;
export const COMBINED_BUCKET_SECONDS = 30 * 86_400;
/** A bucket is summarised once it has been over for this long; runs settle within an hour. */
export const COMBINED_SETTLE_SECONDS = 6 * 3_600;
/** Deletions recorded by the aggregate triggers are honoured for this long after their timestamp. */
export const COMBINED_DELETE_OVERLAP_SECONDS = 300;
/** Requests ignore the summaries when the job has not confirmed them for this long. */
export const COMBINED_MAX_STALENESS_SECONDS = 900;
/**
 * Timestamp comparisons are written as exact Unix-time tests plus a range
 * this much wider on the column itself, so the index is usable whatever the
 * session time zone does around a clock change.
 */
export const COMBINED_ZONE_SLACK_SECONDS = 7_200;

export const COMBINED_STATE_KEY = "cache:combined:state";
export const COMBINED_KEY_PREFIX = "combinedSplits:";
export const combinedSummaryKey = (uuid: string) => `${COMBINED_KEY_PREFIX}${uuid}`;
/** Hash field with the largest row id the player's summaries cover. */
export const COMBINED_MAX_ID_FIELD = "m";

export const combinedSplitCategories = [
    "nether",
    "bastion",
    "fortress",
    "first_structure",
    "second_structure",
    "first_portal",
    "stronghold",
    "end",
    "finish",
] as const;

/**
 * CTEs deriving the nine combined splits from `source`, a CTE or table with
 * id, nether, bastion, fortress, first_portal, stronghold, end, finish and
 * obtainRod. Select `combinedSplitCategories` from `split_rows`.
 */
export const combinedSplitRowsSql = (source: string) => `structured AS (
            SELECT ${source}.*,
                CASE
                    WHEN bastion IS NULL AND fortress IS NULL THEN NULL
                    WHEN bastion IS NULL THEN fortress
                    WHEN fortress IS NULL THEN bastion
                    WHEN bastion <= fortress THEN bastion
                    ELSE fortress
                END AS firstStructure,
                CASE
                    WHEN bastion IS NULL OR fortress IS NULL THEN NULL
                    WHEN bastion <= fortress THEN fortress
                    ELSE bastion
                END AS secondStructure
            FROM ${source}
        ), split_rows AS (
            SELECT structured.*,
                CASE
                    WHEN firstStructure=fortress AND NULLIF(obtainRod, 0) IS NOT NULL
                        AND NULLIF(obtainRod, 0) < fortress THEN obtainRod
                    ELSE firstStructure
                END AS first_structure,
                CASE
                    WHEN secondStructure IS NULL THEN NULL
                    WHEN id >= 187307 AND (
                        (secondStructure=bastion AND (
                            NULLIF(obtainRod, 0) IS NULL OR NULLIF(obtainRod, 0) > secondStructure
                        ))
                        OR (secondStructure=fortress AND fortress-bastion < 50000)
                    ) THEN NULL
                    WHEN secondStructure=fortress AND NULLIF(obtainRod, 0) IS NOT NULL
                        AND NULLIF(obtainRod, 0) < fortress THEN obtainRod
                    ELSE secondStructure
                END AS second_structure
            FROM structured
        )`;

/** Rows whose Unix insertTime lies in [from, to), in a form that can use an insertTime index. */
export const insertTimeRangeSql = (column = "insertTime") =>
    `(${column} >= FROM_UNIXTIME(?) AND ${column} < FROM_UNIXTIME(?)
        AND UNIX_TIMESTAMP(${column}) >= ? AND UNIX_TIMESTAMP(${column}) < ?)`;
export const insertTimeRangeValues = (from: number, to: number) => [
    Math.max(0, from - COMBINED_ZONE_SLACK_SECONDS), to + COMBINED_ZONE_SLACK_SECONDS, from, to,
];

export const bucketOf = (unixSeconds: number) => Math.floor(unixSeconds / COMBINED_BUCKET_SECONDS);
export const bucketStart = (bucket: number) => bucket * COMBINED_BUCKET_SECONDS;
/** The newest bucket that may be summarised at `nowSeconds`, or -1. */
export const closableBucket = (nowSeconds: number) =>
    bucketOf(nowSeconds - COMBINED_SETTLE_SECONDS) - 1;

/**
 * One split of one bucket: [count, total, slowest values in descending
 * order]. The tail holds every value of a short series, so only long series
 * hide values, all of them at most the tail's last entry.
 */
export type SplitSummary = [number, number, number[]];
export type BucketSummary = SplitSummary[];

export const tailDepth = (count: number) => count <= 64 ? count : Math.max(64, Math.ceil(count * 0.5));

export function summarizeSplit(values: number[]): SplitSummary {
    let total = 0;
    for (let index = 0; index < values.length; index++) total += values[index];
    const depth = tailDepth(values.length);
    const sorted = Float64Array.from(values).sort();
    const tail = new Array<number>(depth);
    for (let index = 0; index < depth; index++) tail[index] = sorted[sorted.length - 1 - index];
    return [values.length, total, tail];
}

/** Collects one bucket's split values row by row. */
export class BucketAccumulator {
    readonly splits: number[][] = combinedSplitCategories.map(() => []);
    maxId = 0;

    /** `values` holds the nine splits in combinedSplitCategories order, starting at `offset`. */
    add(id: number, values: ArrayLike<unknown>, offset: number) {
        if (id > this.maxId) this.maxId = id;
        for (let index = 0; index < this.splits.length; index++) {
            const value = values[offset + index];
            if (value !== null && value !== undefined) this.splits[index].push(Number(value));
        }
    }

    summary(): BucketSummary {
        return this.splits.map(summarizeSplit);
    }
}

/** A stored split summary taking part in a union, identified by `ref` for fallbacks. */
export type SummaryPart<Ref> = {ref: Ref; summary: SplitSummary};

export type UnionResult<Ref> =
    | {stats: TrimmedStats; insufficient?: undefined}
    | {stats?: undefined; insufficient: Ref[]};

// Scratch min-heap for the union's slowest values (synchronous use only).
let heap = new Float64Array(1_024);

const siftDown = (size: number, start: number) => {
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
};

/**
 * Trimmed statistics of the union of stored summaries and individually known
 * values (`live`), counting only values up to `maxValue`. Returns the parts
 * that must be read in full when their stored tails cannot settle the result:
 * a part hides values only below its tail's last entry, so the union's
 * slowest values are known exactly unless that entry lies above the cut.
 */
export function unionTrimmedStats<Ref>(
    parts: Array<SummaryPart<Ref>>,
    live: ArrayLike<number>,
    maxValue = Number.POSITIVE_INFINITY,
): UnionResult<Ref> {
    const insufficient: Ref[] = [];
    let count = 0;
    let total = 0;
    let candidates = 0;
    // Per usable part: the first tail index at or below maxValue.
    const skips = new Array<number>(parts.length);
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const [partCount, partTotal, tail] = parts[partIndex].summary;
        let skip = 0;
        let skippedTotal = 0;
        while (skip < tail.length && tail[skip] > maxValue) skippedTotal += tail[skip++];
        if (skip === tail.length && tail.length < partCount) {
            // Every stored value exceeds maxValue and more are hidden.
            insufficient.push(parts[partIndex].ref);
            skips[partIndex] = -1;
            continue;
        }
        skips[partIndex] = skip;
        count += partCount - skip;
        total += partTotal - skippedTotal;
        candidates += tail.length - skip;
    }
    for (let index = 0; index < live.length; index++) total += live[index];
    count += live.length;
    candidates += live.length;
    if (insufficient.length > 0) return {insufficient};

    const kept = keptCount(count);
    const dropped = count - kept;
    if (dropped === 0) return {stats: {count, kept, sum: total, avg: total / kept || 0, min: 0}};

    // The slowest `dropped` values among everything known, in a min-heap.
    if (heap.length < dropped) heap = new Float64Array(Math.max(dropped, heap.length * 2));
    let size = 0;
    let droppedTotal = 0;
    const offer = (value: number) => {
        if (size < dropped) {
            heap[size++] = value;
            droppedTotal += value;
            if (size === dropped) {
                for (let index = (dropped >> 1) - 1; index >= 0; index--) siftDown(dropped, index);
            }
        } else if (value > heap[0]) {
            droppedTotal += value - heap[0];
            heap[0] = value;
            siftDown(dropped, 0);
        }
    };
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const tail = parts[partIndex].summary[2];
        for (let index = skips[partIndex]; index < tail.length; index++) {
            // Tails are descending: once one value misses the heap, the rest do too.
            if (size === dropped && tail[index] <= heap[0]) break;
            offer(tail[index]);
        }
    }
    for (let index = 0; index < live.length; index++) offer(live[index]);

    // With fewer known values than the cut needs, every hidden value matters.
    const cut = size === dropped ? heap[0] : Number.NEGATIVE_INFINITY;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const [partCount, , tail] = parts[partIndex].summary;
        if (tail.length < partCount && tail[tail.length - 1] > cut) insufficient.push(parts[partIndex].ref);
    }
    if (insufficient.length > 0) return {insufficient};
    const sum = total - droppedTotal;
    return {stats: {count, kept, sum, avg: sum / kept || 0, min: 0}};
}
