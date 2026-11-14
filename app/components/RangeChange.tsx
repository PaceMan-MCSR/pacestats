'use client';

import {useSearchParams, useRouter, usePathname} from "next/navigation";
import {useContext, useEffect, useOptimistic, useRef, useTransition} from "react";
import {UserColoursContext} from "@/app/contexts";
import {colourVars, customClass} from "@/app/components/customColours";
import {PrefetchKind} from "next/dist/client/components/router-reducer/router-reducer-types";

const RANGES = [
    {days: 1, label: "24 hours"},
    {days: 7, label: "7 days"},
    {days: 30, label: "30 days"},
    {days: 9999, label: "Lifetime"},
];

export default function RangeChange() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const requestedDays = Number(searchParams.get('days') || '30');
    const days = RANGES.some((range) => range.days === requestedDays) ? requestedDays : 30;
    const [selectedDays, setSelectedDays] = useOptimistic(days);
    const colours = useContext(UserColoursContext);
    const prefetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const prefetched = useRef(new Map<string, number>());

    const cancelPrefetch = () => clearTimeout(prefetchTimer.current);
    useEffect(() => () => clearTimeout(prefetchTimer.current), []);

    const rangeUrl = (newDays: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("days", String(newDays));
        return `${pathname}?${params}`;
    };

    const handleDaysChange = (newDays: number) => {
        if (isPending || days === newDays) return;
        cancelPrefetch();
        startTransition(() => {
            setSelectedDays(newDays);
            router.push(rangeUrl(newDays), {scroll: false});
        });
    };

    const prefetchDays = (newDays: number, immediate = false) => {
        cancelPrefetch();
        if (isPending || days === newDays) return;
        const href = rangeUrl(newDays);
        const prefetch = () => {
            if (Date.now() - (prefetched.current.get(href) ?? 0) < 30_000) return;
            // Keep speculative work bounded across category changes, too.
            if (prefetched.current.size >= 4) prefetched.current.clear();
            prefetched.current.set(href, Date.now());
            router.prefetch(href, {
                kind: PrefetchKind.FULL,
                onInvalidate: () => { prefetched.current.delete(href); },
            });
        };
        if (immediate) prefetch();
        else prefetchTimer.current = setTimeout(prefetch, 100);
    };

    return <div
        className={customClass(colours, "ccRange", "rangeButtons")}
        aria-busy={isPending}
        style={{opacity: isPending ? 0.7 : 1, transition: 'opacity 0.2s ease-in-out', ...colourVars(colours)}}
    >
        {RANGES.map((range) => <button
            type="button"
            key={range.days}
            className={"btn " + (selectedDays === range.days ? "btn-primary" : "btn-dark")}
            aria-pressed={selectedDays === range.days}
            onMouseEnter={() => prefetchDays(range.days)}
            onMouseLeave={cancelPrefetch}
            onFocus={() => prefetchDays(range.days, true)}
            onBlur={cancelPrefetch}
            onMouseDown={(event) => {
                if (event.button === 0) handleDaysChange(range.days);
            }}
            onClick={(event) => {
                // Mouse activation begins on mouse-down; keyboard activation
                // has no mouse-down and must navigate from the click.
                if (event.detail === 0) handleDaysChange(range.days);
            }}
            disabled={isPending}
        >{range.label}</button>)}
    </div>;
}
