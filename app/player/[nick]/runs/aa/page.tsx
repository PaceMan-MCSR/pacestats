import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch, getAllPlayerRuns, getRecentAARuns,
} from "@/app/data";
import Link from "next/link";
import ResetScroll from "@/app/components/ResetScroll";
import {Suspense} from "react";
import AARecentRuns from "@/app/player/[nick]/runs/aa/AARecentRuns";

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

    const recentRuns = await getCached(getRecentAARuns, "getRecentAARuns", uuid, 200)

    const headUrl = "https://mc-heads.net/avatar/" + uuid + "/8"

    return (<main className="main allRuns">
        <div className="container">
            <ResetScroll/>
            <div className="row justify-content-center">
                <div className="col-lg-8 col-xl-7">
                    <h1 className="header mb-4">
                        Recent AA runs for {realNick}
                        <img className="titleHead mx-2" src={headUrl} alt={realNick}/>
                    </h1>
                    <div style={{textAlign: "center"}} className="mb-4">
                        <Link href={`/player/${realNick}/aa/`}>
                            <button className="btn btn-dark">Back to Profile</button>
                        </Link>
                    </div>
                    <Suspense fallback={<div>Loading...</div>}>
                        <AARecentRuns runs={recentRuns}/>
                    </Suspense>
                </div>
            </div>
        </div>
    </main>)
}