'use client'

import Link from "next/link";
import {useRouter} from "next/navigation";
import { useContext, useEffect, useRef, useState } from "react";
import { UsersContext } from "@/app/contexts";
import { getNameColor } from "@/app/utils";
import { schedulePlayerPrefetch } from "@/app/components/playerPrefetch";

export default function BoardLink({name, displayName, uuid, linkUrl, color, lowPriority = false}: {
    name: string,
    displayName?: string,
    uuid: string,
    linkUrl: string,
    color?: string,
    lowPriority?: boolean,
}) {
    const [pending, setPending] = useState(false);
    const router = useRouter()
    const users = useContext(UsersContext);
    const linkRef = useRef<HTMLAnchorElement>(null);

    useEffect(() => {
        const link = linkRef.current;
        if (!link) return;

        let releasePrefetch: (() => void) | undefined;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                releasePrefetch ??= schedulePlayerPrefetch(linkUrl, () => router.prefetch(linkUrl));
            } else {
                releasePrefetch?.();
                releasePrefetch = undefined;
            }
        });
        observer.observe(link);

        return () => {
            observer.disconnect();
            releasePrefetch?.();
        };
    }, [linkUrl, router]);

    return <Link
        ref={linkRef}
        className="boardLink"
        href={linkUrl}
        prefetch={false}
        onMouseDown={(e) => {
            if (e.button !== 0) return; // Only handle left mouse button
            router.push(linkUrl);
            setPending(true);
        }}>
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
