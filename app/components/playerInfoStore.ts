// What the browser knows about players by nick: UUID, display name and
// custom colours. Pages that already hold this for their player put it in
// (see PlayerInfoSeed), so the header can colour itself without a request.
// The search box asks for the few players it is showing.

import {useCallback, useEffect, useSyncExternalStore} from "react";
import {PlayerInfoCache} from "@/app/components/playerInfoCache";
import {PlayerInfoRequests} from "@/app/components/playerInfoRequests";
import type {PlayerInfo} from "@/app/components/playerInfoCache";
export type {PlayerInfo} from "@/app/components/playerInfoCache";

// undefined: not asked yet. null: asked, no such player.
const known = new PlayerInfoCache();
const key = (nick: string) => nick.toLocaleLowerCase();

// On a full page load PlayerInfoSeed writes its player into this global from
// an inline script, which runs before the header hydrates.
const PAGE_GLOBAL = "__pacePlayerInfo";

function lookup(name: string): PlayerInfo | null | undefined {
    const cached = known.get(name);
    if (cached !== undefined) return cached;
    // This snapshot is stable until the page's layout effect seeds the cache.
    // Reading it does not notify another component during React rendering.
    return typeof window === "undefined" ? undefined
        : (window as unknown as Record<string, Record<string, PlayerInfo> | undefined>)[PAGE_GLOBAL]?.[name];
}

const requests = new PlayerInfoRequests({
    needed: name => known.hasSubscribers(name),
    lookup,
    store: (name, info) => known.set(name, info),
    fetch: async (names, signal) => {
        const response = await fetch(`/stats/api/getPlayerInfo/?names=${names.map(encodeURIComponent).join(",")}`, {signal});
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
    },
});

function subscribe(name: string, listener: () => void) {
    const release = known.subscribe(name, listener);
    return () => {
        release();
        if (!known.hasSubscribers(name)) requests.cancel(name);
    };
}

export function seedPlayerInfo(nick: string, info: PlayerInfo | null) {
    const name = key(nick);
    requests.cancel(name);
    known.set(name, info);
}

/**
 * Info for one player, or undefined while it is unknown. Asks the server
 * when nothing has been seeded for the nick. Pass null to look up nobody.
 */
export function usePlayerInfo(nick: string | null): PlayerInfo | null | undefined {
    const name = nick === null ? null : key(nick);
    const subscribeToName = useCallback((listener: () => void) => name === null ? () => {} : subscribe(name, listener), [name]);
    const info = useSyncExternalStore(
        subscribeToName,
        () => name === null ? null : lookup(name),
        () => name === null ? null : undefined
    );
    useEffect(() => {
        if (name !== null && info === undefined) requests.request(name);
    }, [name, info]);
    return info;
}
