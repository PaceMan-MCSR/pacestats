import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getLeaderboards, getPlayerRuns,
    getTwitchAccounts, getNPH, isTwitchLive, getAALB, getRecentAARuns,
} from "@/app/data";
import Link from "next/link";
import {CategoryType, fixDisplayName, getMinAAQty, getMinQty} from "@/app/utils";
import AAPlayerPage from "@/app/player/[nick]/aa/AAPlayerPage";

export async function generateMetadata(props: { params: Promise<{ nick: string }> }) {
    const params = await props.params;
    let nick = params.nick
    if (nick === "jojoe77777" || nick === "jojoe" || nick === "COVID19") nick = "COVlD19"
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", nick)
    if (names === null) {
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", nick)
    }
    if(names === null){
        return {
            title: 'Unknown player',
            description: 'jojoe7SadPag',
            icons: {
                icon: [
                    '/stats/jojoe7sadpag.ico'
                ]
            }
        }
    }
    const realNick = names.nick
    const uuid = names.uuid
    return {
        title: 'Stats for ' + realNick,
        description: '',
        icons: {
            icon: [
                `https://mc-heads.net/avatar/${uuid}/8`
            ]
        }
    }
}

export default async function Page(
    props: {
        params: Promise<{ nick: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const searchParams = await props.searchParams;
    const params = await props.params;
    let days: number = parseInt(searchParams["days"] || "30")
    if (isNaN(days)) {
        days = 30
    }
    // don't let users specify custom ranges at this stage, to avoid lb cache misses
    if (days !== 1 && days !== 7 && days !== 30 && days !== 9999) {
        days = 30
    }
    let nick = params.nick
    if (nick === "jojoe77777" || nick === "jojoe" || nick === "COVID19") nick = "COVlD19"
    let names = await getCached(getAllNamesByNick, "getAllNamesByNick", nick)
    if (names === null) {
        names = await getCached(getAllNamesByTwitch, "getAllNamesByTwitch", nick)
    }
    if (names === null) return (<main className="main playerStats">
        <div className="container">
            <h1 className="header">Player not found</h1>
            <div className="row">
                <Link href="/player" className="goBack">
                    <button className="btn btn-dark">Back</button>
                </Link>
            </div>
        </div>
    </main>)

    let realNick = fixDisplayName(names.nick)
    const uuid = names.uuid
    const lb = await getCached(getAALB, "getAALB", days + " day")
    const filters = [
        CategoryType.AVG,
        CategoryType.COUNT,
        CategoryType.FASTEST,
        CategoryType.CONVERSION
    ]

    // Define stats categories
    const categories = [
        "nether",
        "bastion",
        "fortress",
        "stronghold",
        "end",
        "elytra",
        "credits",
        "finish"
    ]

    const data: { [category: string]: { [filter: number]: { ranking: number, value: number } } } = {}
    for (const category of categories) {
        data[category] = {}
    }

    for(const filter of filters) {
        for (const category of categories) {
            const minQty = getMinAAQty(category, days)
            const board = lb[filter][category]
            let i = 0
            for (const entry of board) {
                if (entry.qty === 0) continue;
                if (entry.qty < minQty && entry.uuid !== uuid) continue;
                i++;
                if (entry.uuid === uuid) {
                    data[category][filter] = {ranking: entry.qty < minQty ? -1 : i, value: entry.value}
                    break
                }
            }
        }
    }

    const recentRuns = await getCached(getRecentAARuns, "getRecentAARuns", uuid, 4)
    const nph = await getCached(getNPH, "getNPH", uuid, days * 24, days * 24)

    const twitches = await getCached(getTwitchAccounts, "getTwitchAccounts", uuid) as { twitch: string, time: number }[]
    let t = [];
    if(twitches !== null) {
        t = await Promise.all(twitches.map(async (t): Promise<any> => {
            return {twitch: t.twitch, time: t.time, live: await getCached(isTwitchLive, "isTwitchLive", t.twitch)}
        }));
    }
    return <AAPlayerPage name={realNick} uuid={uuid} recentRuns={recentRuns} twitches={t} nph={nph} data={data} days={days} />
}