import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch, getAllUserInfo,
} from "@/app/data";
import Link from "next/link";
import ResetScroll from "@/app/components/ResetScroll";
import RecentRuns from "@/app/player/[nick]/runs/RecentRuns";
import {Suspense} from "react";
import { Button } from "@mui/material";
import { defaultNameColor, getNameColor } from "@/app/utils";

export default async function Page(
    props: {
        params: Promise<{ nick: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const searchParams = await props.searchParams;
    const params = await props.params;
    let bastionFort = searchParams["bastionFort"] === "true"
    const requestedPage = Number(searchParams["page"] ?? 0);
    const requestedPageSize = Number(searchParams["pageSize"] ?? 25);
    const initialPaginationModel = {
        page: Number.isSafeInteger(requestedPage) && requestedPage >= 0 ? requestedPage : 0,
        pageSize: [10, 25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25,
    };
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

    const userInfo = await getCached(getAllUserInfo, "getAllUserInfo")

    const headUrl = "https://mc-heads.net/avatar/" + uuid + "/8"
    const nameColor = getNameColor(userInfo, uuid)

    return (<main className="main allRuns">
        <div className="container">
            <ResetScroll/>
            <div className="row justify-content-center">
                <div className="col-lg-9 col-xl-8">
                    <h1 className="header mb-3">
                        <Link href={`/player/${realNick}/`}>
                            <Button color={"info"} aria-label="Back to player profile" sx={{
                                marginTop: "-5px",
                                minWidth: "40px",
                                maxWidth: "40px",
                                textTransform: "none",
                            }}>
                                <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    width="24"
                                    height="24"
                                    focusable="false"
                                >
                                    <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" />
                                </svg>
                            </Button>
                        </Link>
                        Run history for <span style={{color: nameColor}}>{realNick}</span>
                        <img className="titleHead mx-2" style={nameColor !== defaultNameColor ? {
                            marginTop: "-5px",
                            border: "4px solid " + nameColor,
                            boxSizing: "content-box",
                        } : {marginTop: "-5px"}} src={headUrl} alt={realNick}/>
                    </h1>
                    <Suspense fallback={<div>Loading...</div>}>
                        <RecentRuns uuid={uuid} bf={bastionFort} initialPaginationModel={initialPaginationModel}/>
                    </Suspense>
                </div>
            </div>
        </div>
    </main>)
}
