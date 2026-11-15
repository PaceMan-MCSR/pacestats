/** Host-safe export regressions: real parser/route/SQL modules, mocked database and identities. */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createContext, runInContext} from "node:vm";
import {NextRequest, NextResponse} from "next/server";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
type Modules = Record<string, unknown>;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const compiled = new Map<string, string>();
const canonicalUuid = "01234567-89ab-cdef-0123-456789abcdef";
const expectedStatsSplits = {
    netherMs: "nether", bastionMs: "bastion", fortressMs: "fortress", firstPortalMs: "first_portal", secondPortalMs: "second_portal",
    strongholdMs: "stronghold", endMs: "end", finishMs: "finish", netherRtaMs: "netherRta", bastionRtaMs: "bastionRta",
    fortressRtaMs: "fortressRta", firstPortalRtaMs: "first_portalRta", secondPortalRtaMs: "second_portalRta",
    strongholdRtaMs: "strongholdRta", endRtaMs: "endRta", finishRtaMs: "finishRta", obtainIronMs: "obtainIron",
    obtainPickMs: "obtainPick", obtainLavaMs: "obtainLava", distractPiglinMs: "distractPiglin", lootBastionMs: "lootBastion",
    obtainObsidianMs: "obtainObsidian", obtainCryingObsidianMs: "obtainCryingObsidian", obtainRodMs: "obtainRod",
};

function modules(overrides: Modules = {}) {
    const cache = new Map<string, Record<string, any>>();
    const context = createContext({Buffer, Date, URL, URLSearchParams, Response, Headers, Request, console});
    const load = (path: string): Record<string, any> => {
        if (cache.has(path)) return cache.get(path)!;
        const exports: Record<string, any> = {};
        cache.set(path, exports);
        let source = compiled.get(path);
        if (!source) {
            source = ts.transpileModule(readFileSync(resolve(root, path), "utf8"), {compilerOptions: {
                module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
            }}).outputText;
            compiled.set(path, source);
        }
        const evaluate = runInContext(`(function(exports, require) {${source}\n})`, context);
        evaluate(exports, (name: string) => {
            if (Object.hasOwn(overrides, name)) return overrides[name];
            if (name === "next/server") return {NextRequest, NextResponse};
            if (name === "node:crypto") return crypto;
            if (name === "@/app/telemetry.server") return {observeApiRequest: (_name: string, handler: unknown) => handler};
            const appModule = name.startsWith("@/") ? `${name.slice(2)}.ts`
                : name.startsWith(".") ? resolve(root, path, "..", `${name}.ts`).slice(root.length + 1).replaceAll("\\", "/") : null;
            if (appModule) return load(appModule);
            throw new Error(`Unmocked export dependency: ${name}`);
        });
        return exports;
    };
    return {load};
}

function verifyParameters() {
    const fixture = modules(), model = fixture.load("app/playerExport.ts");
    const {ApiInputError} = fixture.load("app/api/_utils.ts");
    const parse = (query: string, now?: number) => model.parsePlayerExportParams(new URLSearchParams(query), now);
    const defaults = parse("", Date.parse("2026-11-15T13:45:00Z"));
    assert.equal(defaults.fromDate, "1970-01-01");
    assert.equal(defaults.toDate, "2026-11-16", "Default dates use UTC despite the local calendar already being the next day");
    assert.equal(defaults.from, 0);
    assert.equal(defaults.to, Date.parse("2026-11-16T00:00:00Z") / 1000);
    assert.equal(defaults.mode, "daily");
    assert.equal(defaults.format, "json");
    assert.equal(defaults.limit, 1000);
    assert.equal(defaults.cursor, null);
    const historical = parse("from=2023-01-01&to=2025-02-01&mode=records&format=csv&limit=5000");
    assert.equal(historical.from, Date.parse("2023-01-01T00:00:00Z") / 1000);
    assert.equal(historical.to, Date.parse("2025-02-01T00:00:00Z") / 1000);
    assert.equal(historical.to - historical.from, 762 * 86400, "Long exports are not restricted to the live API's 90-day lookback");
    assert.equal(historical.mode, "records");
    assert.equal(historical.format, "csv");
    assert.equal(historical.limit, 5000);
    assert.equal(parse("from=2024-02-29&to=2024-03-01").to - parse("from=2024-02-29&to=2024-03-01").from, 86400);
    const badQueries = [
        "from=2023-02-29", "from=2024-02-30", "from=2024-13-01", "from=2024-1-01",
        "from=2024-01-01T00%3A00%3A00Z", "from=1969-12-31", "to=not-a-date", "from=2025-01-01&to=2025-01-01",
        "from=2025-01-02&to=2025-01-01", "mode=summary", "format=xlsx", "limit=0",
        "limit=5001", "limit=1.5", "limit=NaN", "cursor=not-base64-json", "limit=10", "cursor=",
    ];
    for (const query of badQueries) assert.throws(() => parse(query), error => error instanceof ApiInputError, query);
    assert.throws(() => parse("to=2026-11-17", Date.parse("2026-11-15T13:45:00Z")), error => error instanceof ApiInputError);
    const cursor = model.encodeExportCursor({time: 1704110400, id: 3});
    assert.match(cursor, /^[\w-]+$/);
    assert.deepEqual(plain(parse(`mode=records&from=2024-01-01&to=2024-01-02&cursor=${cursor}`).cursor), {time: 1704110400, id: 3});
    for (const value of [[], [1704110400, 0], [1704110400, -1], [1704110400.5, 3], ["1704110400", 3],
        [1704110400, 3, 4], {time: 1704110400, id: 3}, [1704110400, Number.MAX_SAFE_INTEGER + 1], [0, 3]]) {
        const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
        assert.throws(() => parse(`mode=records&from=2024-01-01&to=2024-01-02&cursor=${encoded}`), error => error instanceof ApiInputError);
    }
    return {model, parse};
}

