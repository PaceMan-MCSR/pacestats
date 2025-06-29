'use client'

import Link from "next/link";
import {useRouter} from "next/navigation";
import { useContext } from "react";
import { UsersContext } from "@/app/contexts";
import { getNameColor } from "@/app/utils";

export default function BoardLink({name, uuid, url, linkUrl}: {name: string, uuid: string, url: string, linkUrl: string}) {
    const router = useRouter()
    const users = useContext(UsersContext);
    return <Link className="boardLink" href={linkUrl} onMouseEnter={() => router.prefetch(`/player/${name}`)}>
        <p className="playerName" style={{color: getNameColor(users, uuid)}}>
            <img className="avatar" src={url} alt={name}/>
            {name}
        </p>
    </Link>
}