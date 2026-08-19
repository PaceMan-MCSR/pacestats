'use client';

import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import moment from "moment";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

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
        function tick() {
            savedCallback.current();
        }
        if (delay !== null) {
            const id = setInterval(tick, delay);
            return () => clearInterval(id);
        }
    }, [delay]);
}

function RelativeTimer({start, small = false}: { start: number, small?: boolean }) {
    const getDiff = useCallback(() => {
        const diffSeconds = Math.round((Date.now() / 1000) - start);
        if(diffSeconds < 60){
            if(small){
                return diffSeconds.toFixed(0) + "s"
            }
            const maybePlural = diffSeconds === 1 ? "" : "s";
            return diffSeconds.toFixed(0) + " second" + maybePlural + " ago"
        } else {
            if(small){
                return moment.unix(start).fromNow()
                    .replace("a minute ago", "1m")
                    .replace(" minutes ago", "m")
                    .replace("an hour ago", "1h")
                    .replace(" hours ago", "h")
                    .replace("a day ago", "1d")
                    .replace(" days ago", "d")
                    .replace("a month ago", "1mo")
                    .replace(" months ago", "mo")
            }
            return moment.unix(start).fromNow()
                .replace("minutes", "mins")
                .replace("seconds", "secs")
        }
    }, [small, start]);

    const [diff, setDiff] = useState(getDiff());
    const previousInput = useRef({start, small});

    const updateTimer = useCallback(() => {
        const nextDiff = getDiff();
        setDiff((currentDiff) => currentDiff === nextDiff ? currentDiff : nextDiff);
    }, [getDiff]);

    useEffect(() => {
        if (previousInput.current.start !== start || previousInput.current.small !== small) {
            previousInput.current = {start, small};
            updateTimer();
        }
    }, [small, start, updateTimer]);

    const ageSeconds = ageInSeconds(start);
    const refreshDelay = /\byears?\b/.test(diff) ? null : refreshDelayForAge(ageSeconds);

    useInterval(updateTimer, refreshDelay);

    const exactTime = useMemo(
        () => moment.unix(start).format("MMMM Do YYYY, h:mm:ss a"),
        [start]
    );
    const tooltip = useMemo(() => (
        <Tooltip className="timeTooltip">
            <p>{exactTime}</p>
        </Tooltip>
    ), [exactTime]);

    return <OverlayTrigger overlay={tooltip} delay={{ show: 0, hide: 50 }}>
        <span>{diff}</span>
    </OverlayTrigger>
}

export default memo(RelativeTimer);
