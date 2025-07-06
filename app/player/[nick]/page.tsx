import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getPlayerRuns,
    getAllUserInfo, fetchPlayerStatsFromRedis, fetchTwitchesFromRedis, fetchNphFromRedis,
} from "@/app/data";
import Link from "next/link";
import {fixDisplayName} from "@/app/utils";
import PlayerPage from "@/app/player/[nick]/PlayerPage";

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
    let bastionFort = searchParams["bastionFort"] === "true"
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

    const data = await fetchPlayerStatsFromRedis(uuid, days);
    const recentRuns = await getCached(getPlayerRuns, "getPlayerRuns", uuid, 4)
    const nph = await fetchNphFromRedis(uuid, days)
    const users = await getCached(getAllUserInfo, "getAllUserInfo")

    const twitches = await fetchTwitchesFromRedis(uuid);
    return <PlayerPage name={realNick} uuid={uuid} recentRuns={recentRuns} twitches={twitches} nph={nph} data={data} days={days} bf={bastionFort} users={users} />
}