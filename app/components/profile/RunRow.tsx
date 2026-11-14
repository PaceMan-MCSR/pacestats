'use client';

import {useRouter} from 'next/navigation';
import {useEffect, useRef, useTransition} from 'react';
import type {ReactNode} from 'react';
import {PrefetchKind} from 'next/dist/client/components/router-reducer/router-reducer-types';

export default function RunRow({href, children}: {href: string, children: ReactNode}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const prefetchedAt = useRef(0);
    const cancel = () => clearTimeout(timer.current);
    const prefetch = () => {
        cancel();
        if (Date.now() - prefetchedAt.current < 30_000) return;
        prefetchedAt.current = Date.now();
        router.prefetch(href, {kind: PrefetchKind.FULL});
    };
    const navigate = () => {
        cancel();
        startTransition(() => router.push(href));
    };
    useEffect(() => () => clearTimeout(timer.current), []);

    return <tr
        role="link"
        tabIndex={0}
        aria-label="View run info"
        aria-busy={pending}
        style={{opacity: pending ? 0.7 : 1}}
        onPointerEnter={() => { timer.current = setTimeout(prefetch, 100); }}
        onPointerLeave={cancel}
        onFocus={prefetch}
        onClick={(event) => {
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) navigate();
        }}
        onKeyDown={(event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                navigate();
            }
        }}
    >{children}</tr>;
}
