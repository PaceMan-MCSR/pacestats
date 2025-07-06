import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getTwitchAccounts, getNPH, isTwitchLive, getSessionStats,
} from "@/app/data";
import Link from "next/link";
import {fixDisplayName} from "@/app/utils";
import SessionPage from "@/app/player/[nick]/session/SessionPage";

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
        title: 'Session stats for ' + realNick,
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
    let hours: number = parseInt(searchParams["hours"] || "24")
    let hoursBetween: number = parseInt(searchParams["hoursBetween"] || "3")
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

    const session = await getCached(getSessionStats, "getSessionStats", uuid, hours, hoursBetween)
    const nph = await getCached(getNPH, "getNPH", uuid, hours, hoursBetween)

    const twitches = await getCached(getTwitchAccounts, "getTwitchAccounts", uuid) as { twitch: string, time: number }[]
    let t = [];
    if(twitches !== null) {
        t = await Promise.all(twitches.map(async (t): Promise<any> => {
            return {twitch: t.twitch, time: t.time, live: await getCached(isTwitchLive, "isTwitchLive", t.twitch)}
        }));
    }
    return <SessionPage name={realNick} uuid={uuid} twitches={t} nph={nph} data={session} hours={hours} hoursBetween={hoursBetween} />
}