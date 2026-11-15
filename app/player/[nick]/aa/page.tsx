import {recentRunRows} from '@/app/components/profile/recentRunPresentation';
import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getAAPlayerStats, getRecentAARuns, getUserInfo,
} from "@/app/data";
import Link from "next/link";
import {fixDisplayName} from "@/app/utils";
import AAPlayerPage from "@/app/player/[nick]/aa/AAPlayerPage";
import PlayerInfoSeed from "@/app/components/PlayerInfoSeed";

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
                `https://mc-api.io/render/FACE/${uuid}?size=8`
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
    // Independent reads: start them together instead of one after another.
    const [data, recentRuns, playerUser] = await Promise.all([
        getAAPlayerStats(uuid, days),
        getCached(getRecentAARuns, "getRecentAARuns", uuid, 4),
        // Customization is optional; a failed read leaves the header's normal
        // browser lookup available rather than failing the statistics page.
        getCached(getUserInfo, "getUserInfo", uuid).catch(() => undefined),
    ])

    return <>
        {playerUser !== undefined && <PlayerInfoSeed nick={names.nick} info={{
            id: uuid,
            displayName: playerUser?.displayName ?? null,
            color: playerUser?.color ?? null,
            bgColor: playerUser?.bgColor ?? null,
        }}/>}
        <AAPlayerPage name={realNick} uuid={uuid} recentRuns={recentRunRows(recentRuns, true)} data={data} days={days}/>
    </>
}
