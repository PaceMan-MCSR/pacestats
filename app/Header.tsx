'use client'

import Hamburger from "@/app/Hamburger";
import PlayerSearch from "@/app/components/PlayerSearch";
import PaceManLink from "@/app/components/PaceManLink";
import { usePathname } from "next/navigation";
import { defaultNameColor, getUserColours } from "@/app/utils";
import { UserColoursContext } from "@/app/contexts";
import { useEffect, useState } from "react";
import Link from "next/link";

type PlayerTheme = {
    id: string;
    displayName: string | null;
    color: string | null;
    bgColor: string | null;
};

export default function Header() {
    const path = usePathname();
    const [playerTheme, setPlayerTheme] = useState<PlayerTheme | null>(null);

    useEffect(() => {
        const player = path.startsWith("/player/") ? path.split("/")[2] : null;
        if (!player) return;

        const lookupName = player === "jojoe77777" ? "COVlD19" : player;
        const controller = new AbortController();
        fetch(`/stats/api/searchPlayers/?q=${encodeURIComponent(lookupName)}&limit=8`, {
            signal: controller.signal,
        })
            .then((response) => response.ok ? response.json() : [])
            .then((results) => {
                const match = results.find((result: any) =>
                    result.name.toLocaleLowerCase() === lookupName.toLocaleLowerCase()
                );
                setPlayerTheme(match ?? null);
            })
            .catch((error) => {
                if (error.name !== "AbortError") setPlayerTheme(null);
            });
        return () => controller.abort();
    }, [path]);

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
                    <Link className="navbar-brand" href="/" style={colours.fgText}>Pace Stats</Link>
                    <ul className="navbar-nav me-auto">
                        <li className="nav-item">
                            <Link className="nav-link" href="/" style={colours.fgText}>Leaderboards</Link>
                        </li>
                        <li className="nav-item">
                            <Link className="nav-link d-none d-lg-block" href="/obs/" style={colours.fgText}>OBS Overlays</Link>
                            <Link className="nav-link d-block d-lg-none" href="/obs/" style={colours.fgText}>OBS</Link>
                        </li>
                        <li className="nav-item">
                            <Link className="nav-link" href="/aa/" style={colours.fgText}>AA</Link>
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
