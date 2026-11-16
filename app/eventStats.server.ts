import {
    COMBINED_ZONE_SLACK_SECONDS,
    combinedSplitCategories,
    combinedSplitRowsSql,
    insertTimeRangeSql,
    insertTimeRangeValues,
} from "@/app/combinedSummary";
import {EVENT_STATS_CACHE_SECONDS, streamDbRows} from "@/app/data";
import {trimmedStats} from "@/app/trimmedAverage";

const MAX_PLAYERS = 512;
const MAX_WINDOWS = 32;
const MAX_RUNS = 100_000;
// Leave room for the indexed range helper's slack in 64-bit MySQL's FROM_UNIXTIME.
const MAX_UNIX_SECOND = 32_536_771_199 - COMBINED_ZONE_SLACK_SECONDS;
const UUID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i;

type EventWindow = {start: number; end: number};
type EventDefinition = {vanity: string; name: string; windows: EventWindow[]; roster: string[]};
type Split = typeof combinedSplitCategories[number];
type SplitStats = {count: number; avgMs: number | null; bestMs: number | null};
type Stats = {runCount: number; splits: Record<Split, SplitStats>};
type PlayerStats = Stats & {uuid: string; nickname: string | null};

type EventStats = {
    event: Omit<EventDefinition, "roster">;
    players: PlayerStats[];
    overall: Stats;
};

export class EventStatsError extends Error {
    constructor(readonly status: 404 | 422 | 502 | 504, message: string) {
        super(message);
    }
}

const compactUuid = (uuid: string) => uuid.replaceAll("-", "").toLowerCase();
const dashedUuid = (uuid: string) => [
    uuid.slice(0, 8), uuid.slice(8, 12), uuid.slice(12, 16), uuid.slice(16, 20), uuid.slice(20),
].join("-");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const isUnixSecond = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_UNIX_SECOND;

const invalidEvent = () => new EventStatsError(502, "PaceMan returned invalid event data.");

function parseEvent(payload: unknown, vanity: string): EventDefinition {
    if (!isRecord(payload) || !isRecord(payload.event)) throw invalidEvent();
    const {vanity: eventVanity, name, starts, ends, whitelist} = payload.event;
    if (eventVanity !== vanity || typeof name !== "string" || !name.trim() ||
        !Array.isArray(starts) || !Array.isArray(ends) || starts.length === 0 || starts.length !== ends.length ||
        !Array.isArray(whitelist)) {
        throw invalidEvent();
    }
    if (starts.length > MAX_WINDOWS) {
        throw new EventStatsError(422, `Event has more than ${MAX_WINDOWS} play windows.`);
    }
    const windows = starts.map((start, index) => {
        const end: unknown = ends[index];
        if (!isUnixSecond(start) || !isUnixSecond(end) || start >= end) throw invalidEvent();
        return {start, end};
    });
    if (whitelist.length === 0 || whitelist[0] === "TESTING") {
        throw new EventStatsError(422, "Event requires an explicit player whitelist.");
    }
    const roster = new Set<string>();
    for (const uuid of whitelist) {
        if (typeof uuid !== "string" || !UUID_PATTERN.test(uuid)) throw invalidEvent();
        roster.add(compactUuid(uuid));
        if (roster.size > MAX_PLAYERS) {
            throw new EventStatsError(422, `Event has more than ${MAX_PLAYERS} unique players.`);
        }
    }
    return {vanity, name, windows, roster: [...roster]};
}

async function fetchEvent(vanity: string): Promise<EventDefinition> {
    const url = new URL("https://paceman.gg/api/cs/event");
    url.searchParams.set("vanity", vanity);
    const signal = AbortSignal.timeout(3_000);
    try {
        const response = await fetch(url, {cache: "no-store", redirect: "error", signal});
        if (response.status === 400 &&
            (await response.text()).trim() === `Failed to find event with vanity ${vanity}.`) {
            throw new EventStatsError(404, "Event not found.");
        }
        if (!response.ok) throw new EventStatsError(502, "PaceMan could not return the event.");
        return parseEvent(await response.json(), vanity);
    } catch (error) {
        if (error instanceof EventStatsError) throw error;
        if (signal.aborted) throw new EventStatsError(504, "PaceMan event request timed out.");
        throw new EventStatsError(502, "PaceMan could not return the event.");
    }
}

function emptySamples() {
    return {runCount: 0, splits: combinedSplitCategories.map((): number[] => [])};
}

function summarize(samples: ReturnType<typeof emptySamples>): Stats {
    const splits = Object.fromEntries(combinedSplitCategories.map((split, index) => {
        const {count, avg, min} = trimmedStats(samples.splits[index]);
        return [split, {count, avgMs: count ? avg : null, bestMs: count ? min : null}];
    })) as Stats["splits"];
    return {runCount: samples.runCount, splits};
}

export async function getEventStats(vanity: string): Promise<{data: EventStats; expiresAt: number}> {
    const {roster, ...event} = await fetchEvent(vanity);
    const uuids = roster.flatMap(uuid => [uuid, dashedUuid(uuid)]);
    const timeFilters = event.windows.map(() => insertTimeRangeSql("p.insertTime")).join(" OR ");
    const timeValues = event.windows.flatMap(({start, end}) => insertTimeRangeValues(start, end));
    const playerSamples = new Map(roster.map(uuid => [uuid, {
        ...emptySamples(), nickname: null as string | null, nicknameTime: -Infinity, nicknameId: -Infinity,
    }]));
    const overall = emptySamples();

    // Apply the cap before deriving split columns. OR predicates select the
    // union without duplicating runs when two windows overlap.
    await streamDbRows(
        `WITH event_rows AS (
            SELECT p.id, p.uuid, p.nickname, UNIX_TIMESTAMP(p.insertTime) AS runTime,
                p.nether, p.bastion, p.fortress, p.first_portal, p.stronghold, p.\`end\`, p.finish, p.obtainRod
            FROM pace p
            WHERE p.uuid IN (${uuids.map(() => "?").join(", ")}) AND (${timeFilters})
            LIMIT ${MAX_RUNS + 1}
        ), ${combinedSplitRowsSql("event_rows")}
        SELECT id, uuid, nickname, runTime, ${combinedSplitCategories.map(split => `\`${split}\``).join(", ")}
        FROM split_rows;`,
        [...uuids, ...timeValues],
        ([id, storedUuid, nickname, runTime, ...splits]) => {
            if (overall.runCount === MAX_RUNS) {
                throw new EventStatsError(422, `Event has more than ${MAX_RUNS.toLocaleString("en-US")} runs.`);
            }
            const player = playerSamples.get(compactUuid(storedUuid))!;
            overall.runCount++;
            player.runCount++;
            const time = Number(runTime);
            const runId = Number(id);
            if (nickname && (time > player.nicknameTime || (time === player.nicknameTime && runId > player.nicknameId))) {
                player.nickname = nickname;
                player.nicknameTime = time;
                player.nicknameId = runId;
            }
            for (let index = 0; index < splits.length; index++) {
                const value = splits[index];
                if (value === null) continue;
                player.splits[index].push(Number(value));
                overall.splits[index].push(Number(value));
            }
        }
    );
    const players = [...playerSamples].map(([uuid, player]) => ({
        uuid: dashedUuid(uuid), nickname: player.nickname, ...summarize(player),
    }));
    const data = {event, players, overall: summarize(overall)};
    return {data, expiresAt: Date.now() + EVENT_STATS_CACHE_SECONDS * 1_000};
}
