import {formatIfNotNull, numberWithCommas} from '@/app/utils';

type TrackerRun = {
    runId: number | string; time: number; vodId: unknown;
    nether: number | null; wallTime: number | null; playTime: number | null;
    enters: number; resets: number | null; totalResets: number | null;
};

export type TrackerRow = {
    id: number | string; time: number; live: boolean;
    cells: [string, string, string, number, string, string];
};

/** Only the rendered fields cross the client boundary; raw debug metadata stays on the server. */
export function trackerRows(runs: Record<string, TrackerRun> | TrackerRun[]): TrackerRow[] {
    return Object.values(runs).map(run => ({
        id: run.runId,
        time: run.time,
        live: Boolean(run.vodId),
        cells: [
            formatIfNotNull(run.nether), formatIfNotNull(run.wallTime), formatIfNotNull(run.playTime),
            run.enters, run.resets ? numberWithCommas(run.resets) : '',
            run.totalResets ? numberWithCommas(run.totalResets) : '',
        ],
    }));
}
