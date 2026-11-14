'use client';

import {useEffect, useState} from "react";

/** A cancellable grace period keeps speculative work out of initial navigation. */
export function scheduleDeferredPrefetch(activate: () => void, delay = 750) {
    const timer = setTimeout(activate, delay);
    return () => clearTimeout(timer);
}

/** Enable one bounded destination after the page has had time to settle. */
export function useDeferredPrefetch(href: string, delay = 750) {
    const [readyHref, setReadyHref] = useState<string | null>(null);
    useEffect(() => scheduleDeferredPrefetch(() => setReadyHref(href), delay), [href, delay]);
    return readyHref === href;
}
