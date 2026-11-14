import {getAllUserInfo, getCached, getTrimmedLeaderboards, CacheNotReadyError} from "@/app/data";
import LeaderboardUnavailable from "@/app/components/tables/LeaderboardUnavailable";
import LeaderboardTableView from "@/app/components/tables/LeaderboardTableView";
import {createLeaderboardModel} from "@/app/components/tables/leaderboardModel";
import type {LeaderboardView} from "@/app/components/tables/leaderboardModel";

export type {LeaderboardView} from "@/app/components/tables/leaderboardModel";

export default async function MainLeaderboardTables({days, view, showQty, bastionFort}: {
    days: number,
    view: LeaderboardView,
    showQty: boolean,
    bastionFort: boolean,
}) {
    const result = await Promise.all([
        getCached(getTrimmedLeaderboards, "getTrimmedLeaderboards", days),
        getCached(getAllUserInfo, "getAllUserInfo"),
    ]).catch((error) => {
        if (error instanceof CacheNotReadyError) return null;
        throw error;
    });
    if (!result) return <LeaderboardUnavailable/>;
    const [data, users] = result;
    const model = createLeaderboardModel(data, users, days, view, bastionFort);
    return <LeaderboardTableView {...model} showQty={showQty}/>;
}
