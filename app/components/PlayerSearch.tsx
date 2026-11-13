'use client';

import SearchAutocomplete from "@/app/components/search/SearchAutocomplete";
import { useRouter } from 'next/navigation'
import {SearchName} from "@/app/types";
import { defaultNameColor, getDarkerColor, getNameColor } from "@/app/utils";
import { useContext, useEffect, useRef, useState } from "react";
import { UserColoursContext, UsersContext } from "@/app/contexts";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { schedulePlayerPrefetch } from "@/app/components/playerPrefetch";
import { usePlayerInfo } from "@/app/components/playerInfoStore";

type SearchItem = SearchName & { color?: string | null };

// Player pages loaded in full after a hover, kept for as long as the router
// reuses them.
const fullyPrefetchedPlayers = new Set<string>();

let playerNamesRequest: Promise<SearchItem[]> | undefined;
// Shared by every search box on the page and kept across client navigations.
let loadedPlayerNames: SearchItem[] | null = null;

// A blank image keeps the row's layout until the player's UUID is known.
const BLANK_AVATAR = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function loadPlayerNames() {
    // Names and Twitch handles only (about 45 KB compressed, against 155 KB
    // for the full list with UUIDs). Each entry is a nick or
    // [nick, ...twitchHandles]. SearchResult asks for the UUID and colour of
    // the few players that reach the screen.
    playerNamesRequest ??= fetch("/stats/api/getPlayerNames/")
        .then((response) => {
            if (!response.ok) throw new Error(`Unable to load player names (${response.status})`);
            return response.json() as Promise<Array<string | string[]>>;
        })
        .then((names) => {
            const players = names.map((entry): SearchItem => {
                const [nick, ...twitches] = typeof entry === "string" ? [entry] : entry;
                // The nick stands in as the id; it is unique in the list.
                return {id: nick, nick, twitches};
            });
            loadedPlayerNames = players;
            return players;
        })
        .catch((error) => {
            playerNamesRequest = undefined;
            throw error;
        });
    return playerNamesRequest;
}

function SearchResult({item, colourUsers}: {item: SearchItem, colourUsers: any}) {
    // Items from the name list carry no UUID; items from a per-query search do.
    const needsInfo = item.id === item.nick;
    const info = usePlayerInfo(needsInfo ? item.nick : null);
    const uuid = needsInfo ? info?.id : item.id;
    const colour = item.color ?? info?.color;
    const nameColor = colour ? `#${colour}` : uuid ? getNameColor(colourUsers, uuid) : defaultNameColor;
    return (
        <span style={{ display: 'block', textAlign: 'left' }}>
            <img
                className="avatarSmall"
                src={uuid ? `https://mc-api.io/render/FACE/${uuid}?size=8` : BLANK_AVATAR}
                alt={item.nick}
                style={{
                    marginTop: '-2px',
                }}
            />
            <span style={{
                color: nameColor,
                filter: nameColor !== defaultNameColor ? `drop-shadow(0px 0px 1px #000000) drop-shadow(0px 0px 1px #000000)` : '',
                fontSize: '1.15em',
            }}>{item.nick}</span>
        </span>
    );
}

