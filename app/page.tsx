import {
    fetchFastestLeaderboardsFromRedis,
    getAllUserInfo,
    getCached,
    getNPHLeaderboards,
    getTrimmedLeaderboards
} from "@/app/data";
import MainPage from "@/app/MainPage";

export default async function Page(props: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
    const searchParams = await props.searchParams;
    let days: number = parseInt(searchParams["days"] || "30")
    const lb = await getCached(getTrimmedLeaderboards, "getTrimmedLeaderboards", days, 10, true)
    const fastest = await getCached(fetchFastestLeaderboardsFromRedis, "fetchFastestLeaderboardsFromRedis", days)
    //const nph = await getCached(getNPHLeaderboards, "getNPHLeaderboards", days)
    const nph = null;
    const users = await getCached(getAllUserInfo, "getAllUserInfo")
    return <MainPage searchParams={searchParams} nph={nph} lb={lb} fastest={fastest} users={users}/>
}