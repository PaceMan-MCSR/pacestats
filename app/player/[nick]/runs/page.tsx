import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch, getAllPlayerRuns, getAllPlayerRunsOptimized,
} from "@/app/data";
import Link from "next/link";
import ResetScroll from "@/app/components/ResetScroll";
import RecentRuns from "@/app/player/[nick]/runs/RecentRuns";
import {Suspense} from "react";
import { Button } from "@mui/material";

export default async function Page({params, searchParams}: {
    params: { nick: string },
    searchParams: { [key: string]: string | undefined }
}) {
    let bastionFort = searchParams["bastionFort"] === "true"
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

    const recentRuns = await getCached(getAllPlayerRunsOptimized, "getAllPlayerRunsOptimized", uuid)

    const headUrl = "https://mc-heads.net/avatar/" + uuid + "/8"

    return (<main className="main allRuns">
        <div className="container">
            <ResetScroll/>
            <div className="row justify-content-center">
                <div className="col-lg-9 col-xl-8">
                    <h1 className="header mb-3">
                        <Link href={`/player/${realNick}/`}>
                            <Button color={"info"} sx={{
                                marginTop: "-5px",
                                minWidth: "40px",
                                maxWidth: "40px",
                            }}>
                                <span className="material-symbols-outlined">arrow_back</span>
                            </Button>
                        </Link>
                        Run history for {realNick}
                        <img className="titleHead mx-2" style={{
                            marginTop: "-5px"
                        }} src={headUrl} alt={realNick}/>
                    </h1>
                    <Suspense fallback={<div>Loading...</div>}>
                        <RecentRuns runs={recentRuns} bf={bastionFort}/>
                    </Suspense>
                </div>
            </div>
        </div>
    </main>)
}