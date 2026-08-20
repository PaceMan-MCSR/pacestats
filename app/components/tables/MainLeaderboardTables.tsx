import Link from "next/link";
import BoardLink from "@/app/components/tables/BoardLink";
import {
    getAllUserInfo,
    getCached,
    getTrimmedLeaderboards,
} from "@/app/data";
import type { Entry, FastestEntry } from "@/app/types";
import {
    CategoryType,
    defaultNameColor,
    fixDisplayName,
    formatTime,
    generateHexCode,
    getGoodQty,
    getMinQty,
} from "@/app/utils";

export type LeaderboardView = "count_avg" | "average" | "fastest" | "conversion";

type UserInfo = {
    uuid: string;
    color?: string | null;
};

type BoardDescriptor = {
    id: string;
    quantity: string;
    average: string;
    fastest: string;
    conversion: string;
};

const fixedBoards: BoardDescriptor[] = [
    {id: "nether", quantity: "Nether Enters", average: "Nether Average", fastest: "Fastest Nether", conversion: ""},
    {id: "first_portal", quantity: "First Portals", average: "First Portal Average", fastest: "Fastest First Portal", conversion: "First Portal Conversion"},
    {id: "stronghold", quantity: "Stronghold Enters", average: "Stronghold Average", fastest: "Fastest Stronghold", conversion: "Stronghold Conversion"},
    {id: "end", quantity: "End Enters", average: "End Average", fastest: "Fastest End Enter", conversion: "End Conversion"},
    {id: "finish", quantity: "Completions", average: "Completion Average", fastest: "Fastest Completion", conversion: "Completion Conversion"},
];

const splitBoards: Record<"combined" | "separate", BoardDescriptor[]> = {
    combined: [
        {id: "first_structure", quantity: "Structure 1 Enters", average: "Structure 1 Average", fastest: "Fastest Structure 1", conversion: "Structure 1 Conversion"},
        {id: "second_structure", quantity: "Structure 2 Enters", average: "Structure 2 Average", fastest: "Fastest Structure 2", conversion: "Structure 2 Conversion"},
    ],
    separate: [
        {id: "bastion", quantity: "Bastion Enters", average: "Bastion Average", fastest: "Fastest Bastion", conversion: "Bastion Conversion"},
        {id: "fortress", quantity: "Fortress Enters", average: "Fortress Average", fastest: "Fastest Fortress", conversion: "Fortress Conversion"},
    ],
};

const playerColours = (users: UserInfo[], data: unknown) => {
    const uuids = new Set<string>();
    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(visit);
        } else if (value && typeof value === "object") {
            const record = value as Record<string, unknown>;
            if (typeof record.uuid === "string") uuids.add(record.uuid);
            else Object.values(record).forEach(visit);
        }
    };
    visit(data);
    return new Map(users
        .filter((user) => uuids.has(user.uuid) && user.color)
        .map((user) => [user.uuid, `#${user.color}`]));
};

function PlayerLink({entry, colours, label, lowPriority = false}: {
    entry: Entry | FastestEntry,
    colours: Map<string, string>,
    label?: string,
    lowPriority?: boolean,
}) {
    const name = fixDisplayName(entry.name);
    return <BoardLink
        name={name}
        displayName={label}
        uuid={entry.uuid}
        linkUrl={`/player/${name}/`}
        color={colours.get(entry.uuid) ?? defaultNameColor}
        lowPriority={lowPriority}
    />;
}

function QuantityBoard({descriptor, data, colours}: {
    descriptor: BoardDescriptor,
    data: any,
    colours: Map<string, string>,
}) {
    const entries = (data?.[CategoryType.COUNT]?.[descriptor.id] ?? []).slice(0, 10) as Entry[];
    if (entries.length === 0) return null;
    return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
        <p className="tableHeader">{descriptor.quantity}</p>
        <table className="table table-dark caption-top">
            <thead><tr><th>#</th><th id="name">Name</th><th>Qty</th></tr></thead>
            <tbody>{entries.map((entry, index) => <tr key={entry.uuid}>
                <td className="col-1"><p>{index + 1}</p></td>
                <td className="col-10"><PlayerLink entry={entry} colours={colours} lowPriority={index >= 3}/></td>
                <td className="col-1" title={formatTime(entry.avg)} style={{textAlign: "right"}}><p>{entry.qty}</p></td>
            </tr>)}</tbody>
        </table>
    </div>;
}

function AverageBoard({descriptor, days, data, colours, showQty}: {
    descriptor: BoardDescriptor,
    days: number,
    data: any,
    colours: Map<string, string>,
    showQty: boolean,
}) {
    const entries = (data?.[CategoryType.AVG]?.[descriptor.id] ?? []).slice(0, 10) as Entry[];
    if (entries.length === 0) return null;
    const minimum = getMinQty(descriptor.id, days);
    const good = getGoodQty(descriptor.id, days);
    return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
        <p className="tableHeader" title={`Sample size: ${minimum}–${good}`}>{descriptor.average}</p>
        <table className="table table-dark caption-top">
            <thead><tr><th id="num">#</th><th id="name">Name</th>{showQty && <th id="qty">Qty</th>}<th id="avg">Avg</th></tr></thead>
            <tbody>{entries.map((entry, index) => {
                const colour = generateHexCode(entry.qty, minimum, good);
                const name = fixDisplayName(entry.name);
                return <tr key={entry.uuid}>
                    <td className="col-1"><p>{index + 1}</p></td>
                    <td className="col-10"><PlayerLink entry={entry} colours={colours} label={showQty && name.length > 12 ? name.slice(0, 12) : name} lowPriority={index >= 3}/></td>
                    {showQty && <td className="col-1" style={{textAlign: "right"}}><p style={{color: colour}}>{entry.qty}</p></td>}
                    <td className="col-1" title={entry.qty.toString()}><p style={{color: colour}}>{formatTime(entry.value, false)}</p></td>
                </tr>;
            })}</tbody>
        </table>
    </div>;
}

