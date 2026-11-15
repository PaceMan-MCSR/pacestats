import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch, getRecentNethers, getUserInfo,
} from "@/app/data";
import Link from "next/link";
import ResetScroll from "@/app/components/ResetScroll";
import {Nethers} from "@/app/player/[nick]/nethers/Nethers";
import {trackerRows} from "./presentation";
import PlayerInfoSeed from "@/app/components/PlayerInfoSeed";

export default async function Page(
    props: {
        params: Promise<{ nick: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const params = await props.params;
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
    let realNick = names.nick
    if (realNick === "COVlD19") {
        realNick = "jojoe77777"
    }
    const uuid = names.uuid

    const [nethers, playerUser] = await Promise.all([
        getCached(getRecentNethers, "getRecentNethers", uuid, 100),
        getCached(getUserInfo, "getUserInfo", uuid).catch(() => undefined),
    ]);

    const headUrl = "https://mc-api.io/render/FACE/" + uuid + "?size=8"

    return (<main className="main">
        <div className="container">
            <ResetScroll/>
            {playerUser !== undefined && <PlayerInfoSeed nick={names.nick} info={{
                id: uuid,
                displayName: playerUser?.displayName ?? null,
                color: playerUser?.color ?? null,
                bgColor: playerUser?.bgColor ?? null,
            }}/>}
            <div className="row justify-content-center">
                <div className="col-lg-10 col-xl-8">
                    <h1 className="header mb-4">
                        Recent NPH tracker data for {realNick}
                        <img className="titleHead mx-2" src={headUrl} alt={realNick}/>
                    </h1>
                    <div style={{textAlign: "center"}} className="mb-4">
                        <Link href={`/player/${realNick}/`}>
                            <button className="btn btn-dark">Back to Profile</button>
                        </Link>
                    </div>
                    <p>This page is currently intended to be used for debugging issues with the tracker,
                        to make sure it is tracking accurately.
                        More stats such as NPH over time may be included here in the future.</p>
                    <Nethers runs={trackerRows(nethers)}/>
                </div>
            </div>
        </div>
    </main>)
}
