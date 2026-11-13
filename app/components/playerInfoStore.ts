// What the browser knows about players by nick: UUID, display name and
// custom colours. Pages that already hold this for their player put it in
// (see PlayerInfoSeed), so the header can colour itself without a request.
// The search box asks for the few players it is showing.

import {useEffect, useSyncExternalStore} from "react";

export type PlayerInfo = {
    id: string;
    displayName: string | null;
    color: string | null;
    bgColor: string | null;
};

// undefined: not asked yet. null: asked, no such player.
const known = new Map<string, PlayerInfo | null>();
const listeners = new Set<() => void>();
const queued = new Set<string>();
const inFlight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const BATCH_DELAY_MS = 20;
const MAX_BATCH = 20;

const key = (nick: string) => nick.toLocaleLowerCase();

// On a full page load PlayerInfoSeed writes its player into this global from
// an inline script, which runs before the header hydrates.
const PAGE_GLOBAL = "__pacePlayerInfo";

function lookup(name: string): PlayerInfo | null | undefined {
    if (!known.has(name) && typeof window !== "undefined") {
        const fromPage = (window as unknown as Record<string, Record<string, PlayerInfo> | undefined>)[PAGE_GLOBAL]?.[name];
        if (fromPage) known.set(name, fromPage);
    }
    return known.get(name);
}
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function seedPlayerInfo(nick: string, info: PlayerInfo | null) {
    const existing = known.get(key(nick));
    if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(info)) return;
    known.set(key(nick), info);
    notify();
}

function flush() {
    flushTimer = undefined;
    const names = [...queued].slice(0, MAX_BATCH);
    names.forEach((name) => {
        queued.delete(name);
        inFlight.add(name);
    });
    if (queued.size > 0) flushTimer = setTimeout(flush, BATCH_DELAY_MS);
    if (names.length === 0) return;

    fetch(`/stats/api/getPlayerInfo/?names=${names.map(encodeURIComponent).join(",")}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
        .then((result: Record<string, PlayerInfo | null>) => {
            names.forEach((name) => known.set(name, result[name] ?? null));
        })
        .catch(() => {
            // Left unknown, so a later render asks again.
        })
        .finally(() => {
            names.forEach((name) => inFlight.delete(name));
            notify();
        });
}

function requestPlayerInfo(nick: string) {
    const name = key(nick);
    if (lookup(name) !== undefined || queued.has(name) || inFlight.has(name)) return;
    queued.add(name);
    // Rows that render together share one request.
    flushTimer ??= setTimeout(flush, BATCH_DELAY_MS);
}

/**
 * Info for one player, or undefined while it is unknown. Asks the server
 * when nothing has been seeded for the nick. Pass null to look up nobody.
 */
export function usePlayerInfo(nick: string | null): PlayerInfo | null | undefined {
    const info = useSyncExternalStore(
        subscribe,
        () => nick === null ? null : lookup(key(nick)),
        () => nick === null ? null : undefined
    );
    useEffect(() => {
        if (nick !== null && info === undefined) requestPlayerInfo(nick);
    }, [nick, info]);
    return info;
}
