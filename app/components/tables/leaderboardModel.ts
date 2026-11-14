import type {Entry, FastestEntry} from "@/app/types";
import {CategoryType, defaultNameColor, fixDisplayName, formatTime, generateHexCode, getGoodAAQty, getGoodQty, getMinAAQty, getMinQty} from "@/app/utils";

export type LeaderboardView = "count_avg" | "average" | "fastest" | "conversion";
export type BoardKind = "quantity" | "average" | "fastest" | "conversion";
export type BoardPlayer = {name: string, uuid: string, color: string};
export type BoardRow = {player: number, value: string, quantity?: number, hint?: string, color?: string, runId?: string | number};
export type BoardModel = {id: string, title: string, kind: BoardKind, help?: string, sample?: {minimum: number, good: number, left: string, right: string}, rows: BoardRow[]};
export type LeaderboardModel = {players: BoardPlayer[], boards: BoardModel[], aa?: boolean};

type UserInfo = {uuid: string, color?: string | null};
type Descriptor = {id: string, quantity: string, average: string, fastest: string, conversion: string};
const fixedBoards: Descriptor[] = [
    {id: "nether", quantity: "Nether Enters", average: "Nether Average", fastest: "Fastest Nether", conversion: ""},
    {id: "first_portal", quantity: "First Portals", average: "First Portal Average", fastest: "Fastest First Portal", conversion: "First Portal Conversion"},
    {id: "stronghold", quantity: "Stronghold Enters", average: "Stronghold Average", fastest: "Fastest Stronghold", conversion: "Stronghold Conversion"},
    {id: "end", quantity: "End Enters", average: "End Average", fastest: "Fastest End Enter", conversion: "End Conversion"},
    {id: "finish", quantity: "Completions", average: "Completion Average", fastest: "Fastest Completion", conversion: "Completion Conversion"},
];
const splitBoards: Record<"combined" | "separate", Descriptor[]> = {
    combined: [
        {id: "first_structure", quantity: "Structure 1 Enters", average: "Structure 1 Average", fastest: "Fastest Structure 1", conversion: "Structure 1 Conversion"},
        {id: "second_structure", quantity: "Structure 2 Enters", average: "Structure 2 Average", fastest: "Fastest Structure 2", conversion: "Structure 2 Conversion"},
    ],
    separate: [
        {id: "bastion", quantity: "Bastion Enters", average: "Bastion Average", fastest: "Fastest Bastion", conversion: "Bastion Conversion"},
        {id: "fortress", quantity: "Fortress Enters", average: "Fortress Average", fastest: "Fastest Fortress", conversion: "Fortress Conversion"},
    ],
};
const filters: Record<BoardKind, CategoryType> = {
    quantity: CategoryType.COUNT, average: CategoryType.AVG, fastest: CategoryType.FASTEST, conversion: CategoryType.CONVERSION,
};
const aaBoards: Descriptor[] = [
    {id: "nether", quantity: "Nether Enters", average: "Nether Average", fastest: "Fastest Nether", conversion: ""},
    {id: "bastion", quantity: "Bastion Enters", average: "Bastion Average", fastest: "Fastest Bastion", conversion: "Bastion Conversion"},
    {id: "fortress", quantity: "Fortress Enters", average: "Fortress Average", fastest: "Fastest Fortress", conversion: "Fortress Conversion"},
    {id: "stronghold", quantity: "Stronghold Enters", average: "Stronghold Average", fastest: "Fastest Stronghold", conversion: "Stronghold Conversion"},
    {id: "end", quantity: "End Enters", average: "End Enter Average", fastest: "Fastest End Enter", conversion: "End Conversion"},
    {id: "elytra", quantity: "Elytras Obtained", average: "Elytra Average", fastest: "Fastest Elytra", conversion: "Elytra Conversion"},
    {id: "credits", quantity: "End Exits", average: "End Exit Average", fastest: "Fastest End Exit", conversion: "End Exit Conversion"},
    {id: "finish", quantity: "Completions", average: "Completion Average", fastest: "Fastest Completion", conversion: "Completion Conversion"},
];

/** Format only the selected tables; share identity data across repeated rows. */
export function createLeaderboardModel(data: any, users: UserInfo[], days: number, view: LeaderboardView, bastionFort: boolean, aa = false): LeaderboardModel {
    const players: BoardPlayer[] = [];
    const boards: BoardModel[] = [];
    const playerIndexes = new Map<string, number>();
    const colors = new Map(users.filter(user => user.color).map(user => [user.uuid, `#${user.color}`]));
    const descriptors = aa ? aaBoards : [fixedBoards[0], ...splitBoards[bastionFort ? "separate" : "combined"], ...fixedBoards.slice(1)];
    const kinds: BoardKind[] = view === "count_avg" ? ["quantity", "average"] : [view];
    for (const descriptor of descriptors) {
        for (const kind of kinds) {
            const title = descriptor[kind];
            if (!title) continue;
            const entries = (data?.[filters[kind]]?.[descriptor.id] ?? []) as Array<Entry | FastestEntry>;
            const selected = kind === "fastest" && !aa ? entries : entries.slice(0, 10);
            if (selected.length === 0) continue;
            const minimum = aa ? getMinAAQty(descriptor.id, days) : getMinQty(descriptor.id, days);
            const good = aa ? getGoodAAQty(descriptor.id, days) : getGoodQty(descriptor.id, days);
            const rows = selected.map((entry): BoardRow => {
                const name = fixDisplayName(entry.name);
                const key = `${entry.uuid}:${name}`;
                let player = playerIndexes.get(key);
                if (player === undefined) {
                    player = players.length;
                    playerIndexes.set(key, player);
                    players.push({name, uuid: entry.uuid, color: colors.get(entry.uuid) ?? defaultNameColor});
                }
                if (kind === "fastest") {
                    const fastest = entry as FastestEntry;
                    return {player, value: formatTime(fastest.value), ...(!aa && fastest.runId != null ? {runId: fastest.runId} : {})};
                }
                const stat = entry as Entry;
                if (kind === "quantity") return {player, value: String(stat.qty), hint: formatTime(stat.avg)};
                return {
                    player, value: kind === "average" ? formatTime(stat.value, false) : `${stat.value.toFixed(1)}%`,
                    quantity: stat.qty, color: generateHexCode(stat.qty, minimum, good),
                };
            });
            boards.push({
                id: `${descriptor.id}-${kind}`, title, kind, rows,
                ...((kind === "average" || kind === "conversion") ? aa
                    ? {sample: {minimum, good, left: generateHexCode(minimum, minimum, good), right: generateHexCode(good, good, good)}}
                    : {help: `Sample size: ${minimum}–${good}`} : {}),
            });
        }
    }
    return {players, boards, ...(aa ? {aa: true} : {})};
}
