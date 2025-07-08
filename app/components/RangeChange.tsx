'use client';

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useContext, useEffect, useState, useTransition } from "react";
import { UserColoursContext } from "@/app/contexts";
import Box from "@mui/material/Box";
import { getDarkerColor } from "@/app/utils";

export default function RangeChange() {
    // Hooks for navigation and state
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [isLoading, setIsLoading] = useState(true);

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

    useEffect(() => {
        setIsLoading(false);
        router.prefetch(`${pathname}?days=1`);
        router.prefetch(`${pathname}?days=7`);
        router.prefetch(`${pathname}?days=30`);
        router.prefetch(`${pathname}?days=9999`);
        router.prefetch("/")
    }, []);

    return (
        <Box
            className="rangeButtons"
            sx={{
                // Add a style to indicate the loading state
                opacity: isPending ? 0.7 : 1,
                transition: 'opacity 0.2s ease-in-out',
                ...(colours?.isCustom ? {
                    '& button': {
                        backgroundColor: `#${colours.fg}`,
                        ...colours.fgText
                    },
                    '& button.btn-primary': {
                        backgroundColor: `#${getDarkerColor(colours.fg, 0.8)}`,
                        borderColor: `#000000`,
                    },
                    '& button:hover:not(:disabled)': { // Prevent hover effect when disabled
                        backgroundColor: `#${getDarkerColor(colours.fg, 0.9)}`,
                        ...colours.bgText
                    },
                    '& button:disabled': {
                        cursor: 'not-allowed',
                    }
                } : {
                    '& button:disabled': {
                        cursor: 'not-allowed',
                    }
                })
            }}
        >
            <button
                className={"btn " + (days === 1 ? "btn-primary" : "btn-dark")}
                onMouseDown={(e) => {
                    if (e.button !== 0) return; // Only handle left mouse button
                    handleDaysChange(1)
                }}
                disabled={isLoading} // Disable button during navigation
            >
                24 hours
            </button>
            <button
                className={"btn " + (days === 7 ? "btn-primary" : "btn-dark")}
                onMouseDown={(e) => {
                    if (e.button !== 0) return; // Only handle left mouse button
                    handleDaysChange(7)
                }}
                disabled={isLoading}
            >
                7 days
            </button>
            <button
                className={"btn " + (days === 30 ? "btn-primary" : "btn-dark")}
                onMouseDown={(e) => {
                    if (e.button !== 0) return; // Only handle left mouse button
                    handleDaysChange(30)
                }}
                onClick={() => handleDaysChange(30)}
                disabled={isLoading}
            >
                30 days
            </button>
            <button
                className={"btn " + (days === 9999 ? "btn-primary" : "btn-dark")}
                onMouseDown={(e) => {
                    if (e.button !== 0) return; // Only handle left mouse button
                    handleDaysChange(9999)
                }}
                disabled={isLoading}
            >
                Lifetime
            </button>
        </Box>
    );
}