import { Suspense } from "react";
import RangeChange from "@/app/components/RangeChange";
import FilterChange from "@/app/components/FilterChange";
import ToggleQty from "@/app/components/ToggleQty";
import BastionFort from "@/app/components/BastionFort";
import MainLeaderboardTables, { LeaderboardView } from "@/app/components/tables/MainLeaderboardTables";

function LeaderboardSkeleton({className = ""}: {className?: string}) {
    return <div className={`tableWrapper leaderboardSkeleton col-sm-12 col-md-6 col-xl-4 col-xxl-3 ${className}`} aria-hidden="true">
        <p className="tableHeader"><span className="leaderboardSkeletonBar leaderboardSkeletonTitle"/></p>
        <table className="table table-dark">
            <thead><tr><th>#</th><th>Name</th><th>Qty</th></tr></thead>
            <tbody>{Array.from({length: 10}, (_, index) => <tr key={index}>
                <td className="col-1"><p>{index + 1}</p></td>
                <td className="col-10">
                    <span className="leaderboardSkeletonAvatar"/>
                    <span className="leaderboardSkeletonBar leaderboardSkeletonName"/>
                </td>
                <td className="col-1"><span className="leaderboardSkeletonBar leaderboardSkeletonValue"/></td>
            </tr>)}</tbody>
        </table>
    </div>;
}

function LeaderboardFallback() {
    return <div className="row stats-row" aria-busy="true" aria-label="Loading leaderboards">
        <LeaderboardSkeleton/>
        <LeaderboardSkeleton className="d-none d-md-block"/>
        <LeaderboardSkeleton className="d-none d-xl-block"/>
        <LeaderboardSkeleton className="d-none d-xxl-block"/>
    </div>;
}

export default function MainPage({days, view, showQty, bastionFort}: {
    days: number,
    view: LeaderboardView,
    showQty: boolean,
    bastionFort: boolean,
}) {
    return <main className="main">
        <div className="container">
            <h1 className="header">Stats Leaderboards</h1>
            <h6 className="subheader">Click on a player to see their stats</h6>
            <div className="row justify-content-center align-content-center">
                <div className="col-10 col-sm-9 col-md-6 col-lg-5 col-xl-4 col-xxl-4">
                    <div className="topRow mb-2">
                        <ToggleQty/>
                        <BastionFort/>
                    </div>
                </div>
            </div>
            <div className="row">
                <div className="col-12">
                    <RangeChange/>
                </div>
            </div>
            <div className="row justify-content-center align-content-center">
                <div className="col-10 col-sm-9 col-md-6 col-lg-5 col-xl-4 col-xxl-4">
                    <FilterChange/>
                </div>
            </div>
            <Suspense fallback={<LeaderboardFallback/>}>
                <MainLeaderboardTables
                    days={days}
                    view={view}
                    showQty={showQty}
                    bastionFort={bastionFort}
                />
            </Suspense>
            <div className="footer">
                <a href="https://paceman.gg">Main PaceMan site</a><br/>
                <a href="/stats/api/">API Documentation</a>
                <p>Stats site created by <a href="https://twitch.tv/jojoe77777">jojoe77777</a></p>
            </div>
        </div>
    </main>;
}