function ConversionBoard({descriptor, days, data, colours, showQty}: {
    descriptor: BoardDescriptor,
    days: number,
    data: any,
    colours: Map<string, string>,
    showQty: boolean,
}) {
    const entries = (data?.[CategoryType.CONVERSION]?.[descriptor.id] ?? []).slice(0, 10) as Entry[];
    if (!descriptor.conversion || entries.length === 0) return null;
    const minimum = getMinQty(descriptor.id, days);
    const good = getGoodQty(descriptor.id, days);
    return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
        <p className="tableHeader" title={`Sample size: ${minimum}–${good}`}>{descriptor.conversion}</p>
        <table className="table table-dark caption-top">
            <thead><tr><th>#</th><th id="name">Name</th>{showQty && <th>Qty</th>}<th>Rate</th></tr></thead>
            <tbody>{entries.map((entry, index) => {
                const colour = generateHexCode(entry.qty, minimum, good);
                const name = fixDisplayName(entry.name);
                return <tr key={entry.uuid}>
                    <td className="col-1"><p>{index + 1}</p></td>
                    <td className="col-10"><PlayerLink entry={entry} colours={colours} label={showQty && name.length > 12 ? name.slice(0, 12) : name} lowPriority={index >= 3}/></td>
                    {showQty && <td className="col-1" style={{textAlign: "right"}}><p>{entry.qty}</p></td>}
                    <td className="col-1" title={entry.qty.toString()}><p style={{color: colour}}>{entry.value.toFixed(1)}%</p></td>
                </tr>;
            })}</tbody>
        </table>
    </div>;
}

function FastestBoard({descriptor, data, colours}: {
    descriptor: BoardDescriptor,
    data: any,
    colours: Map<string, string>,
}) {
    const entries = (data?.[CategoryType.FASTEST]?.[descriptor.id] ?? []) as FastestEntry[];
    if (entries.length === 0) return null;
    return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
        <p className="tableHeader">{descriptor.fastest}</p>
        <table className="table table-dark caption-top">
            <thead><tr><th>#</th><th id="name">Name</th><th>Time</th></tr></thead>
            <tbody>{entries.map((entry, index) => <tr key={`${entry.uuid}-${entry.runId}`}>
                <td className="col-1"><p>{index + 1}</p></td>
                <td className="col-10"><PlayerLink entry={entry} colours={colours} lowPriority={index >= 3}/></td>
                <td className="col-1"><Link href={`/run/${entry.runId}/`} prefetch={false} style={{marginLeft: 5, textDecoration: "none"}}><p>{formatTime(entry.value)}</p></Link></td>
            </tr>)}</tbody>
        </table>
    </div>;
}

export default async function MainLeaderboardTables({days, view, showQty, bastionFort}: {
    days: number,
    view: LeaderboardView,
    showQty: boolean,
    bastionFort: boolean,
}) {
    const [data, users] = await Promise.all([
        getCached(getTrimmedLeaderboards, "getTrimmedLeaderboards", days),
        getCached(getAllUserInfo, "getAllUserInfo") as Promise<UserInfo[]>,
    ]);
    const colours = playerColours(users, data);
    const structureBoards = splitBoards[bastionFort ? "separate" : "combined"];
    const boards = [fixedBoards[0], ...structureBoards, ...fixedBoards.slice(1)];

    if (view === "fastest") {
        return <div className="row stats-row">{boards.map((descriptor) =>
            <FastestBoard key={descriptor.id} descriptor={descriptor} data={data} colours={colours}/>
        )}</div>;
    }
    if (view === "average") {
        return <div className="row stats-row">{boards.map((descriptor) =>
            <AverageBoard key={descriptor.id} descriptor={descriptor} days={days} data={data} colours={colours} showQty={showQty}/>
        )}</div>;
    }
    if (view === "conversion") {
        return <div className="row stats-row">{boards.map((descriptor) =>
            <ConversionBoard key={descriptor.id} descriptor={descriptor} days={days} data={data} colours={colours} showQty={showQty}/>
        )}</div>;
    }
    return <div className="row stats-row">{boards.flatMap((descriptor) => [
        <QuantityBoard key={`${descriptor.id}-qty`} descriptor={descriptor} data={data} colours={colours}/>,
        <AverageBoard key={`${descriptor.id}-avg`} descriptor={descriptor} days={days} data={data} colours={colours} showQty={showQty}/>,
    ])}</div>;
}