function verifyPlayerSelectors() {
    const fixture = modules(), {parseExportPlayer} = fixture.load("app/playerExport.ts");
    const {ApiInputError} = fixture.load("app/api/_utils.ts");
    const parse = (query: string) => plain(parseExportPlayer(new URLSearchParams(query)));
    assert.deepEqual(parse("name=%20KnownPlayer%20"), {name: "KnownPlayer", uuid: null});
    assert.deepEqual(parse(`uuid=${canonicalUuid}`), {name: null, uuid: canonicalUuid});
    for (const value of [canonicalUuid.toUpperCase(), canonicalUuid.replaceAll("-", ""), `  ${canonicalUuid.toUpperCase()}  `]) {
        assert.deepEqual(parse(new URLSearchParams({uuid: value}).toString()), {name: null, uuid: canonicalUuid});
    }
    for (const query of ["", "name=", "uuid=", "name=%20&uuid=%20", `name=KnownPlayer&uuid=${canonicalUuid}`,
        `name=%20&uuid=${canonicalUuid}`, "name=KnownPlayer&uuid=%20",
        "uuid=not-a-uuid", "uuid=0123456789abcdef0123456789abcde", "uuid=0123456789abcdef0123456789abcdef0",
        "uuid=01234567-89ab-cdef-01234567-89abcdef", "uuid=01234567-89ab-cdef-0123-456789abcdeg", `name=${"x".repeat(65)}`]) {
        assert.throws(() => parse(query), error => error instanceof ApiInputError, query);
    }
}

async function verifyUuidIdentitySqlAndSharedNameCache() {
    const storedUuid = canonicalUuid.replaceAll("-", "").toUpperCase();
    const fixture = (options: {rows: {uuid: string; nickname: string | null}[]; bans?: string[]; cachedName?: Promise<string | null>} ) => {
        const queries: {sql: string; values: unknown[]}[] = [], cacheCalls: {name: string; args: unknown[]}[] = [];
        const cache = new Map<string, Promise<unknown>>();
        if (options.cachedName) cache.set(JSON.stringify(["getNick", storedUuid]), options.cachedName);
        const data = {
            getConn: async () => ({execute: async (sql: string, values: unknown[]) => {
                queries.push({sql, values});
                return [options.rows, []];
            }}),
            getBans: async () => options.bans ?? [],
            getCached: async (producer: (...args: unknown[]) => Promise<unknown>, name: string, ...args: unknown[]) => {
                cacheCalls.push({name, args});
                const key = JSON.stringify([name, ...args]);
                if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => producer(...args)));
                return cache.get(key);
            },
        };
        const server = modules({"./data": data}).load("app/playerExport.server.ts");
        return {lookup: server.getExportPlayerByUuid as (uuid: string) => Promise<{uuid: string; nick: string | null} | null>, queries, cacheCalls};
    };
    const current = fixture({rows: [{uuid: storedUuid, nickname: "CurrentNickname"}]});
    assert.deepEqual(plain(await current.lookup(canonicalUuid)), {uuid: storedUuid, nick: "CurrentNickname"});
    assert.deepEqual(plain(current.queries[0].values), [canonicalUuid, canonicalUuid.replaceAll("-", "")]);
    assert.match(current.queries[0].sql, /UNION ALL/);
    assert.equal((current.queries[0].sql.match(/WHERE uuid=\? ORDER BY id DESC LIMIT 1/g) ?? []).length, 2,
        "Both UUID spellings use an independently bounded indexed identity lookup");
    assert.match(current.queries[0].sql, /identities ORDER BY id DESC LIMIT 1/);
    assert.ok(!current.queries[0].sql.includes(canonicalUuid), "User UUID input is bound rather than interpolated into SQL");
    assert.deepEqual(current.cacheCalls.map(call => call.name), ["getBans", "getNick"]);
    assert.deepEqual(plain(current.cacheCalls.at(-1)!.args), [storedUuid], "UUID and name resolution share the stored UUID's getNick cache");
    const cached = fixture({rows: [{uuid: storedUuid, nickname: "NewSqlNickname"}], cachedName: Promise.resolve("EarlierCachedNickname")});
    assert.deepEqual(plain(await cached.lookup(canonicalUuid)), {uuid: storedUuid, nick: "EarlierCachedNickname"},
        "Existing cached/in-flight name reads retain precedence over the row selected by UUID lookup");
    const unknown = fixture({rows: []});
    assert.equal(await unknown.lookup(canonicalUuid), null);
    assert.equal(unknown.cacheCalls.length, 0, "Unknown UUIDs need no ban or nickname reads");
    const banned = fixture({rows: [{uuid: storedUuid, nickname: "BannedPlayer"}], bans: [storedUuid]});
    assert.equal(await banned.lookup(canonicalUuid), null);
    assert.deepEqual(banned.cacheCalls.map(call => call.name), ["getBans"]);
    const unnamed = fixture({rows: [{uuid: canonicalUuid, nickname: null}]});
    assert.deepEqual(plain(await unnamed.lookup(canonicalUuid)), {uuid: canonicalUuid, nick: null});
}

