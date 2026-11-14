'use client';

import {useEffect, useRef} from 'react';

/** Measure OBS previews when their contents resize, without polling layout. */
export function useOverlaySize(setWidth?: (width: number) => void, setHeight?: (height: number) => void) {
    const ref = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element || !setWidth || !setHeight) return;
        let frame = 0;
        let previousWidth = -1;
        let previousHeight = -1;
        const measure = () => {
            frame = 0;
            const width = element.clientWidth - 20;
            const height = element.clientHeight;
            if (width !== previousWidth) setWidth(width);
            if (height !== previousHeight) setHeight(height);
            previousWidth = width;
            previousHeight = height;
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(element);
        schedule();
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [setWidth, setHeight]);
    return ref;
}
