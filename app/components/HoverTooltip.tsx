'use client'

// Small stand-ins for react-bootstrap's OverlayTrigger, Tooltip and Collapse.
// The originals brought Popper and @restart/ui (about 45 KB) to every page
// with a tooltip. These render Bootstrap's own tooltip markup, so the
// existing tooltip classes in main.css keep working.

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import type {ReactElement, ReactNode, SyntheticEvent} from "react";
import {createPortal} from "react-dom";

type TooltipProps = {className?: string, children?: ReactNode};

/** Describes the tooltip; OverlayTrigger reads its props and renders it. */
export function Tooltip({children}: TooltipProps) {
    return <>{children}</>;
}

type Position = {left: number, top: number, arrowLeft: number, below: boolean};

const EDGE_GAP = 4;
// Room for Bootstrap's arrow, which hangs outside the tooltip box.
const ARROW_GAP = 6;

export function OverlayTrigger({overlay, delay, children}: {
    overlay: ReactElement<TooltipProps> | (() => ReactElement<TooltipProps>),
    delay?: number | {show: number, hide: number},
    children: ReactElement<any>,
}) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<Position | null>(null);
    // Capture the anchor only on interaction. A ref callback in state made
    // every closed tooltip render twice while its page was hydrating.
    const anchor = useRef<Element | null>(null);
    const tip = useRef<HTMLDivElement | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const showDelay = typeof delay === "number" ? delay : delay?.show ?? 0;
    const hideDelay = typeof delay === "number" ? delay : delay?.hide ?? 0;

    const schedule = useCallback((nextOpen: boolean, wait: number) => {
        clearTimeout(timer.current);
        if (wait <= 0) {
            setOpen(nextOpen);
            return;
        }
        timer.current = setTimeout(() => setOpen(nextOpen), wait);
    }, []);

    useEffect(() => () => clearTimeout(timer.current), []);

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const bubble = tip.current;
            if (!anchor.current || !bubble) return;
            const rect = anchor.current.getBoundingClientRect();
            const width = bubble.offsetWidth;
            const height = bubble.offsetHeight;
            const centre = rect.left + rect.width / 2;
            const left = Math.max(
                EDGE_GAP,
                Math.min(centre - width / 2, document.documentElement.clientWidth - width - EDGE_GAP)
            );
            const below = rect.top - height - ARROW_GAP < 0;
            setPosition({
                left,
                top: below ? rect.bottom + ARROW_GAP : rect.top - height - ARROW_GAP,
                arrowLeft: centre - left,
                below,
            });
        };
        let frame = 0;
        const schedulePlace = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => { frame = 0; place(); });
        };
        place();
        window.addEventListener("scroll", schedulePlace, true);
        window.addEventListener("resize", schedulePlace);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", schedulePlace, true);
            window.removeEventListener("resize", schedulePlace);
            setPosition(null);
        };
    }, [open]);

    const show = (event: SyntheticEvent<Element>) => {
        anchor.current = event.currentTarget;
        schedule(true, showDelay);
    };
    // React delegates these events at the page root, avoiding four native
    // listeners per timestamp/header. Keep the child's handlers and ref.
    const Trigger = children.type;
    const trigger = <Trigger {...children.props} key={children.key}
        onMouseEnter={(event: SyntheticEvent<Element>) => { children.props.onMouseEnter?.(event); show(event); }}
        onMouseLeave={(event: SyntheticEvent<Element>) => { children.props.onMouseLeave?.(event); schedule(false, hideDelay); }}
        onFocus={(event: SyntheticEvent<Element>) => { children.props.onFocus?.(event); show(event); }}
        onBlur={(event: SyntheticEvent<Element>) => { children.props.onBlur?.(event); schedule(false, hideDelay); }}
    />;

    // Whole class names, so scripts/trim-bootstrap.mjs finds them in this file.
    const sideClass = position?.below ? "bs-tooltip-bottom" : "bs-tooltip-top";
    // Expensive text (such as localized timestamps) is only needed while visible.
    const content = open ? (typeof overlay === 'function' ? overlay() : overlay) : null;
    return <>
        {trigger}
        {open && createPortal(
            <div
                ref={tip}
                role="tooltip"
                className={`tooltip ${sideClass} show ${content?.props.className ?? ""}`}
                style={{
                    position: "fixed",
                    left: position?.left ?? 0,
                    top: position?.top ?? 0,
                    // Measured while hidden on the first pass, then shown in place.
                    visibility: position ? "visible" : "hidden",
                    pointerEvents: "none",
                }}
            >
                <div
                    className="tooltip-arrow"
                    style={{position: "absolute", left: position?.arrowLeft ?? 0, transform: "translateX(-50%)"}}
                />
                <div className="tooltip-inner">{content?.props.children}</div>
            </div>,
            document.body
        )}
    </>;
}

/**
 * Animated show/hide for one block. The content mounts the first time it
 * opens, so code and images inside a closed panel cost nothing up front.
 */
export function Collapse({in: open, children}: {in: boolean, children: ReactNode}) {
    const [hasOpened, setHasOpened] = useState(open);
    if (open && !hasOpened) setHasOpened(true);

    return <div className={open ? "collapsePanel open" : "collapsePanel"} inert={!open}>
        <div className="collapsePanelInner">
            {hasOpened && children}
        </div>
    </div>;
}
