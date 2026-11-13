'use client'

import Link from "next/link";
import { useContext } from "react";
import { UsersContext } from "@/app/contexts";
import { getNameColor } from "@/app/utils";
import { useIntentLink } from "@/app/components/useIntentLink";

export default function BoardLink({name, displayName, uuid, linkUrl, color, lowPriority = false}: {
    name: string,
    displayName?: string,
    uuid: string,
    linkUrl: string,
    color?: string,
    lowPriority?: boolean,
}) {
    const users = useContext(UsersContext);
    const {linkProps, pending} = useIntentLink(linkUrl);

    return <Link className="boardLink" {...linkProps}>
        <p className="playerName" style={{opacity: pending ? 0.7 : 1.0, color: color ?? getNameColor(users, uuid)}}>
            <img
                className="avatar"
                src={`https://mc-api.io/render/FACE/${uuid}?size=8`}
                alt={name}
                loading="lazy"
                decoding="async"
                fetchPriority={lowPriority ? "low" : undefined}
                width={24}
                height={24}
            />
            {displayName ?? name}
        </p>
    </Link>
}
