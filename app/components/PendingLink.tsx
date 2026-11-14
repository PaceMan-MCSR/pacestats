'use client'

import Link, {useLinkStatus} from "next/link";
import type {ComponentProps, ReactNode} from "react";
import {usePrefetchIntent} from "@/app/components/useIntentLink";

function PendingLinkContent({children}: {children: ReactNode}) {
    const {pending} = useLinkStatus();
    return <span style={{opacity: pending ? 0.7 : 1}}>{children}</span>;
}

export default function PendingLink({children, prefetch, onPointerEnter, onPointerLeave, onTouchStart, onFocus, ...props}: ComponentProps<typeof Link>) {
    // Hover, focus or touch loads the whole target page, so the click that
    // follows needs no request. Until then nothing is fetched: the default
    // viewport prefetch cost five requests on every page load for the header.
    const {intent, intentProps} = usePrefetchIntent();
    return <Link
        {...props}
        prefetch={intent ? true : prefetch ?? false}
        onPointerEnter={(event) => {
            intentProps.onPointerEnter(event);
            onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
            intentProps.onPointerLeave(event);
            onPointerLeave?.(event);
        }}
        onTouchStart={(event) => {
            intentProps.onTouchStart(event);
            onTouchStart?.(event);
        }}
        onFocus={(event) => {
            intentProps.onFocus(event);
            onFocus?.(event);
        }}
    >
        <PendingLinkContent>{children}</PendingLinkContent>
    </Link>;
}
