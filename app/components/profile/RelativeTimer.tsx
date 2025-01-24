'use client';

import {useEffect, useRef, useState} from 'react';
import moment from "moment";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

function useInterval(callback: () => any, delay: number) {
    const savedCallback = useRef();

    // Remember the latest callback.
    useEffect(() => {
        // @ts-ignore
        savedCallback.current = callback;
    }, [callback]);

    // Set up the interval.
    useEffect(() => {
        function tick() {
            // @ts-ignore
            savedCallback.current();
        }
        if (delay !== null) {
            let id = setInterval(tick, delay);
            return () => clearInterval(id);
        }
    }, [delay]);
}

export default function RelativeTimer({start, small = false}: { start: number, small?: boolean }) {
    const getDiff = () => {
        const diffSeconds = Math.round((Date.now() / 1000) - start);
        if(diffSeconds < 60){
            if(small){
                return diffSeconds.toFixed(0) + "s"
                return;
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
    }

    const [diff, setDiff] = useState(getDiff());

    const updateTimer = () => {
        setDiff(getDiff())
    }

    useInterval(() => {
        updateTimer()
    }, 1000)

    useEffect(() => {
        updateTimer()
    }, [])

    return <OverlayTrigger overlay={
        <Tooltip className="timeTooltip">
            <p>{moment.unix(start).format("MMMM Do YYYY, h:mm:ss a")}</p>
        </Tooltip>
    } delay={{ show: 0, hide: 50 }}>
        <span>{diff}</span>
    </OverlayTrigger>
}