function verifyDailyAggregationAndCsv() {
    const {buildDailyExport, exportCsv} = modules().load("app/playerExport.ts");
    const firstDay = Date.parse("2024-01-01T00:00:00Z") / 86400000;
    const result = plain(buildDailyExport([
        {day: String(firstDay), netherEnters: "1", previewsPlayed: "8", resets: "4", resetRecords: "1", accurateRecords: "1", wallTimeMs: "1800000", playTimeMs: "1800000"},
        {day: firstDay + 2, netherEnters: 3, previewsPlayed: 22, resets: 6, resetRecords: 3, accurateRecords: 2, wallTimeMs: 3600000, playTimeMs: 3600000},
    ]));
    assert.equal(result.rows.length, 2, "Missing submission days are not manufactured as zero-activity days");
    assert.equal(result.rows[0].date, "2024-01-01");
    assert.equal(result.rows[1].date, "2024-01-03");
    assert.deepEqual(result.summary, {netherEnters: 4, previewsPlayed: 30, resets: 10, resetRecords: 4,
        accurateRecords: 3, wallTimeMs: 5400000, playTimeMs: 5400000, rnph: 1.33, lnph: 2.67, resetsPerEnter: 2.5});
    assert.notEqual(result.summary.rnph, (result.rows[0].rnph + result.rows[1].rnph) / 2, "Range rates are computed from summed counts/time, rather than averaging daily rates");
    const unknown = plain(buildDailyExport([
        {day: firstDay, netherEnters: 1, previewsPlayed: 5, resets: null, resetRecords: 0, accurateRecords: 0, wallTimeMs: 0, playTimeMs: 0},
        {day: firstDay + 1, netherEnters: 1, previewsPlayed: 4, resets: 0, resetRecords: 1, accurateRecords: 1, wallTimeMs: 1000, playTimeMs: 0},
    ]));
    assert.equal(unknown.rows[0].resets, null);
    assert.equal(unknown.rows[0].rnph, null);
    assert.equal(unknown.rows[0].lnph, null);
    assert.equal(unknown.rows[0].resetsPerEnter, null);
    assert.equal(unknown.rows[1].resets, 0, "Known zero resets remain distinct from unavailable reset data");
    assert.equal(unknown.rows[1].resetsPerEnter, 0);
    assert.equal(unknown.summary.resets, 0);
    assert.equal(unknown.summary.resetRecords, 1);
    assert.equal(unknown.summary.resetsPerEnter, null, "Partial reset coverage cannot produce a misleading resets-per-enter rate");
    const empty = plain(buildDailyExport([]));
    assert.deepEqual(empty.rows, []);
    assert.deepEqual(empty.summary, {netherEnters: 0, previewsPlayed: 0, resets: null, resetRecords: 0,
        accurateRecords: 0, wallTimeMs: 0, playTimeMs: 0, rnph: null, lnph: null, resetsPerEnter: null});
    assert.equal(exportCsv([{a: 'comma,"quote"\nnext', b: null, c: false, d: 0}], ["a", "b", "c", "d"]),
        'a,b,c,d\r\n"comma,""quote""\nnext",,false,0\r\n');
    assert.equal(exportCsv([{value: "=1+1"}, {value: "+SUM(A1)"}, {value: "@formula"}, {value: -2}], ["value"]),
        "value\r\n'=1+1\r\n'+SUM(A1)\r\n'@formula\r\n-2\r\n", "Spreadsheet formula-looking strings are escaped without changing numeric values");
}

function verifyStatsDailyAggregation() {
    const {buildStatsDailyExport, statsSplitColumns} = modules().load("app/playerExport.ts");
    assert.deepEqual(plain(statsSplitColumns), expectedStatsSplits, "Pace exports cover all stored IGT, RTA and milestone split columns");
    const firstDay = Date.parse("2024-01-01T00:00:00Z") / 86400000;
    const result = plain(buildStatsDailyExport([
        {day: String(firstDay), runs: "3", netherEnters: "2", bastionEnters: "2", fortressEnters: "1",
            firstPortalEnters: "1", secondPortalEnters: "0", strongholdEnters: "1", endEnters: "0", completions: "0", fastestNetherMs: "90000", fastestFinishMs: null},
        {day: firstDay + 2, runs: 4, netherEnters: 4, bastionEnters: 3, fortressEnters: 2,
            firstPortalEnters: 2, secondPortalEnters: 1, strongholdEnters: 2, endEnters: 1, completions: 1, fastestNetherMs: 95000, fastestFinishMs: 600000},
    ]));
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].date, "2024-01-01");
    assert.equal(result.rows[1].date, "2024-01-03");
    assert.equal(result.rows[0].fastestFinishMs, null);
    assert.deepEqual(result.summary, {runs: 7, netherEnters: 6, bastionEnters: 5, fortressEnters: 3,
        firstPortalEnters: 3, secondPortalEnters: 1, strongholdEnters: 3, endEnters: 1, completions: 1, fastestNetherMs: 90000, fastestFinishMs: 600000});
    assert.ok(!("rnph" in result.summary) && !("resets" in result.summary), "Pace daily summaries contain their own counts and fastest splits");
    assert.deepEqual(plain(buildStatsDailyExport([])), {rows: [], summary: {runs: 0, netherEnters: 0,
        bastionEnters: 0, fortressEnters: 0, firstPortalEnters: 0, secondPortalEnters: 0, strongholdEnters: 0, endEnters: 0,
        completions: 0, fastestNetherMs: null, fastestFinishMs: null}});
    const storedZero = plain(buildStatsDailyExport([{day: firstDay, runs: 1, netherEnters: 1, bastionEnters: 0,
        fortressEnters: 0, firstPortalEnters: 0, secondPortalEnters: 0, strongholdEnters: 0, endEnters: 0,
        completions: 0, fastestNetherMs: 0, fastestFinishMs: null}]));
    assert.equal(storedZero.summary.fastestNetherMs, 0, "Raw zero split values remain available in pace summaries");
}

