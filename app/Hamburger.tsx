'use client'

import { useContext, useEffect, useId, useRef, useState } from "react";
import PlayerSearch from "@/app/components/PlayerSearch";
import { usePathname } from "next/navigation";
import { UserColoursContext } from "@/app/contexts";
import PendingLink from "@/app/components/PendingLink";

export default function Hamburger() {
    const [open, setOpen] = useState(false);
    const path = usePathname();
    const colours = useContext(UserColoursContext)
    const drawerId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const timer = setTimeout(() => setOpen(false), 0);
        return () => clearTimeout(timer);
    }, [path]);

    useEffect(() => {
        if (!open) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    return (
        <div>
            <button
                ref={triggerRef}
                className="hamburgerButton"
                type="button"
                aria-label="Open navigation"
                aria-controls={drawerId}
                aria-expanded={open}
                onClick={() => setOpen(true)}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z"/>
                </svg>
            </button>
            {open && <div className="mobileDrawerRoot">
                <button
                    className="mobileDrawerBackdrop"
                    type="button"
                    aria-label="Close navigation"
                    onClick={() => setOpen(false)}
                />
                <nav
                    id={drawerId}
                    className="mobileDrawer"
                    aria-label="Mobile navigation"
                    style={{
                        backgroundColor: colours?.isCustom ? `#${colours.bg}` : "#121215",
                        color: colours?.isCustom
                            ? (colours.bgText as {color: string}).color
                            : "#DDDDEE",
                    }}
                >
                    <PendingLink href="/">Leaderboards</PendingLink>
                    <PendingLink href="/obs/">OBS Overlays</PendingLink>
                    <PendingLink href="/aa/">AA Leaderboards</PendingLink>
                    <div className="searchWrapper">
                        <PlayerSearch/>
                    </div>
                </nav>
            </div>}
        </div>
    )
}
