'use client';

import {memo, useCallback, useEffect, useRef, useState} from 'react';
import {formatExactTime, fromNow} from "@/app/components/profile/relativeTime";
import { OverlayTrigger, Tooltip } from "@/app/components/HoverTooltip";
import {subscribeRelativeClock} from "@/app/components/profile/relativeTimeClock";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const refreshDelayForAge = (ageSeconds: number): number | null => {
    if (ageSeconds < 60) return SECOND;
    if (ageSeconds < 60 * 60) return 30 * SECOND;
    if (ageSeconds < 24 * 60 * 60) return 5 * MINUTE;
    if (ageSeconds < 7 * 24 * 60 * 60) return 30 * MINUTE;
    if (ageSeconds < 30 * 24 * 60 * 60) return 6 * HOUR;
    if (ageSeconds < 365 * 24 * 60 * 60) return DAY;
    return null;
};

const ageInSeconds = (start: number) => Math.max(0, (Date.now() / 1000) - start);

function useInterval(callback: () => void, delay: number | null) {
    const savedCallback = useRef(callback);

    // Remember the latest callback.
    useEffect(() => {
        savedCallback.current = callback;
    }, [callback]);

    // Set up the interval.
    useEffect(() => {
        if (delay !== null) {
            return subscribeRelativeClock(() => savedCallback.current(), delay);
        }
    }, [delay]);
}

const compactText = (text: string) => text
    .replace(/^(\d+) seconds? ago$/, "$1s")
    .replace("a minute ago", "1m")
    .replace(" mins ago", "m")
    .replace("an hour ago", "1h")
    .replace(" hours ago", "h")
    .replace("a day ago", "1d")
    .replace(" days ago", "d")
    .replace("a month ago", "1mo")
    .replace(" months ago", "mo");

function RelativeTimer({start, small = false, compactBelow}: {
    start: number,
    small?: boolean,
    compactBelow?: 'sm' | 'md',
}) {
    const getDiff = useCallback(() => {
        const diffSeconds = Math.max(0, Math.round((Date.now() / 1000) - start));
        if(diffSeconds < 60){
            const maybePlural = diffSeconds === 1 ? "" : "s";
            return diffSeconds.toFixed(0) + " second" + maybePlural + " ago"
        } else {
            return fromNow(start)
                .replace("minutes", "mins")
                .replace("seconds", "secs")
        }
    }, [start]);

    const [diff, setDiff] = useState(getDiff);
    const previousInput = useRef(start);

    const updateTimer = useCallback(() => {
        const nextDiff = getDiff();
        setDiff((currentDiff) => currentDiff === nextDiff ? currentDiff : nextDiff);
    }, [getDiff]);

    useEffect(() => {
        if (previousInput.current !== start) {
            previousInput.current = start;
            updateTimer();
        }
    }, [start, updateTimer]);

    const ageSeconds = ageInSeconds(start);
    const refreshDelay = /\byears?\b/.test(diff) ? null : refreshDelayForAge(ageSeconds);

    useInterval(updateTimer, refreshDelay);

    const tooltip = () => (
        <Tooltip className="timeTooltip">
            <p>{formatExactTime(start)}</p>
        </Tooltip>
    );

    return <OverlayTrigger overlay={tooltip} delay={{ show: 0, hide: 50 }}>
        <span>
            {compactBelow ? <>
                <span className={compactBelow === 'sm' ? 'd-sm-none' : 'd-md-none'} suppressHydrationWarning>{compactText(diff)}</span>
                <span className={compactBelow === 'sm' ? 'd-none d-sm-inline' : 'd-none d-md-inline'} suppressHydrationWarning>{diff}</span>
            </> : <span suppressHydrationWarning>{small ? compactText(diff) : diff}</span>}
        </span>
    </OverlayTrigger>
}

export default memo(RelativeTimer);
