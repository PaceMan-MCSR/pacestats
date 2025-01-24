'use client'

import Link from "next/link";
import {useRouter} from "next/navigation";

export default function BoardLink({name, url, linkUrl}: {name: string, url: string, linkUrl: string}) {
    const router = useRouter()
    return <Link className="boardLink" href={linkUrl} onMouseEnter={() => router.prefetch(`/player/${name}`)}>
        <p className="playerName">
            <img className="avatar" src={url} alt={name}/>
            {name}
        </p>
    </Link>
}