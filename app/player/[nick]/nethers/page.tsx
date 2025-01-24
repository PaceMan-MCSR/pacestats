import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch, getRecentNethers,
} from "@/app/data";
import Link from "next/link";
import ResetScroll from "@/app/components/ResetScroll";
import {Nethers} from "@/app/player/[nick]/nethers/Nethers";

export default async function Page({params, searchParams}: {
    params: { nick: string },
    searchParams: { [key: string]: string | undefined }
}) {
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

    const nethers = await getCached(getRecentNethers, "getRecentNethers", uuid, 100)

    const headUrl = "https://mc-heads.net/avatar/" + uuid + "/8"

    return (<main className="main">
        <div className="container">
            <ResetScroll/>
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
                    <Nethers runs={nethers}/>
                </div>
            </div>
        </div>
    </main>)
}