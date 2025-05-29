'use client';

import { ReactSearchAutocomplete } from 'react-search-autocomplete'
import { useRouter } from 'next/navigation'
import {SearchName} from "@/app/types";
import Link from "next/link";
import { defaultNameColor, getDarkerColor, getNameColor } from "@/app/utils";
import { useContext } from "react";
import { UserColoursContext } from "@/app/contexts";
import Box from "@mui/material/Box";

export default function PlayerSearch({data, input, setOutput, userInfo}: { data: SearchName[], input?: any, setOutput?: any, userInfo: any }) {
    const colours = useContext(UserColoursContext);
    const hasColours = colours?.isCustom
    const router = useRouter()

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
        const url = `https://mc-heads.net/avatar/${item.nick}/8`
        return (
            <span style={{ display: 'block', textAlign: 'left' }}>
                {setOutput === undefined && (<Link href={`/player/${item.nick}`}></Link>)}
                <img className="avatarSmall" src={url} alt={item.nick} style={{
                    marginTop: '-2px',
                }}/>
                <span style={{
                    color: getNameColor(userInfo, item.id),
                    filter: getNameColor(userInfo, item.id) !== defaultNameColor ? `drop-shadow(0px 0px 1px #000000) drop-shadow(0px 0px 1px #000000)` : '',
                    fontSize: '1.15em',
                }}>{item.nick}</span>
            </span>
        )
    }

    return <Box sx={hasColours ? {
        '& .searchBox .wrapper': {
            backgroundColor: `#${getDarkerColor(colours?.fg, 0.9)} !important`,
        },
        '& .searchBox .wrapper input': {
            backgroundColor: `#${getDarkerColor(colours?.fg, 0.9)} !important`,
        },
        '& .searchBox .wrapper div input::placeholder': {
            color: `${(colours?.fgText as {color: string})?.color} !important`
        },
        '& .searchBox .wrapper div input': {
            color: `${(colours?.fgText as {color: string})?.color} !important`
        },
        '& .searchBox .wrapper div svg path': {
            fill: `${(colours?.fgText as {color: string})?.color} !important`
        },
        '& .searchBox .wrapper div ul li': {
            backgroundColor: `#${getDarkerColor(colours?.fg, 0.8)} !important`,
        },
        '& .searchBox .wrapper div ul li:hover': {
            backgroundColor: `#${getDarkerColor(colours?.fg, 0.7)} !important`,
        }
    } : {}}>
        <ReactSearchAutocomplete
                items={data}
                fuseOptions={{
                    keys: ["nick", "twitches"],
                    threshold: 0.2,
                    minMatchCharLength: 2,
                    includeMatches: true,
                    includeScore: true
                }}
                inputDebounce={100}
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
        </Box>
}