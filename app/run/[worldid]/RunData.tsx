'use client';

import useSWR from 'swr';
import {useEffect, useRef} from "react";
import {useRunStoreApi} from "@/app/run/[worldid]/RunStore";
import type {WorldSnapshot} from "@/app/run/[worldid]/RunStore";
import {getLastSplit} from "@/app/utils";
import {sameRunSnapshot} from './snapshot';

const fetcher = async (url: string): Promise<WorldSnapshot> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to refresh run (${response.status})`);
    return response.json();
};

export default function RunData({params, initialWorld}: {
    params: {worldid: string},
    initialWorld: WorldSnapshot,
}) {
    const store = useRunStoreApi();
    const deathTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // Historical runs are complete snapshots. They need neither a second
    // getWorld request after hydration nor the entire external live-run list.
    // Live/unknown snapshots refresh only this run through the compact API.
    const shouldRefresh = Boolean(initialWorld?.isLive || initialWorld?.liveStatusUnknown);
    const {data} = useSWR<WorldSnapshot>(
        shouldRefresh ? `/stats/api/getWorld/?worldId=${encodeURIComponent(params.worldid)}` : null,
        fetcher,
        {
            fallbackData: initialWorld,
            compare: sameRunSnapshot,
            revalidateOnMount: false,
            // SWR passes its cache value (undefined before the first fetch),
            // rather than fallbackData, when choosing the first interval.
            refreshInterval: (snapshot) => {
                const latest = snapshot === undefined ? initialWorld : snapshot;
                return latest?.isLive || latest?.liveStatusUnknown ? 3_000 : 0;
            },
            revalidateOnFocus: shouldRefresh,
            revalidateOnReconnect: shouldRefresh,
        }
    );

    useEffect(() => {
        if (data === undefined) return;
        if (data === null) {
            store.setState({data: null, isLive: false, dying: false, isLoading: false});
            return;
        }
        const canonicalPath = `/stats/run/${data.data.id}/`;
        if (window.location.href !== new URL(canonicalPath, window.location.origin).href) {
            window.history.replaceState(null, "", canonicalPath);
        }
        if (data.liveStatusUnknown) return; // Keep the last confirmed live state during an upstream outage.
        clearTimeout(deathTimer.current);
        const wasLive = store.getState().isLive;
        if (wasLive && !data.isLive) {
            store.setState({dying: true});
            deathTimer.current = setTimeout(() => {
                store.setState({data: data.data, isLive: false, dying: false, isLoading: false});
            }, 5_000);
        } else {
            store.setState({data: data.data, isLive: Boolean(data.isLive), dying: false, isLoading: false});
        }
        if (data.isLive) {
            const title = `${getLastSplit(data.data, false).full} by ${data.data.nickname}`;
            if (document.title !== title) document.title = title;
        }
        return () => clearTimeout(deathTimer.current);
    }, [data, store]);

    return null;
}
