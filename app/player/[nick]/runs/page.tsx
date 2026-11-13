import {
    getCached,
    getAllNamesByNick,
    getAllNamesByTwitch, getAllUserInfo, getPlayerRunsOffsetPage,
} from "@/app/data";
import Link from "next/link";
import ResetScroll from "@/app/components/ResetScroll";
import RecentRuns from "@/app/player/[nick]/runs/RecentRuns";
import {Suspense} from "react";
import { defaultNameColor, getNameColor } from "@/app/utils";
import PlayerInfoSeed from "@/app/components/PlayerInfoSeed";

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
    const sortableColumns = new Set([
        "date", "nether", "bastion", "fortress", "first_structure", "second_structure",
        "first_portal", "stronghold", "end", "finish",
    ]);
    const requestedSort = searchParams["sort"] ?? "";
    const hiddenSortColumns = bastionFort
        ? new Set(["first_structure", "second_structure"])
        : new Set(["bastion", "fortress"]);
    const initialSort = {
        column: sortableColumns.has(requestedSort) && !hiddenSortColumns.has(requestedSort) ? requestedSort : "date",
        direction: searchParams["direction"] === "asc" ? "asc" as const : "desc" as const,
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

    // Send the first page of runs with the page itself. The table used to
    // fetch it after rendering, which cost a second round trip.
    const [userInfo, initialRuns] = await Promise.all([
        getCached(getAllUserInfo, "getAllUserInfo"),
        getCached(
            getPlayerRunsOffsetPage,
            "getPlayerRunsOffsetPage",
            uuid,
            initialPaginationModel.page,
            initialPaginationModel.pageSize,
            [],
            initialSort
        ).catch(() => null),
    ])

    const headUrl = "https://mc-api.io/render/FACE/" + uuid + "?size=8"
    const nameColor = getNameColor(userInfo, uuid)
    const playerUser = (userInfo as any[])?.find((user) => user.uuid === uuid)

    return (<main className="main allRuns">
        <div className="container">
            <ResetScroll/>
            <PlayerInfoSeed nick={names.nick} info={{
                id: uuid,
                displayName: playerUser?.displayName || null,
                color: playerUser?.color || null,
                bgColor: playerUser?.bgColor || null,
            }}/>
            <div className="row justify-content-center">
                <div className="col-lg-9 col-xl-8">
                    <h1 className="header mb-3">
                        <Link href={`/player/${realNick}/`} className="runsBackButton" aria-label="Back to player profile">
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                width="24"
                                height="24"
                                focusable="false"
                            >
                                <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" />
                            </svg>
                        </Link>
                        Run history for <span style={{color: nameColor}}>{realNick}</span>
                        <img className="titleHead mx-2" style={nameColor !== defaultNameColor ? {
                            marginTop: "-5px",
                            border: "4px solid " + nameColor,
                            boxSizing: "content-box",
                        } : {marginTop: "-5px"}} src={headUrl} alt={realNick}/>
                    </h1>
                    <Suspense fallback={<div>Loading...</div>}>
                        <RecentRuns
                            uuid={uuid}
                            bf={bastionFort}
                            initialPaginationModel={initialPaginationModel}
                            initialSort={initialSort}
                            initialRuns={initialRuns}
                        />
                    </Suspense>
                </div>
            </div>
        </div>
    </main>)
}