async function verifySqlQueriesAndRecordMapping() {
    const queries: {sql: string; values: unknown[]}[] = [];
    const responses: unknown[][] = [];
    const data = {getConn: async () => ({execute: async (sql: string, values: unknown[]) => {
        queries.push({sql, values});
        assert.ok(responses.length, "Unexpected database read");
        return [responses.shift(), []];
    }})};
    const fixture = modules({"./data": data});
    const server = fixture.load("app/playerExport.server.ts"), model = fixture.load("app/playerExport.ts");
    responses.push([{day: 19723, netherEnters: "2", previewsPlayed: "12", resets: "3", resetRecords: "1", accurateRecords: "1", wallTimeMs: "1000", playTimeMs: "2000"}]);
    const daily = await server.getResetDailyExport("player-uuid", 1704067200, 1704153600);
    assert.equal(daily.rows[0].date, "2024-01-01");
    assert.equal(daily.rows[0].netherEnters, 2);
    assert.equal(daily.rows[0].resetsPerEnter, null);
    assert.deepEqual(plain(queries[0].values), ["player-uuid", 1704067200, 1704153600]);
    assert.match(queries[0].sql, /FLOOR\(UNIX_TIMESTAMP\(n\.insertTime\) \/ 86400\)/);
    assert.match(queries[0].sql, /WHERE n\.uuid=\? AND n\.insertTime >= FROM_UNIXTIME\(\?\) AND n\.insertTime < FROM_UNIXTIME\(\?\)/);
    assert.match(queries[0].sql, /CASE WHEN n\.resets >= 0 THEN 1 ELSE 0 END/);
    assert.match(queries[0].sql, /CASE WHEN n\.resets > 0 THEN n\.resets ELSE 0 END/);
    assert.match(queries[0].sql, /GROUP BY day ORDER BY day ASC/);
    const input = [
        {id: "3", runId: "30", worldId: "world-30", time: "1704110400", netherTimeMs: "90000", trackerNetherTimeMs: null,
            wallTimeMs: "1000", playTimeMs: "2000", previewsPlayed: "5", resets: null, totalResets: null, isAccurate: 0},
        {id: "4", runId: "31", worldId: null, time: "1704110400", netherTimeMs: null, trackerNetherTimeMs: "89000",
            wallTimeMs: "3000", playTimeMs: "4000", previewsPlayed: "6", resets: "0", totalResets: "20", isAccurate: 1},
        {id: "5", runId: "32", worldId: "sentinel", time: "1704110401", netherTimeMs: null, trackerNetherTimeMs: null,
            wallTimeMs: 0, playTimeMs: 0, previewsPlayed: 0, resets: -1, totalResets: -1, isAccurate: 0},
    ];
    responses.push(input);
    const page = plain(await server.getResetRecordExportPage("player-uuid", 1704067200, 1704153600, null, 2));
    assert.equal(page.rows.length, 2);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextCursor, model.encodeExportCursor({time: 1704110400, id: 4}));
    assert.deepEqual(page.rows[0], {id: 3, runId: 30, worldId: "world-30", timestamp: "2024-01-01T12:00:00.000Z",
        netherTimeMs: 90000, trackerNetherTimeMs: null, wallTimeMs: 1000, playTimeMs: 2000,
        previewsPlayed: 5, resets: null, totalResets: null, isAccurate: false});
    assert.equal(page.rows[1].resets, 0);
    assert.equal(page.rows[1].totalResets, 20);
    assert.equal(page.rows[1].isAccurate, true);
    assert.equal(page.rows[1].netherTimeMs, null);
    assert.equal(page.rows[1].trackerNetherTimeMs, 89000, "Tracker nether time is exported separately from the run's split");
    assert.deepEqual(plain(queries[1].values), ["player-uuid", 1704067200, 1704153600, "3"]);
    assert.match(queries[1].sql, /INNER JOIN pace p ON p\.id=n\.runId/);
    assert.match(queries[1].sql, /ORDER BY n\.insertTime ASC, n\.id ASC LIMIT \?/);
    assert.ok(!queries[1].sql.includes("OFFSET"));
    responses.push([input[2]]);
    const last = plain(await server.getResetRecordExportPage("player-uuid", 1704067200, 1704153600, {time: 1704110400, id: 4}, 2));
    assert.equal(last.hasMore, false);
    assert.equal(last.nextCursor, null);
    assert.equal(last.rows[0].resets, -1, "Raw historical sentinel values remain available for analysis");
    assert.deepEqual(plain(queries[2].values), ["player-uuid", 1704067200, 1704153600, 1704110400, 1704110400, 4, "3"]);
    assert.match(queries[2].sql, /n\.insertTime > FROM_UNIXTIME\(\?\) OR \(n\.insertTime = FROM_UNIXTIME\(\?\) AND n\.id > \?\)/);
    responses.push([]);
    assert.deepEqual(plain(await server.getResetRecordExportPage("player-uuid", 0, 1, null, 2)), {rows: [], hasMore: false, nextCursor: null});
    assert.equal(responses.length, 0);

    responses.push([{day: "19723", runs: "4", netherEnters: "3", bastionEnters: "2", fortressEnters: "1",
        firstPortalEnters: "1", secondPortalEnters: "0", strongholdEnters: "1", endEnters: "1", completions: "1", fastestNetherMs: "90000", fastestFinishMs: "600000"}]);
    const statsDaily = plain(await server.getStatsDailyExport("pace-only-player", 1704067200, 1704153600));
    assert.equal(statsDaily.rows[0].runs, 4);
    assert.equal(statsDaily.rows[0].fastestNetherMs, 90000);
    assert.deepEqual(plain(queries[4].values), ["pace-only-player", 1704067200, 1704153600]);
    assert.match(queries[4].sql, /FROM pace p/);
    assert.match(queries[4].sql, /WHERE p\.uuid=\? AND p\.insertTime >= FROM_UNIXTIME\(\?\) AND p\.insertTime < FROM_UNIXTIME\(\?\)/);
    assert.match(queries[4].sql, /COUNT\(p\.nether\) AS netherEnters/);
    assert.match(queries[4].sql, /COUNT\(p\.second_portal\) AS secondPortalEnters/);
    assert.match(queries[4].sql, /MIN\(p\.nether\) AS fastestNetherMs/);
    assert.ok(!/nethers|JOIN|AVG\(/i.test(queries[4].sql), "Pace daily exports aggregate pace records without tracker or leaderboard dependencies");
    const rawSplits = Object.fromEntries(Object.keys(expectedStatsSplits).map((name, index) => [name,
        index === 0 ? "0" : index === 1 ? "-1" : index === 2 ? null : String(1000 * index)]));
    const paceRecords = [
        {id: "3", worldId: "pace-without-tracker", nickname: "StoredName", time: "1704110400", updatedTime: "1704196800", realUpdatedTime: null, ...rawSplits},
        {id: "4", worldId: null, nickname: null, time: "1704110400", updatedTime: null, realUpdatedTime: "1704196801", ...rawSplits},
        {id: "5", worldId: "sentinel", nickname: "LaterName", time: "1704110401", updatedTime: null, realUpdatedTime: null, ...rawSplits},
    ];
    responses.push(paceRecords);
    const statsPage = plain(await server.getStatsRecordExportPage("pace-only-player", 1704067200, 1704153600, null, 2));
    assert.equal(statsPage.rows.length, 2);
    assert.equal(statsPage.hasMore, true);
    assert.equal(statsPage.nextCursor, model.encodeExportCursor({time: 1704110400, id: 4}));
    assert.equal(statsPage.rows[0].worldId, "pace-without-tracker");
    assert.equal(statsPage.rows[0].nickname, "StoredName");
    assert.equal(statsPage.rows[0].timestamp, "2024-01-01T12:00:00.000Z");
    assert.equal(statsPage.rows[0].lastUpdated, "2024-01-02T12:00:00.000Z");
    assert.equal(statsPage.rows[0].realUpdated, null);
    assert.equal(statsPage.rows[1].lastUpdated, null);
    assert.equal(statsPage.rows[1].realUpdated, "2024-01-02T12:00:01.000Z");
    for (const [name, column] of Object.entries(expectedStatsSplits)) {
        assert.equal(statsPage.rows[0][name], rawSplits[name] === null ? null : Number(rawSplits[name]));
        assert.ok(queries[5].sql.includes(`p.\`${column}\` AS \`${name}\``), `${name} comes from the corresponding stored pace column`);
    }
    assert.ok(!("resets" in statsPage.rows[0]) && !("runId" in statsPage.rows[0]));
    assert.deepEqual(plain(queries[5].values), ["pace-only-player", 1704067200, 1704153600, "3"]);
    assert.ok(!/nethers|JOIN|OFFSET/i.test(queries[5].sql), "Raw pace pagination does not require any reset stats submission");
    assert.match(queries[5].sql, /ORDER BY p\.insertTime ASC, p\.id ASC LIMIT \?/);
    responses.push([paceRecords[2]]);
    const statsLast = plain(await server.getStatsRecordExportPage("pace-only-player", 1704067200, 1704153600, {time: 1704110400, id: 4}, 2));
    assert.equal(statsLast.hasMore, false);
    assert.equal(statsLast.nextCursor, null);
    assert.deepEqual(plain(queries[6].values), ["pace-only-player", 1704067200, 1704153600, 1704110400, 1704110400, 4, "3"]);
    assert.match(queries[6].sql, /p\.insertTime > FROM_UNIXTIME\(\?\) OR \(p\.insertTime = FROM_UNIXTIME\(\?\) AND p\.id > \?\)/);
    assert.equal(responses.length, 0);
}

