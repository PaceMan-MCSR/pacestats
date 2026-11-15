import {CategoryType, getMinAAQty} from "@/app/utils";

export const aaPlayerStatCategories = [
    "nether", "bastion", "fortress", "stronghold", "end", "elytra", "credits", "finish",
] as const;
const filters = [CategoryType.AVG, CategoryType.COUNT, CategoryType.FASTEST, CategoryType.CONVERSION];
export const aaPlayerStatBranches = filters.flatMap(filter => aaPlayerStatCategories.map(category => ({
    filter, category, path: `$.${filter}.${category}[*]["uuid","qty","value"]`,
})));

export type AAPlayerStats = Record<string, Record<number, {ranking: number; value: number}>>;
export type AAPlayerStatProjection = Record<string, Array<[uuid: string, qty: number, value: number]>>;
type Entry = {uuid: string; qty: number; value: number};

/** The row counts detect omitted properties, including completely empty rows. */
export function parseAAPlayerStatProjection(raw: unknown, lengths: unknown): AAPlayerStatProjection {
    const projection: unknown = JSON.parse(String(raw));
    if (!projection || typeof projection !== "object" || Array.isArray(projection)
        || !Array.isArray(lengths) || lengths.length !== aaPlayerStatBranches.length
        || lengths.some(length => !Number.isSafeInteger(length) || length < 0)) {
        throw new Error("Incomplete AA leaderboard projection");
    }
    let projectedValues = 0;
    const result: AAPlayerStatProjection = {};
    for (const {path} of aaPlayerStatBranches) {
        const rows: unknown = (projection as Record<string, unknown>)[path];
        if (!Array.isArray(rows) || rows.length % 3 !== 0) throw new Error("Incomplete AA leaderboard projection");
        const entries: AAPlayerStatProjection[string] = [];
        for (let index = 0; index < rows.length; index += 3) {
            if (typeof rows[index] !== "string" || typeof rows[index + 1] !== "number"
                || typeof rows[index + 2] !== "number") throw new Error("Incomplete AA leaderboard projection");
            entries.push([rows[index], rows[index + 1], rows[index + 2]]);
        }
        // One tuple remains one row under the existing cache retention budget,
        // so a smaller projection does not lose cacheability at a third of the
        // old complete-board row limit.
        result[path] = entries;
        projectedValues += rows.length;
    }
    if (projectedValues !== lengths.reduce((total, length) => total + length, 0) * 3) {
        throw new Error("Incomplete AA leaderboard projection");
    }
    return result;
}

const emptyStats = (): AAPlayerStats => Object.fromEntries(aaPlayerStatCategories.map(category => [category, {}]));

/** Preserve source ordering, including ties and below-minimum unranked values. */
export function aaPlayerStatsFromProjection(projection: AAPlayerStatProjection, uuid: string, days: number): AAPlayerStats {
    const stats = emptyStats();
    for (const {filter, category, path} of aaPlayerStatBranches) {
        const rows = projection[path];
        const minimum = getMinAAQty(category, days);
        let ranking = 0;
        for (const [id, qty, value] of rows) {
            if (qty === 0 || (qty < minimum && id !== uuid)) continue;
            ranking++;
            if (id === uuid) {
                stats[category][filter] = {ranking: qty < minimum ? -1 : ranking, value};
                break;
            }
        }
    }
    return stats;
}

/** The existing complete-board/SQL fallback keeps its exact ranking behavior. */
export function aaPlayerStatsFromLeaderboard(leaderboards: Record<number, Record<string, Entry[]>>, uuid: string, days: number): AAPlayerStats {
    const stats = emptyStats();
    for (const {filter, category} of aaPlayerStatBranches) {
        const minimum = getMinAAQty(category, days);
        let ranking = 0;
        for (const entry of leaderboards[filter][category]) {
            if (entry.qty === 0 || (entry.qty < minimum && entry.uuid !== uuid)) continue;
            ranking++;
            if (entry.uuid === uuid) {
                stats[category][filter] = {ranking: entry.qty < minimum ? -1 : ranking, value: entry.value};
                break;
            }
        }
    }
    return stats;
}
