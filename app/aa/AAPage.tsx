import RangeChange from "@/app/components/RangeChange";
import FilterChange from "@/app/components/FilterChange";
import ToggleQty from "@/app/components/ToggleQty";
import LeaderboardTableView from "@/app/components/tables/LeaderboardTableView";
import type {LeaderboardModel} from "@/app/components/tables/leaderboardModel";

export default function AAPage({model, showQty}: {model: LeaderboardModel, showQty: boolean}) {
    return <main className="main">
        <div className="container">
            <h1 className="header">All Advancements Stats</h1>
            <div className="row justify-content-center align-content-center">
                <div className="col-10 col-sm-9 col-md-6 col-lg-5 col-xl-4 col-xxl-4">
                    <div className="topRow mb-2 mt-2"><ToggleQty/></div>
                </div>
            </div>
            <div className="row"><div className="col-12"><RangeChange/></div></div>
            <div className="row justify-content-center align-content-center">
                <div className="col-10 col-sm-9 col-md-6 col-lg-5 col-xl-4 col-xxl-4"><FilterChange/></div>
            </div>
            <LeaderboardTableView {...model} showQty={showQty}/>
            <div className="footer">
                <a href="https://paceman.gg">Main PaceMan site</a><br/>
                <a href="/stats/api/">API Documentation</a>
                <p>Stats site created by <a href="https://twitch.tv/jojoe77777">jojoe77777</a></p>
            </div>
        </div>
    </main>;
}