type Call = {name: string; args: unknown[]};
type Dataset = "stats" | "resetStats";
const endpointFor = (kind: Dataset) => kind === "stats" ? "exportStats" : "exportResetStats";
function routeFixture(options: {pause?: Promise<void>; kind?: Dataset; uuidIdentity?: {uuid: string; nick: string | null} | null} = {}) {
    const kind = options.kind ?? "resetStats";
    const calls: Call[] = [], cacheCalls: Call[] = [];
    const uuid = canonicalUuid;
    const daily = {rows: [{date: "2024-01-01", netherEnters: 2, previewsPlayed: 12, resets: 5,
        resetRecords: 1, accurateRecords: 2, wallTimeMs: 1_800_000, playTimeMs: 1_800_000,
        rnph: 2, lnph: 4, resetsPerEnter: 2.5}], summary: {netherEnters: 2}};
    const record = {id: 3, runId: 30, worldId: 'world,"quoted"\nsecond line', timestamp: "2024-01-01T12:00:00.000Z",
        netherTimeMs: 90_000, trackerNetherTimeMs: 89_000, wallTimeMs: 20_000, playTimeMs: 70_000,
        previewsPlayed: 6, resets: null, totalResets: null, isAccurate: false};
    const nextCursor = Buffer.from(JSON.stringify([1704110400, 3])).toString("base64url");
    const records = {rows: [record], hasMore: true, nextCursor};
    const statsDaily = {rows: [{date: "2024-01-01", runs: 4, netherEnters: 3, bastionEnters: 2, fortressEnters: 1,
        firstPortalEnters: 1, secondPortalEnters: 0, strongholdEnters: 1, endEnters: 1, completions: 1, fastestNetherMs: 90000, fastestFinishMs: 600000}], summary: {runs: 4}};
    const statsRecord = {id: 3, worldId: record.worldId, nickname: "KnownPlayer", timestamp: record.timestamp,
        lastUpdated: "2024-01-02T12:00:00.000Z", realUpdated: null,
        ...Object.fromEntries(Object.keys(expectedStatsSplits).map(name => [name, null])), netherMs: 90000, bastionMs: 120000};
    const statsRecords = {rows: [statsRecord], hasMore: true, nextCursor};
    const data = {
        async getAllNamesByNick(name: string) {
            calls.push({name: "getAllNamesByNick", args: [name]});
            if (["knownplayer", "historicalname"].includes(name.toLowerCase())) return {uuid, nick: "KnownPlayer"};
            return name.toLowerCase() === "reusedname" ? {uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", nick: "CurrentOwner"} : null;
        },
        async getAllNamesByTwitch(name: string) {
            calls.push({name: "getAllNamesByTwitch", args: [name]});
            return name.toLowerCase() === "known_channel" ? {uuid, nick: "KnownPlayer"} : null;
        },
        async getCached(producer: (...args: unknown[]) => Promise<unknown>, name: string, ...args: unknown[]) {
            cacheCalls.push({name, args});
            return producer(...args);
        },
    };
    const server = {
        async getExportPlayerByUuid(requestUuid: string) {
            calls.push({name: "getExportPlayerByUuid", args: [requestUuid]});
            if (requestUuid !== canonicalUuid) return null;
            return options.uuidIdentity === undefined ? {uuid, nick: "KnownPlayer"} : options.uuidIdentity;
        },
        async getStatsDailyExport(...args: unknown[]) {
            calls.push({name: "getStatsDailyExport", args});
            await options.pause;
            return statsDaily;
        },
        async getStatsRecordExportPage(...args: unknown[]) {
            calls.push({name: "getStatsRecordExportPage", args});
            await options.pause;
            return statsRecords;
        },
        async getResetDailyExport(...args: unknown[]) {
            calls.push({name: "getResetDailyExport", args});
            await options.pause;
            return daily;
        },
        async getResetRecordExportPage(...args: unknown[]) {
            calls.push({name: "getResetRecordExportPage", args});
            await options.pause;
            return records;
        },
    };
    const fixture = modules({"@/app/data": data, "@/app/playerExport.server": server});
    const handlers = {
        stats: fixture.load("app/api/exportStats/route.ts").GET as (request: NextRequest) => Promise<Response>,
        resetStats: fixture.load("app/api/exportResetStats/route.ts").GET as (request: NextRequest) => Promise<Response>,
    };
    const GET = handlers[kind];
    let address = 0;
    const request = (query: string, ip = `test-${address++}`, dataset: Dataset = kind) => new NextRequest(`https://example.test/stats/api/${endpointFor(dataset)}?${query}`, {
        headers: {"x-forwarded-for": ip},
    });
    return {GET, handlers, request, calls, cacheCalls, uuid, daily, record, records, nextCursor, statsDaily, statsRecord};
}

async function verifyRouteValidationAndIdentity() {
    const fixture = routeFixture();
    for (const query of ["", "name=", "name=KnownPlayer&from=2024-02-30", "name=KnownPlayer&mode=nope",
        "name=KnownPlayer&format=nope", "name=KnownPlayer&limit=5001", "name=KnownPlayer&cursor=invalid"]) {
        const response = await fixture.GET(fixture.request(query));
        assert.equal(response.status, 400, query);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.equal(fixture.calls.length, 0, "Invalid export inputs are rejected before identity or database reads");
    const unknown = await fixture.GET(fixture.request("name=missing"));
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(fixture.calls.map(call => call.name), ["getAllNamesByNick", "getAllNamesByTwitch"]);
    const response = await fixture.GET(fixture.request("name=known_channel&from=2023-01-01&to=2025-02-01"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.player, {name: "KnownPlayer", uuid: fixture.uuid});
    assert.deepEqual(body.range, {from: "2023-01-01", to: "2025-02-01", timezone: "UTC", toExclusive: true});
    assert.equal(body.mode, "daily");
    assert.deepEqual(body.rows, fixture.daily.rows);
    assert.equal(Object.hasOwn(body, "notes"), false, "Reset stats responses contain data without explanatory notes");
    assert.equal(body.dataset, "resetStats");
    assert.deepEqual(fixture.cacheCalls.at(-1), {name: "getResetDailyExport", args: [fixture.uuid,
        Date.parse("2023-01-01T00:00:00Z") / 1000, Date.parse("2025-02-01T00:00:00Z") / 1000]});
    assert.equal(response.headers.get("content-disposition"), null, "JSON data is displayed inline instead of forced into a download");
    assert.match(response.headers.get("content-type")!, /^application\/json/);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=60, stale-while-revalidate=120");
}

async function verifyCsvAndPagination() {
    const fixture = routeFixture();
    const dailyResponse = await fixture.GET(fixture.request("name=KnownPlayer&from=2024-01-01&to=2024-01-02&format=csv"));
    assert.equal(dailyResponse.status, 200);
    assert.equal(dailyResponse.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(dailyResponse.headers.get("content-disposition"), null);
    const dailyText = await dailyResponse.text();
    assert.ok(dailyText.startsWith("date,netherEnters,previewsPlayed,resets,resetRecords,accurateRecords,wallTimeMs,playTimeMs,rnph,lnph,resetsPerEnter\r\n"));
    assert.ok(dailyText.includes("2024-01-01,2,12,5,1,2,1800000,1800000,2,4,2.5"));
    const query = "name=KnownPlayer&from=2024-01-01&to=2024-01-02&mode=records&format=csv&limit=2";
    const response = await fixture.GET(fixture.request(query));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-has-more"), "true");
    assert.equal(response.headers.get("x-next-cursor"), fixture.nextCursor);
    const link = response.headers.get("link")!.match(/^<([^>]+)>; rel="next"$/)!;
    assert.ok(link);
    const next = new URL(link[1]);
    assert.equal(next.pathname, "/stats/api/exportResetStats");
    assert.equal(next.searchParams.get("cursor"), fixture.nextCursor);
    for (const [key, value] of new URLSearchParams(query)) assert.equal(next.searchParams.get(key), value);
    const text = await response.text();
    assert.ok(text.includes('"world,""quoted""\nsecond line"'), "CSV escapes quotes, commas and embedded newlines");
    assert.equal(response.headers.get("content-disposition"), null);
    assert.deepEqual(plain(fixture.cacheCalls.at(-1)), {name: "getResetRecordExportPage", args: [fixture.uuid,
        1704067200, 1704153600, null, 2]});
    const page = await fixture.GET(new NextRequest(next, {headers: {"x-forwarded-for": "next-page"}}));
    assert.equal(page.status, 200);
    assert.deepEqual(plain(fixture.cacheCalls.at(-1)?.args), [fixture.uuid, 1704067200, 1704153600,
        {time: 1704110400, id: 3}, 2]);
    const json = await fixture.GET(fixture.request(query.replace("format=csv", "format=json")));
    const jsonBody = await json.json();
    assert.equal(json.headers.get("content-disposition"), null);
    assert.match(json.headers.get("content-type")!, /^application\/json/);
    assert.equal(Object.hasOwn(jsonBody, "notes"), false);
    assert.equal(jsonBody.limit, 2);
    assert.equal(jsonBody.nextCursor, fixture.nextCursor);
    assert.deepEqual(jsonBody.rows, [fixture.record]);
    assert.equal(jsonBody.rows[0].resets, null, "Unavailable reset counters remain null in downloaded records");
    const defaultRange = await fixture.GET(fixture.request("name=KnownPlayer&mode=records&limit=2"));
    const defaultLink = new URL(defaultRange.headers.get("link")!.match(/^<([^>]+)>; rel="next"$/)![1]);
    const defaultBody = await defaultRange.json();
    assert.equal(defaultLink.searchParams.get("from"), defaultBody.range.from);
    assert.equal(defaultLink.searchParams.get("to"), defaultBody.range.to, "Pagination freezes an omitted date range across UTC midnight");
}

async function verifyRouteLimits() {
    const limited = routeFixture();
    for (let count = 0; count < 6; count++) assert.equal((await limited.GET(limited.request("name=missing", "rate-fixture"))).status, 404);
    const throttled = await limited.GET(limited.request("name=missing", "rate-fixture"));
    assert.equal(throttled.status, 429);
    assert.ok(Number(throttled.headers.get("retry-after")) >= 1);
    assert.equal((await limited.handlers.stats(limited.request("name=missing", "rate-fixture", "stats"))).status, 404,
        "Exhausting reset stats downloads does not consume PaceMan's rate limit");
    let release!: () => void;
    const pause = new Promise<void>(resolve => {release = resolve;});
    const concurrent = routeFixture({pause});
    const first = concurrent.GET(concurrent.request("name=KnownPlayer"));
    const second = concurrent.GET(concurrent.request("name=KnownPlayer"));
    const separateDataset = concurrent.handlers.stats(concurrent.request("name=KnownPlayer", "parallel-stats", "stats"));
    try {
        const busy = await concurrent.GET(concurrent.request("name=KnownPlayer"));
        assert.equal(busy.status, 429);
        assert.equal(busy.headers.get("retry-after"), "1");
    } finally {release();}
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    assert.equal((await separateDataset).status, 200, "PaceMan exports have independent concurrency slots from reset stats");
    assert.equal((await concurrent.GET(concurrent.request("name=KnownPlayer"))).status, 200, "Completed exports release the concurrency slots");
}

async function verifyStatsRouteAndDatasetSeparation() {
    const fixture = routeFixture({kind: "stats"});
    const query = "name=KnownPlayer&from=2024-01-01&to=2024-01-02";
    const invalid = await fixture.GET(fixture.request("name=KnownPlayer&from=invalid&mode=invalid"));
    assert.equal(invalid.status, 400);
    assert.equal(fixture.calls.length, 0);
    const response = await fixture.GET(fixture.request(query));
    const body = await response.json();
    assert.equal(body.dataset, "stats");
    assert.deepEqual(body.rows, fixture.statsDaily.rows);
    assert.equal(body.summary.runs, 4);
    assert.equal(Object.hasOwn(body, "notes"), false, "Main stats responses contain data without explanatory notes");
    assert.deepEqual(plain(fixture.cacheCalls.at(-1)), {name: "getStatsDailyExport", args: [fixture.uuid, 1704067200, 1704153600]});
    assert.equal(response.headers.get("content-disposition"), null, "JSON data is displayed inline instead of forced into a download");
    assert.match(response.headers.get("content-type")!, /^application\/json/);
    const dailyCsv = await fixture.GET(fixture.request(`${query}&format=csv`));
    assert.equal(dailyCsv.headers.get("content-disposition"), null);
    const text = await dailyCsv.text();
    assert.ok(text.startsWith("date,runs,netherEnters,bastionEnters,fortressEnters,firstPortalEnters,secondPortalEnters,strongholdEnters,endEnters,completions,fastestNetherMs,fastestFinishMs\r\n"));
    assert.ok(text.includes("2024-01-01,4,3,2,1,1,0,1,1,1,90000,600000"));
    assert.ok(!text.includes("resets") && !text.includes("rnph"));
    const page = await fixture.GET(fixture.request(`${query}&mode=records&limit=2`));
    const records = await page.json();
    assert.deepEqual(records.rows, [fixture.statsRecord]);
    assert.equal(records.dataset, "stats");
    assert.equal(Object.hasOwn(records, "notes"), false);
    assert.equal(page.headers.get("content-disposition"), null);
    assert.deepEqual(plain(fixture.cacheCalls.at(-1)), {name: "getStatsRecordExportPage", args: [fixture.uuid, 1704067200, 1704153600, null, 2]});
    const nextUrl = new URL(page.headers.get("link")!.match(/^<([^>]+)>; rel="next"$/)![1]);
    assert.equal(nextUrl.pathname, "/stats/api/exportStats");
    assert.equal(nextUrl.searchParams.get("cursor"), fixture.nextCursor);
    const recordsCsv = await fixture.GET(fixture.request(`${query}&mode=records&limit=2&format=csv`));
    const recordText = await recordsCsv.text();
    assert.equal(recordText.split("\r\n")[0], ["id", "worldId", "nickname", "timestamp", "lastUpdated", "realUpdated", ...Object.keys(expectedStatsSplits)].join(","));
    assert.ok(recordText.includes('"world,""quoted""\nsecond line"'));
    assert.ok(!recordText.split("\r\n")[0].includes("resets"));
    assert.equal(recordsCsv.headers.get("content-disposition"), null);
    assert.ok(!fixture.calls.some(call => call.name.startsWith("getReset")), "PaceMan downloads never call reset stats readers");
    const reset = await fixture.handlers.resetStats(fixture.request(query, "same-player-reset", "resetStats"));
    const resetBody = await reset.json();
    assert.equal(resetBody.dataset, "resetStats");
    assert.deepEqual(resetBody.rows, fixture.daily.rows);
    assert.deepEqual(plain(fixture.cacheCalls.at(-1)), {name: "getResetDailyExport", args: [fixture.uuid, 1704067200, 1704153600]});
    assert.equal(reset.headers.get("content-disposition"), null);
    assert.equal(Object.hasOwn(resetBody, "notes"), false);
}

async function verifyUuidRoutesAndNameCompatibility() {
    for (const kind of ["stats", "resetStats"] as const) {
        const invalid = routeFixture({kind});
        for (const query of [`name=KnownPlayer&uuid=${canonicalUuid}`, "uuid=invalid", "uuid=%20", "name=%20&uuid="]) {
            assert.equal((await invalid.GET(invalid.request(query))).status, 400);
        }
        assert.equal(invalid.calls.length, 0, `${kind} rejects invalid or conflicting selectors before identity/database reads`);
        for (const unknown of ["00000000-0000-0000-0000-000000000000", "11111111-1111-1111-1111-111111111111"]) {
            const response = await invalid.GET(invalid.request(`uuid=${unknown}`));
            assert.equal(response.status, 404);
            assert.equal(response.headers.get("cache-control"), "private, no-store");
        }
        assert.ok(invalid.calls.every(call => call.name === "getExportPlayerByUuid"));
        const storedUuid = canonicalUuid.replaceAll("-", "").toUpperCase();
        const fixture = routeFixture({kind, uuidIdentity: {uuid: storedUuid, nick: null}});
        for (const mode of ["daily", "records"] as const) for (const format of ["json", "csv"] as const) {
            const params = new URLSearchParams({uuid: ` ${storedUuid} `, from: "2024-01-01", to: "2024-01-02", mode, format});
            if (mode === "records") params.set("limit", "2");
            const response = await fixture.GET(fixture.request(params.toString()));
            assert.equal(response.status, 200, `${kind}/${mode}/${format}`);
            assert.ok(fixture.cacheCalls.some(call => call.name === "getExportPlayerByUuid" && call.args[0] === canonicalUuid));
            assert.equal(fixture.cacheCalls.at(-1)!.args[0], storedUuid, "Dataset cache keys retain the UUID stored in the database");
            assert.equal(response.headers.get("content-disposition"), null);
            if (format === "json") {
                const body = await response.json();
                assert.deepEqual(body.player, {uuid: storedUuid, name: null}, "A known UUID can export data even when its current nickname is null");
                assert.equal(body.dataset, kind);
                assert.equal(Object.hasOwn(body, "notes"), false);
                assert.match(response.headers.get("content-type")!, /^application\/json/);
            } else assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
            if (mode === "records") {
                const next = new URL(response.headers.get("link")!.match(/^<([^>]+)>; rel="next"$/)![1]);
                assert.equal(next.pathname, `/stats/api/${endpointFor(kind)}`);
                assert.equal(next.searchParams.get("name"), null);
                assert.equal(next.searchParams.get("uuid")!.trim().replaceAll("-", "").toLowerCase(), canonicalUuid.replaceAll("-", ""));
                const nextResponse = await fixture.GET(new NextRequest(next, {headers: {"x-forwarded-for": `uuid-next-${format}`}}));
                assert.equal(nextResponse.status, 200);
                assert.deepEqual(plain(fixture.cacheCalls.at(-1)!.args), [storedUuid, 1704067200, 1704153600, {time: 1704110400, id: 3}, 2]);
            }
        }
        assert.ok(!fixture.calls.some(call => call.name === "getAllNamesByNick" || call.name === "getAllNamesByTwitch"), "UUID requests skip name and Twitch resolution");
        const names = routeFixture({kind});
        for (const name of ["kNoWnPlAyEr", "HistoricalName", "ReusedName", "KNOWN_CHANNEL"]) {
            const response = await names.GET(names.request(`name=${name}&from=2024-01-01&to=2024-01-02`));
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.player.uuid, name === "ReusedName" ? "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" : canonicalUuid);
            assert.equal(body.player.name, name === "ReusedName" ? "CurrentOwner" : "KnownPlayer");
        }
        assert.deepEqual(names.calls.filter(call => call.name === "getAllNamesByTwitch").map(call => call.args[0]), ["KNOWN_CHANNEL"],
            "Existing mixed-case/historical/reused-name results take precedence over Twitch fallback");
        assert.ok(!names.calls.some(call => call.name === "getExportPlayerByUuid"));
    }
}

async function main() {
    verifyParameters();
    verifyPlayerSelectors();
    verifyDailyAggregationAndCsv();
    verifyStatsDailyAggregation();
    await verifySqlQueriesAndRecordMapping();
    await verifyRouteValidationAndIdentity();
    await verifyCsvAndPagination();
    await verifyRouteLimits();
    await verifyStatsRouteAndDatasetSeparation();
    await verifyUuidRoutesAndNameCompatibility();
    await verifyUuidIdentitySqlAndSharedNameCache();
    console.log("Player exports: date/cursor validation, historical ranges, weighted daily summaries, scoped SQL/pages, identity resolution, JSON/CSV responses, pagination and request limits passed");
}

main().catch(error => {console.error(error); process.exitCode = 1;});
