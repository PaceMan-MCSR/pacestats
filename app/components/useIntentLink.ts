'use client'

import {useRouter} from "next/navigation";
import {useEffect, useRef, useState, useTransition} from "react";
import type {FocusEvent, MouseEvent, PointerEvent, TouchEvent} from "react";

/**
 * Props for a `next/link` that loads the whole target page as soon as the
 * visitor shows intent (hover, focus or touch) and navigates on mouse-down
 * instead of waiting for the click.
 *
 * `prefetch` stays `false` until the first sign of intent, so a table of
 * links costs no requests. After that it is `true`, which makes Next fetch
 * the full page (the default only fetches the loading skeleton of a dynamic
 * route). The click then needs no request.
 */
export function useIntentLink(href: string) {
    const router = useRouter();
    const {intent, intentProps} = usePrefetchIntent();
    const [pending, startTransition] = useTransition();
    // Set on mouse-down so the click that follows does not navigate again.
    const pushedOnMouseDown = useRef(false);

    const linkProps = {
        href,
        prefetch: intent,
        ...intentProps,
        onMouseDown: (event: MouseEvent<HTMLAnchorElement>) => {
            pushedOnMouseDown.current = false;
            // Leave middle clicks and modified clicks (new tab, new window,
            // download) to the browser.
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            pushedOnMouseDown.current = true;
            startTransition(() => router.push(href));
        },
        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
            if (!pushedOnMouseDown.current) return;
            pushedOnMouseDown.current = false;
            event.preventDefault();
        },
    };

    return {linkProps, pending};
}

// Crossing a leaderboard with the pointer should not start dozens of cold
// page renders. A short dwell still starts the fetch before a deliberate
// click; focus and touch express intent immediately.
export function usePrefetchIntent() {
    const [intent, setIntent] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const cancel = () => {
        clearTimeout(timer.current);
        timer.current = undefined;
    };
    const activate = () => {
        cancel();
        setIntent(true);
    };
    useEffect(() => () => clearTimeout(timer.current), []);

    return {
        intent,
        intentProps: {
            onPointerEnter: (_event: PointerEvent<HTMLAnchorElement>) => {
                if (!intent && timer.current === undefined) timer.current = setTimeout(activate, 100);
            },
            onPointerLeave: (_event: PointerEvent<HTMLAnchorElement>) => cancel(),
            onTouchStart: (_event: TouchEvent<HTMLAnchorElement>) => activate(),
            onFocus: (_event: FocusEvent<HTMLAnchorElement>) => activate(),
        },
    };
}
