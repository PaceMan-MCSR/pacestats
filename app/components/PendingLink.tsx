'use client'

import Link, {useLinkStatus} from "next/link";
import type {ComponentProps, ReactNode} from "react";

function PendingLinkContent({children}: {children: ReactNode}) {
    const {pending} = useLinkStatus();
    return <span style={{opacity: pending ? 0.7 : 1}}>{children}</span>;
}

export default function PendingLink({children, ...props}: ComponentProps<typeof Link>) {
    return <Link {...props}>
        <PendingLinkContent>{children}</PendingLinkContent>
    </Link>;
}
