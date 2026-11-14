/**
 * Redis layout of a player's encoded run history (one CSV line per run,
 * newest first), shared by the run-history job and the reader.
 *
 * A history used to be one string, rewritten in full every minute while its
 * player was active and fetched and decoded in full by every runs-page read.
 * It is now two strings:
 *
 *   playerRuns:head:{uuid}   "#2,<base version>,<base max id>" and the newest runs
 *   playerRuns:base:{uuid}   "#2,<base version>" and every older run
 *
 * The head holds the runs with an id above the base's largest id. New and
 * updated runs almost always belong there, so the job rewrites only the head
 * and readers keep the decoded base until its version changes. The base is
 * rewritten when the head has grown past RUN_HISTORY_COMPACT_RUNS, when one
 * of its own runs changes, and by complete rebuilds. A player with at most
 * RUN_HISTORY_HEAD_RUNS runs has no base (version "-"). The two keys are
 * always published together, so head lines followed by base lines are the
 * complete history.
 */

export const RUN_HISTORY_LAYOUT = "2";
const MARK = `#${RUN_HISTORY_LAYOUT}`;
/** Runs kept in the head when a history is laid out afresh. */
export const RUN_HISTORY_HEAD_RUNS = 128;
/** A head with more runs than this is folded into the base. */
export const RUN_HISTORY_COMPACT_RUNS = 512;

export const LEGACY_RUN_HISTORY_PREFIX = "playerRunsOptimized:";
export const RUN_HISTORY_HEAD_PREFIX = "playerRuns:head:";
export const RUN_HISTORY_BASE_PREFIX = "playerRuns:base:";
export const runHistoryHeadKey = (uuid: string) => `${RUN_HISTORY_HEAD_PREFIX}${uuid}`;
export const runHistoryBaseKey = (uuid: string) => `${RUN_HISTORY_BASE_PREFIX}${uuid}`;

export type RunHistoryHead = {
    /** Version of the base this head continues, or null when there is none. */
    baseVersion: string | null;
    /** Largest run id in the base; head runs have larger ids. */
    baseMaxId: number;
    /** The head's run lines. */
    body: string;
};

const splitHeader = (value: string): {fields: string[]; body: string} | null => {
    const newline = value.indexOf("\n");
    const header = newline < 0 ? value : value.slice(0, newline);
    const fields = header.split(",");
    if (fields[0] !== MARK) return null;
    return {fields, body: newline < 0 ? "" : value.slice(newline + 1)};
};

export function parseRunHistoryHead(value: string): RunHistoryHead | null {
    const parsed = splitHeader(value);
    if (!parsed || parsed.fields.length !== 3) return null;
    const baseMaxId = Number(parsed.fields[2]);
    if (!Number.isSafeInteger(baseMaxId)) return null;
    return {baseVersion: parsed.fields[1] === "-" ? null : parsed.fields[1], baseMaxId, body: parsed.body};
}

export function parseRunHistoryBase(value: string): {version: string; body: string} | null {
    const parsed = splitHeader(value);
    if (!parsed || parsed.fields.length !== 2) return null;
    return {version: parsed.fields[1], body: parsed.body};
}

export const formatRunHistoryHead = (baseVersion: string | null, baseMaxId: number, body: string) =>
    `${MARK},${baseVersion ?? "-"},${baseMaxId}\n${body}`;

/** The id an encoded run line starts with. */
export const runLineId = (line: string) => Number(line.slice(0, line.indexOf(",")));

/** Merge newest-first encoded patches, copying unchanged runs in whole blocks. */
export function spliceRunHistory(
    existing: string,
    patches: ReadonlyArray<{id: number; line: string}>,
): string {
    const output: string[] = [];
    let next = 0;
    let position = 0;
    let copyStart = 0;
    while (position < existing.length && next < patches.length) {
        const newline = existing.indexOf("\n", position);
        const lineEnd = newline < 0 ? existing.length : newline;
        const id = Number(existing.slice(position, existing.indexOf(",", position)));
        if (patches[next].id >= id) {
            if (copyStart < position) output.push(existing.slice(copyStart, position - 1));
            copyStart = position;
            while (next < patches.length && patches[next].id > id) output.push(patches[next++].line);
            if (next < patches.length && patches[next].id === id) {
                output.push(patches[next++].line);
                copyStart = lineEnd + 1;
            }
        }
        position = lineEnd + 1;
    }
    if (next < patches.length) {
        if (copyStart < position) output.push(existing.slice(copyStart, Math.min(position - 1, existing.length)));
        copyStart = position;
        while (next < patches.length) output.push(patches[next++].line);
    }
    if (copyStart < existing.length) {
        const end = position >= existing.length ? Math.min(position - 1, existing.length) : existing.length;
        output.push(existing.slice(copyStart, end));
    }
    return output.join("\n");
}

/**
 * Lay a complete history (run lines, newest first) out as head and base.
 * `version` names the new base and must be unique to this write.
 */
export function layoutRunHistory(newestFirst: string[], version: string): {head: string; base: string | null} {
    if (newestFirst.length <= RUN_HISTORY_HEAD_RUNS) {
        return {head: formatRunHistoryHead(null, 0, newestFirst.join("\n")), base: null};
    }
    const baseLines = newestFirst.slice(RUN_HISTORY_HEAD_RUNS);
    return {
        head: formatRunHistoryHead(
            version, runLineId(baseLines[0]), newestFirst.slice(0, RUN_HISTORY_HEAD_RUNS).join("\n"),
        ),
        base: `${MARK},${version}\n${baseLines.join("\n")}`,
    };
}
