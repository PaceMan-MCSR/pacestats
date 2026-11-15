'use client';

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import useSWR from 'swr';
import useWebSocket from 'react-use-websocket';
import {overlaySocketUrl} from './sessionSubscription';

// A setup page can show multiple copies of one overlay. Its recovery requests
// share the same HTTP work as well as the live socket.
const inFlight = new Map<string, Promise<any>>();
class OverlayFetchError extends Error {
    constructor(public retryAfter: number) {super('Overlay data temporarily unavailable');}
}
const fetcher = (url: string): Promise<any> => {
    const existing = inFlight.get(url);
    if (existing) return existing;
    const request = fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(10_000)}).then(async response => {
        // Keep the last good snapshot during overload or an upstream outage.
        if (response.status === 429 || response.status >= 500) {
            const retry = Number(response.headers.get('retry-after'));
            throw new OverlayFetchError(Number.isFinite(retry) ? Math.min(60, Math.max(5, retry)) * 1000 : 5000);
        }
        return response.json();
    }).finally(() => {if (inFlight.get(url) === request) inFlight.delete(url);});
    inFlight.set(url, request);
    return request;
};

/** Live sockets own freshness; HTTP is an initial demo/compatibility/recovery path. */
export function useOverlayData(key: string, {demo, refreshInterval, initialData}: {demo: boolean; refreshInterval: number; initialData?: any}) {
    const socketUrl = demo ? null : overlaySocketUrl(process.env.NEXT_PUBLIC_WS_ENDPOINT, key);
    const [fallback, setFallback] = useState<string | null>(null);
    const polling = !socketUrl || fallback === key;
    const state = useRef({key, socketUrl, sequence: 0, lastDataAt: 0, hasData: false, polling});
    useLayoutEffect(() => {
        if (state.current.key !== key || state.current.socketUrl !== socketUrl) {
            state.current = {key, socketUrl, sequence: 0, lastDataAt: 0, hasData: false, polling};
        }
        state.current.polling = polling;
    }, [key, socketUrl, polling]);
    const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const recovery = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [jitter] = useState(() => Math.random() * 5000);
    const {data, mutate} = useSWR(key, fetcher, {
        fallbackData: initialData,
        // Starting a socket must not also start an API request. Recovery is
        // explicit so focus/reconnect events cannot fetch behind a live stream.
        revalidateOnMount: false,
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        refreshInterval: !demo && polling ? refreshInterval + jitter : 0,
        onErrorRetry(error, failedKey, _config, revalidate, options) {
            clearTimeout(retry.current);
            const delay = error instanceof OverlayFetchError ? error.retryAfter : 5000;
            retry.current = setTimeout(() => {
                if (state.current.key === failedKey && state.current.polling) revalidate(options);
            }, Math.min(60_000, delay * 2 ** Math.min(options.retryCount, 3)) + jitter);
        },
    });

    const startFallback = useCallback((immediate = false) => {
        if (state.current.key !== key || recovery.current !== undefined) return;
        // Once a value is visible, spread recovery across viewers instead of
        // having every socket trigger the public API in the same millisecond.
        const delay = immediate || !state.current.hasData ? 0 : 500 + jitter;
        recovery.current = setTimeout(() => {
            recovery.current = undefined;
            if (state.current.key === key) setFallback(key);
        }, delay);
    }, [key, jitter]);

    const armWatchdog = useCallback(() => {
        if (watchdog.current !== undefined) return;
        const check = () => {
            watchdog.current = undefined;
            if (state.current.key !== key || !socketUrl) return;
            const remaining = state.current.lastDataAt ? 90_000 - (Date.now() - state.current.lastDataAt) : 0;
            if (remaining > 0) watchdog.current = setTimeout(check, remaining);
            else startFallback();
        };
        watchdog.current = setTimeout(check, state.current.lastDataAt ? 90_000 : 10_000);
    }, [key, socketUrl, startFallback]);

    useWebSocket(socketUrl, {
        share: true,
        filter: () => false,
        shouldReconnect: event => event.code !== 1008 && event.code !== 1003,
        reconnectAttempts: Infinity,
        reconnectInterval: attempt => Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) + jitter,
        onOpen: () => {
            if (state.current.socketUrl === socketUrl) state.current.sequence = 0;
        },
        onError: () => startFallback(),
        onClose: () => startFallback(),
        onMessage: event => {
            if (state.current.key !== key || state.current.socketUrl !== socketUrl || typeof event.data !== 'string') return;
            if (event.data === 'reloadPage') {window.location.reload();return;}
            if (event.data === 'refresh') {startFallback();return;}
            let message;
            try {message = JSON.parse(event.data);} catch {return;}
            if (message?.type === 'snapshot-error') {startFallback();return;}
            if (message?.type !== 'snapshot' || message.version !== 1 || !Number.isSafeInteger(message.sequence)
                || message.sequence <= state.current.sequence || !message.data || typeof message.data !== 'object' || Array.isArray(message.data)) return;
            state.current.sequence = message.sequence;
            state.current.lastDataAt = Date.now();
            state.current.hasData = true;
            clearTimeout(recovery.current);recovery.current = undefined;
            clearTimeout(retry.current);retry.current = undefined;
            // SWR mutation also fences older in-flight HTTP results so an
            // outage recovery cannot overwrite a newer pushed snapshot.
            void mutate(message.data, {revalidate: false});
            setFallback(null);
            armWatchdog();
        },
    });

    useEffect(() => {
        if (state.current.key === key) state.current.hasData = data !== undefined;
    }, [data, key]);
    useEffect(() => {
        if (polling) void mutate().catch(() => {});
    }, [key, polling, mutate]);
    useEffect(() => {
        if (socketUrl) armWatchdog();
        return () => {
            if (state.current.key === key && state.current.socketUrl === socketUrl) state.current.key = '';
            clearTimeout(watchdog.current);watchdog.current = undefined;
            clearTimeout(recovery.current);recovery.current = undefined;
            clearTimeout(retry.current);retry.current = undefined;
        };
    }, [key, socketUrl, armWatchdog]);
    return {data};
}
