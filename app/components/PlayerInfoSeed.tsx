'use client'

import {useLayoutEffect} from "react";
import {usePathname} from "next/navigation";
import {seedPlayerInfo} from "@/app/components/playerInfoStore";
import type {PlayerInfo} from "@/app/components/playerInfoStore";

/**
 * Rendered by player pages, which already know their player's colours. The
 * header reads them from the store and paints in the same frame as the page;
 * it used to fetch them after rendering and recolour one round trip later.
 */
export default function PlayerInfoSeed({nick, info}: {nick: string, info: PlayerInfo}) {
    const path = usePathname();
    // The name in the address bar can differ from the nick (an old name, a
    // Twitch name, different capitals); the header looks up what the bar says.
    const pathName = path.startsWith("/player/") ? decodeURIComponent(path.split("/")[2] ?? "") : "";
    const {id, displayName, color, bgColor} = info;

    useLayoutEffect(() => {
        const value = {id, displayName, color, bgColor};
        seedPlayerInfo(nick, value);
        if (pathName) seedPlayerInfo(pathName, value);
    }, [nick, pathName, id, displayName, color, bgColor]);

    // Client navigations are covered by the effect above. On a full page load
    // the header hydrates before this component does, so the same data also
    // goes out as an inline script that runs while the HTML is parsed.
    const value = JSON.stringify({id, displayName, color, bgColor});
    const keys = [...new Set([nick, pathName].filter(Boolean).map((name) => name.toLocaleLowerCase()))];
    const script = `(function(s){${keys.map((name) => `s[${JSON.stringify(name)}]=${value};`).join("")}})(self.__pacePlayerInfo=self.__pacePlayerInfo||{})`
        // Keep data from closing the script element.
        .replace(/</g, "\\u003c");
    return <script dangerouslySetInnerHTML={{__html: script}} suppressHydrationWarning/>;
}
