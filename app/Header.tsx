'use client'

import Hamburger from "@/app/Hamburger";
import PlayerSearch from "@/app/components/PlayerSearch";
import PaceManLink from "@/app/components/PaceManLink";
import { usePathname } from "next/navigation";
import { defaultNameColor, getUserColours } from "@/app/utils";
import { UserColoursContext } from "@/app/contexts";

export default function Header({users, userInfo}: { users: any, userInfo: any }) {
    const path = usePathname();
    let colours : any = {
        bg: "rgb(18, 18, 21)",
        fg: "rgb(33,37,41)",
        fgText: {
            color: "rgb(230, 230, 230)",
        },
        bgText: {
            color: "rgb(230, 230, 230)",
        },
        name: defaultNameColor,
    };
    let hasCustomColours = false;
    if (path.startsWith("/player/")) {
        let player = path.split("/")[2];
        if (player === "jojoe77777"){
            player = "COVlD19"
        }
        const uuid = users.find((user: any) => user.nick === player)?.id;
        if(uuid){
            const c = getUserColours(userInfo, uuid);
            if(c.isCustom){
                colours = c
                hasCustomColours = true
            }
        }
    }
    colours.isCustom = hasCustomColours
    return <UserColoursContext.Provider value={colours}>
        <div className="d-sm-none">
            <nav className={`navbar navbar-expand-sm ${!colours.isCustom ? "navbar-dark bg-dark" : ""}`} style={{
                backgroundColor: `#${colours.fg}`
            }}>
                <div className="container">
                    <Hamburger users={users} userInfo={userInfo}/>
                </div>
            </nav>
        </div>
        <div className="d-none d-sm-block">
            <nav className={`navbar navbar-expand-sm ${!colours.isCustom ? "navbar-dark bg-dark" : ""}`} style={{
                backgroundColor: `#${colours.fg}`
            }}>
                <div className="container">
                    <a className="navbar-brand" href="/stats/" style={colours.fgText}>Pace Stats</a>
                    <ul className="navbar-nav me-auto">
                        <li className="nav-item">
                            <a className="nav-link" href="/stats/" style={colours.fgText}>Leaderboards</a>
                        </li>
                        <li className="nav-item">
                            <a className="nav-link d-none d-lg-block" href="/stats/obs/" style={colours.fgText}>OBS Overlays</a>
                            <a className="nav-link d-block d-lg-none" href="/stats/obs/" style={colours.fgText}>OBS</a>
                        </li>
                        <li className="nav-item">
                            <a className="nav-link" href="/stats/aa/" style={colours.fgText}>AA</a>
                        </li>
                        <li className="nav-item">
                            <div className="searchWrapper">
                                <PlayerSearch data={users} userInfo={userInfo}/>
                            </div>
                        </li>
                    </ul>
                    <ul className="navbar-nav d-none d-lg-block">
                        <li className="nav-item">
                            <PaceManLink/>
                        </li>
                    </ul>
                </div>
            </nav>
        </div>
    </UserColoursContext.Provider>
}