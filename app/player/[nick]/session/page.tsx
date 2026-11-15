import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch,
    getNPH, getSessionStats, getUserInfo,
} from "@/app/data";
import Link from "next/link";
import {fixDisplayName} from "@/app/utils";
import SessionPage from "@/app/player/[nick]/session/SessionPage";
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
        title: 'Session stats for ' + realNick,
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

    // Independent reads: start them together instead of one after another.
    const [session, nph, playerUser] = await Promise.all([
        getCached(getSessionStats, "getSessionStats", uuid, hours, hoursBetween),
        getCached(getNPH, "getNPH", uuid, hours, hoursBetween),
        getCached(getUserInfo, "getUserInfo", uuid).catch(() => undefined),
    ])
    return <>
        {playerUser !== undefined && <PlayerInfoSeed nick={names.nick} info={{
            id: uuid,
            displayName: playerUser?.displayName ?? null,
            color: playerUser?.color ?? null,
            bgColor: playerUser?.bgColor ?? null,
        }}/>}
        <SessionPage name={realNick} uuid={uuid} nph={nph} data={session} hours={hours} hoursBetween={hoursBetween}/>
    </>
}
