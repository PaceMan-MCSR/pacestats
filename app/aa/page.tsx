import { getAllUserInfo, getCached, getTrimmedAALB } from "@/app/data";
import AAPage from "@/app/aa/AAPage";
import {normalizeDays} from "@/app/utils";
import {createLeaderboardModel} from "@/app/components/tables/leaderboardModel";
import type {LeaderboardView} from "@/app/components/tables/leaderboardModel";

const views = new Set<LeaderboardView>(["count_avg", "average", "fastest", "conversion"]);

export default async function Page(props: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
    const searchParams = await props.searchParams;
    const days = normalizeDays(searchParams.days);
    const view = views.has(searchParams.category as LeaderboardView) ? searchParams.category as LeaderboardView : "count_avg";
    const [lb, users] = await Promise.all([
        getCached(getTrimmedAALB, "getTrimmedAALB", days, 10, false),
        getCached(getAllUserInfo, "getAllUserInfo"),
    ]);
    const model = createLeaderboardModel(lb, users, days, view, false, true);
    return <AAPage model={model} showQty={searchParams.showQty === "true"}/>;
}
