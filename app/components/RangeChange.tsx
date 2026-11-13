'use client';

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useContext, useTransition } from "react";
import { UserColoursContext } from "@/app/contexts";
import { colourVars, customClass } from "@/app/components/customColours";

export default function RangeChange() {
    // Hooks for navigation and state
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    // Get current 'days' value from URL
    const days = parseInt(searchParams.get('days') || '30');

    // Get custom colours from context
    const colours = useContext(UserColoursContext);

    // This function now uses the router for client-side navigation
    const handleDaysChange = (newDays: number) => {
        if(isPending) return;
        if(days === newDays) return;
        // Create a new URLSearchParams object to avoid mutating the read-only one.
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.set("days", newDays.toString());

        // startTransition will set `isPending` to true immediately
        // and then update it to false when the navigation is complete.
        startTransition(() => {
            // router.push() performs a client-side navigation without a page reload.
            // It will update the URL and re-render only the components that need to change.
            router.push(`${pathname}?${newParams.toString()}`);
        });
    };

    const prefetchDays = (newDays: number) => {
        if (days === newDays) return;
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.set("days", newDays.toString());
        router.prefetch(`${pathname}?${newParams.toString()}`);
    };

    return (
        <div
            className={customClass(colours, "ccRange", "rangeButtons")}
            style={{
                // Dim the buttons while the new range loads.
                opacity: isPending ? 0.7 : 1,
                transition: 'opacity 0.2s ease-in-out',
                ...colourVars(colours),
            }}
        >
            <button
                className={"btn " + (days === 1 ? "btn-primary" : "btn-dark")}
                onMouseEnter={() => prefetchDays(1)}
                onFocus={() => prefetchDays(1)}
                onMouseDown={(e) => {
                    if (e.button !== 0) return; // Only handle left mouse button
                    handleDaysChange(1)
                }}
                disabled={isPending}
            >
                24 hours
            </button>
            <button
                className={"btn " + (days === 7 ? "btn-primary" : "btn-dark")}
                onMouseEnter={() => prefetchDays(7)}
                onFocus={() => prefetchDays(7)}
                onMouseDown={(e) => {
                    if (e.button !== 0) return; // Only handle left mouse button
                    handleDaysChange(7)
                }}
                disabled={isPending}
            >
                7 days
            </button>
            <button
                className={"btn " + (days === 30 ? "btn-primary" : "btn-dark")}
                onMouseEnter={() => prefetchDays(30)}
                onFocus={() => prefetchDays(30)}
                onMouseDown={(e) => {
                    if (e.button !== 0) return; // Only handle left mouse button
                    handleDaysChange(30)
                }}
                disabled={isPending}
            >
                30 days
            </button>
            <button
                className={"btn " + (days === 9999 ? "btn-primary" : "btn-dark")}
                onMouseEnter={() => prefetchDays(9999)}
                onFocus={() => prefetchDays(9999)}
                onMouseDown={(e) => {
                    if (e.button !== 0) return; // Only handle left mouse button
                    handleDaysChange(9999)
                }}
                disabled={isPending}
            >
                Lifetime
            </button>
        </div>
    );
}
