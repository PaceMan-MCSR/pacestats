'use client'

import Hamburger from "@/app/Hamburger";
import PlayerSearch from "@/app/components/PlayerSearch";
import PaceManLink from "@/app/components/PaceManLink";
import { usePathname } from "next/navigation";
import { defaultNameColor, getUserColours } from "@/app/utils";
import { UserColoursContext } from "@/app/contexts";
import PendingLink from "@/app/components/PendingLink";
import { usePlayerInfo } from "@/app/components/playerInfoStore";

export default function Header() {
    const path = usePathname();
    const player = path.startsWith("/player/") ? decodeURIComponent(path.split("/")[2] ?? "") : "";
    const lookupName = player === "jojoe77777" ? "COVlD19" : player;
    // Player pages put their player's colours in the store before the first
    // paint (PlayerInfoSeed), so this only asks the server when a page did not.
    const playerTheme = usePlayerInfo(lookupName || null);

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
        if(playerTheme){
            const c = getUserColours([{
                uuid: playerTheme.id,
                displayName: playerTheme.displayName ?? "",
                color: playerTheme.color ?? "",
                bgColor: playerTheme.bgColor ?? "",
            }], playerTheme.id);
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
                    <Hamburger/>
                </div>
            </nav>
        </div>
        <div className="d-none d-sm-block">
            <nav className={`navbar navbar-expand-sm ${!colours.isCustom ? "navbar-dark bg-dark" : ""}`} style={{
                backgroundColor: `#${colours.fg}`
            }}>
                <div className="container">
                    <PendingLink className="navbar-brand" href="/" style={colours.fgText}>Pace Stats</PendingLink>
                    <ul className="navbar-nav me-auto">
                        <li className="nav-item">
                            <PendingLink className="nav-link" href="/" style={colours.fgText}>Leaderboards</PendingLink>
                        </li>
                        <li className="nav-item">
                            <PendingLink className="nav-link d-none d-lg-block" href="/obs/" style={colours.fgText}>OBS Overlays</PendingLink>
                            <PendingLink className="nav-link d-block d-lg-none" href="/obs/" style={colours.fgText}>OBS</PendingLink>
                        </li>
                        <li className="nav-item">
                            <PendingLink className="nav-link" href="/aa/" style={colours.fgText}>AA</PendingLink>
                        </li>
                        <li className="nav-item">
                            <div className="searchWrapper">
                                <PlayerSearch/>
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