export default function PlayerSearch({data, input, setOutput, userInfo}: {
    data?: SearchName[], input?: any, setOutput?: any, userInfo?: any
}) {
    const colours = useContext(UserColoursContext);
    const contextUserInfo = useContext(UsersContext);
    const hasColours = colours?.isCustom
    const router = useRouter()
    const [remoteItems, setRemoteItems] = useState<SearchItem[]>([]);
    const [loadedItems, setLoadedItems] = useState<SearchItem[] | null>(null);
    const mounted = useRef(true);
    const searchController = useRef<AbortController | null>(null);
    const searchPrefetches = useRef<Array<() => void>>([]);
    const items = data ?? loadedItems ?? remoteItems;
    const colourUsers = userInfo ?? contextUserInfo;

    const prefetchPlayer = (nick: string) => {
        if (setOutput !== undefined) return;
        const path = `/player/${nick}`;
        return schedulePlayerPrefetch(path, () => router.prefetch(path));
    };

    const clearSearchPrefetches = () => {
        searchPrefetches.current.forEach((release) => release());
        searchPrefetches.current = [];
    };

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    // The full player list is several hundred kilobytes, and most page views
    // (every OBS overlay among them) never touch the search box. Fetch it when
    // someone shows intent to search; per-query search covers the gap.
    const requestPlayerNames = () => {
        if (data !== undefined || loadedItems !== null) return;
        if (loadedPlayerNames !== null) {
            setLoadedItems(loadedPlayerNames);
            return;
        }
        loadPlayerNames()
            .then((players) => {
                if (mounted.current) setLoadedItems(players);
            })
            .catch(() => {
                // Per-query search remains available if the background list fails.
            });
    };

    useEffect(() => () => clearSearchPrefetches(), []);

    const handleOnSearch = (query: string) => {
        if (data !== undefined || loadedItems !== null) return;
        searchController.current?.abort();
        if (query.trim().length < 2) {
            clearSearchPrefetches();
            setRemoteItems([]);
            return;
        }

        const controller = new AbortController();
        searchController.current = controller;
        fetch(`/stats/api/searchPlayers/?q=${encodeURIComponent(query)}&limit=8`, {
            signal: controller.signal,
        })
            .then((response) => response.ok ? response.json() : [])
            .then((results) => {
                const nextItems: SearchItem[] = results.map((result: any) => ({
                    id: result.id,
                    nick: result.name,
                    twitches: [],
                    color: result.color,
                }));
                setRemoteItems(nextItems);
                clearSearchPrefetches();
                searchPrefetches.current = nextItems
                    .slice(0, 5)
                    .map((item: SearchItem) => prefetchPlayer(item.nick))
                    .filter((release): release is () => void => release !== undefined);
            })
            .catch((error) => {
                if (error.name !== "AbortError") setRemoteItems([]);
            });
    };

    const handleOnSelect = (item: any) => {
        if(setOutput !== undefined){
            setOutput(item.nick)
        } else {
            router.push(`/player/${item.nick}`)
        }
        // @ts-ignore
        document.activeElement.blur()
    }


    // Hovering or arrowing to a result is a strong sign of intent, so load
    // the whole player page. Selecting it then needs no request.
    const handleOnHover = (item: any) => {
        if (setOutput !== undefined) return;
        const path = `/player/${item.nick}`;
        if (fullyPrefetchedPlayers.has(path)) return;
        fullyPrefetchedPlayers.add(path);
        setTimeout(() => fullyPrefetchedPlayers.delete(path), 30_000);
        router.prefetch(path, {kind: PrefetchKind.FULL});
    }

    const formatResult = (item: any) => <SearchResult item={item} colourUsers={colourUsers}/>;

    const themeStyle = hasColours ? {
        "--search-background": `#${getDarkerColor(colours?.fg, 0.9)}`,
        "--search-result-background": `#${getDarkerColor(colours?.fg, 0.8)}`,
        "--search-result-hover": `#${getDarkerColor(colours?.fg, 0.7)}`,
        "--search-foreground": (colours?.fgText as {color: string})?.color,
    } as React.CSSProperties : undefined;

    return <div
        className="playerSearchTheme"
        data-custom={hasColours || undefined}
        style={themeStyle}
        onPointerEnter={requestPlayerNames}
        onTouchStart={requestPlayerNames}
    >
        <SearchAutocomplete
                items={items}
                fuseOptions={{
                    keys: ["nick", "twitches"],
                    threshold: 0.2,
                    minMatchCharLength: 2,
                    includeMatches: true,
                    includeScore: true
                }}
                inputDebounce={100}
                onSearch={handleOnSearch}
                onFocus={requestPlayerNames}
                onSelect={handleOnSelect}
                onHover={handleOnHover}
                formatResult={formatResult}
                inputSearchString={input}
                className={"searchBox"}
                resultStringKeyName={"nick"}
                showNoResults={false}
                placeholder={"Username"}
                maxResults={5}
            />
        </div>
}
