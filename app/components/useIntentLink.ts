'use client'

import {useRouter} from "next/navigation";
import {useRef, useState} from "react";
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
    const [intent, setIntent] = useState(false);
    const [pending, setPending] = useState(false);
    // Set on mouse-down so the click that follows does not navigate again.
    const pushedOnMouseDown = useRef(false);

    const showIntent = () => setIntent(true);

    const linkProps = {
        href,
        prefetch: intent,
        onPointerEnter: (_event: PointerEvent<HTMLAnchorElement>) => showIntent(),
        onTouchStart: (_event: TouchEvent<HTMLAnchorElement>) => showIntent(),
        onFocus: (_event: FocusEvent<HTMLAnchorElement>) => showIntent(),
        onMouseDown: (event: MouseEvent<HTMLAnchorElement>) => {
            pushedOnMouseDown.current = false;
            // Leave middle clicks and modified clicks (new tab, new window,
            // download) to the browser.
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            pushedOnMouseDown.current = true;
            setPending(true);
            router.push(href);
        },
        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
            if (!pushedOnMouseDown.current) return;
            pushedOnMouseDown.current = false;
            event.preventDefault();
        },
    };

    return {linkProps, pending};
}
