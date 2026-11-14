import {formatIfNotNull} from '@/app/utils';

export type RecentRunRow = {id: number | string; time: number; live: boolean; cells: string[]};
const normalSplits = ['nether', 'bastion', 'fortress', 'first_portal', 'stronghold', 'end', 'finish'] as const;
const aaSplits = ['nether', 'bastion', 'fortress', 'stronghold', 'end', 'elytra', 'credits', 'finish'] as const;
type RecentRun = {id: number | string; lastUpdated: number; twitch: string | null} & Partial<Record<typeof normalSplits[number] | typeof aaSplits[number], number | null>>;

/** No world metadata, UUIDs or stream URLs are needed to hydrate a recent-pace table. */
export function recentRunRows(runs: RecentRun[] | Record<string, RecentRun>, aa = false): RecentRunRow[] {
    return Object.values(runs).map(run => ({
        id: run.id, time: run.lastUpdated / 1000, live: run.twitch !== null,
        cells: (aa ? aaSplits : normalSplits).map(split => formatIfNotNull(run[split]!)),
    }));
}
