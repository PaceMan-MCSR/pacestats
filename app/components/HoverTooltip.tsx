'use client'

// Small stand-ins for react-bootstrap's OverlayTrigger, Tooltip and Collapse.
// The originals brought Popper and @restart/ui (about 45 KB) to every page
// with a tooltip. These render Bootstrap's own tooltip markup, so the
// existing tooltip classes in main.css keep working.

import {cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import type {ReactElement, ReactNode} from "react";
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
    overlay: ReactElement<TooltipProps>,
    delay?: number | {show: number, hide: number},
    children: ReactElement<any>,
}) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<Position | null>(null);
    // The trigger element, kept in state so cloneElement can take the setter as its ref.
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
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
            if (!anchor || !bubble) return;
            const rect = anchor.getBoundingClientRect();
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
        place();
        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);
        return () => {
            window.removeEventListener("scroll", place, true);
            window.removeEventListener("resize", place);
            setPosition(null);
        };
    }, [open, anchor]);

    // Listen on the element itself, which leaves the child's own handlers alone.
    useEffect(() => {
        if (!anchor) return;
        const show = () => schedule(true, showDelay);
        const hide = () => schedule(false, hideDelay);
        anchor.addEventListener("mouseenter", show);
        anchor.addEventListener("mouseleave", hide);
        anchor.addEventListener("focusin", show);
        anchor.addEventListener("focusout", hide);
        return () => {
            anchor.removeEventListener("mouseenter", show);
            anchor.removeEventListener("mouseleave", hide);
            anchor.removeEventListener("focusin", show);
            anchor.removeEventListener("focusout", hide);
        };
    }, [anchor, schedule, showDelay, hideDelay]);

    const trigger = cloneElement(children, {ref: setAnchor});

    // Whole class names, so scripts/trim-bootstrap.mjs finds them in this file.
    const sideClass = position?.below ? "bs-tooltip-bottom" : "bs-tooltip-top";
    return <>
        {trigger}
        {open && createPortal(
            <div
                ref={tip}
                role="tooltip"
                className={`tooltip ${sideClass} show ${overlay.props.className ?? ""}`}
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
                <div className="tooltip-inner">{overlay.props.children}</div>
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
