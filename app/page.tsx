import MainPage from "@/app/MainPage";
import type { LeaderboardView } from "@/app/components/tables/MainLeaderboardTables";

const validDays = new Set([1, 7, 30, 9999]);
const validViews = new Set<LeaderboardView>(["count_avg", "average", "fastest", "conversion"]);

export default async function Page(props: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
    const searchParams = await props.searchParams;
    const requestedDays = Number.parseInt(searchParams.days || "30", 10);
    const days = validDays.has(requestedDays) ? requestedDays : 30;
    const requestedView = searchParams.category || "count_avg";
    const view = validViews.has(requestedView as LeaderboardView)
        ? requestedView as LeaderboardView
        : "count_avg";

    return <MainPage
        days={days}
        view={view}
        showQty={searchParams.showQty === "true"}
        bastionFort={searchParams.bastionFort === "true"}
    />;
}
