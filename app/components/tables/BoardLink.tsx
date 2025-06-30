'use client'

import Link from "next/link";
import {useRouter} from "next/navigation";
import { useContext, useState } from "react";
import { UsersContext } from "@/app/contexts";
import { getNameColor } from "@/app/utils";

export default function BoardLink({name, uuid, url, linkUrl}: {name: string, uuid: string, url: string, linkUrl: string}) {
    const [pending, setPending] = useState(false);
    const router = useRouter()
    const users = useContext(UsersContext);
    return <Link
        className="boardLink"
        href={linkUrl}
        onMouseEnter={() => router.prefetch(`/player/${name}`)}
        onMouseDown={() => {
            router.push(`/player/${name}`);
            setPending(true);
        }}>
        <p className="playerName" style={{opacity: pending ? 0.7 : 1.0, color: getNameColor(users, uuid)}}>
            <img className="avatar" src={url} alt={name}/>
            {name}
        </p>
    </Link>
}