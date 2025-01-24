'use client';

import { ReactSearchAutocomplete } from 'react-search-autocomplete'
import { useRouter } from 'next/navigation'
import {SearchName} from "@/app/types";
import Link from "next/link";

export default function PlayerSearch({data, input, setOutput}: { data: SearchName[], input?: any, setOutput?: any }) {
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
                <img className="avatarSmall" src={url} alt={item.nick}/>
                {item.nick}
            </span>
        )
    }

    return <ReactSearchAutocomplete
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
}