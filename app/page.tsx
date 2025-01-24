import {getCached, getNPHLeaderboards, getTrimmedLeaderboards} from "@/app/data";
import MainPage from "@/app/MainPage";

export default async function Page({searchParams}: { searchParams: { [key: string]: string | undefined } }) {
    let days: number = parseInt(searchParams["days"] || "30")
    const lb = await getCached(getTrimmedLeaderboards, "getTrimmedLeaderboards", days, 10, true)
    const nph = await getCached(getNPHLeaderboards, "getNPHLeaderboards", days)
    return <MainPage searchParams={searchParams} nph={nph} lb={lb}/>
}