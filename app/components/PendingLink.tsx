'use client'

import Link, {useLinkStatus} from "next/link";
import {useState} from "react";
import type {ComponentProps, ReactNode} from "react";

function PendingLinkContent({children}: {children: ReactNode}) {
    const {pending} = useLinkStatus();
    return <span style={{opacity: pending ? 0.7 : 1}}>{children}</span>;
}

export default function PendingLink({children, prefetch, onPointerEnter, onTouchStart, onFocus, ...props}: ComponentProps<typeof Link>) {
    // Hover, focus or touch loads the whole target page, so the click that
    // follows needs no request. Until then nothing is fetched: the default
    // viewport prefetch cost five requests on every page load for the header.
    const [intent, setIntent] = useState(false);
    return <Link
        {...props}
        prefetch={intent ? true : prefetch ?? false}
        onPointerEnter={(event) => {
            setIntent(true);
            onPointerEnter?.(event);
        }}
        onTouchStart={(event) => {
            setIntent(true);
            onTouchStart?.(event);
        }}
        onFocus={(event) => {
            setIntent(true);
            onFocus?.(event);
        }}
    >
        <PendingLinkContent>{children}</PendingLinkContent>
    </Link>;
}
