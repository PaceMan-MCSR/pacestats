'use client';

import { ReactSearchAutocomplete } from 'react-search-autocomplete'
import { useRouter } from 'next/navigation'
import {SearchName} from "@/app/types";
import Link from "next/link";
import { defaultNameColor, getDarkerColor, getNameColor } from "@/app/utils";
import { useContext, useRef, useState } from "react";
import { UserColoursContext, UsersContext } from "@/app/contexts";

type SearchItem = SearchName & { color?: string | null };

export default function PlayerSearch({data, input, setOutput, userInfo}: {
    data?: SearchName[], input?: any, setOutput?: any, userInfo?: any
}) {
    const colours = useContext(UserColoursContext);
    const contextUserInfo = useContext(UsersContext);
    const hasColours = colours?.isCustom
    const router = useRouter()
    const [remoteItems, setRemoteItems] = useState<SearchItem[]>([]);
    const searchController = useRef<AbortController | null>(null);
    const items = data ?? remoteItems;
    const colourUsers = userInfo ?? contextUserInfo;

    const handleOnSearch = (query: string) => {
        if (data !== undefined) return;
        searchController.current?.abort();
        if (query.trim().length < 2) {
            setRemoteItems([]);
            return;
        }

        const controller = new AbortController();
        searchController.current = controller;
        fetch(`/stats/api/searchPlayers/?q=${encodeURIComponent(query)}&limit=8`, {
            signal: controller.signal,
        })
            .then((response) => response.ok ? response.json() : [])
            .then((results) => setRemoteItems(results.map((result: any) => ({
                id: result.id,
                nick: result.name,
                twitches: [],
                color: result.color,
            }))))
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


    const handleOnHover = (item: any) => {
        if(setOutput === undefined) {
            router.prefetch(`/player/${item.nick}`)
        }
    }

    const formatResult = (item: any) => {
        const url = `https://mc-heads.net/avatar/${item.id}/8`
        const nameColor = item.color ? `#${item.color}` : getNameColor(colourUsers, item.id);
        return (
            <span style={{ display: 'block', textAlign: 'left' }}>
                {setOutput === undefined && (<Link href={`/player/${item.nick}`}></Link>)}
                <img className="avatarSmall" src={url} alt={item.nick} style={{
                    marginTop: '-2px',
                }}/>
                <span style={{
                    color: nameColor,
                    filter: nameColor !== defaultNameColor ? `drop-shadow(0px 0px 1px #000000) drop-shadow(0px 0px 1px #000000)` : '',
                    fontSize: '1.15em',
                }}>{item.nick}</span>
            </span>
        )
    }

    const themeStyle = hasColours ? {
        "--search-background": `#${getDarkerColor(colours?.fg, 0.9)}`,
        "--search-result-background": `#${getDarkerColor(colours?.fg, 0.8)}`,
        "--search-result-hover": `#${getDarkerColor(colours?.fg, 0.7)}`,
        "--search-foreground": (colours?.fgText as {color: string})?.color,
    } as React.CSSProperties : undefined;

    return <div className="playerSearchTheme" data-custom={hasColours || undefined} style={themeStyle}>
        <ReactSearchAutocomplete
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
