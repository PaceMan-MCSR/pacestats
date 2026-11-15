/** A loading/error overlay has no player to subscribe to yet. */
export function sessionSocketUrl(endpoint: string | undefined, uuid: unknown): string | null {
    if (!endpoint || typeof uuid !== "string" || !uuid || uuid === "undefined" || uuid === "null") return null;
    try {
        const url = new URL(endpoint);
        if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
        url.pathname = `${url.pathname.replace(/\/$/, "")}/pull/${encodeURIComponent(uuid)}`;
        return url.href;
    } catch {
        return null;
    }
}

const overlayKinds: Record<string, string> = {
    getSessionStats: 'session',
    getSessionNethers: 'nethers',
    getCombinedStats: 'combinedStats',
    getCombinedNethers: 'combinedNethers',
};

/** Dynamic route names can still contain escaped commas. Decode once before
 * quoting them as a query value, matching the existing overlay URL semantics. */
export function overlayNameQuery(value: string): string {
    try {return encodeURIComponent(decodeURIComponent(value));}
    catch {return encodeURIComponent(value);}
}

/** Preserve reverse-proxy prefixes; do not expose the internal snapshot secret. */
export function overlaySocketUrl(endpoint: string | undefined, apiKey: string, initialDataAt?: number): string | null {
    if (!endpoint) return null;
    try {
        const url = new URL(endpoint);
        const api = new URL(apiKey, 'http://localhost');
        const kind = overlayKinds[api.pathname.split('/').filter(Boolean).at(-1) ?? ''];
        if (!kind || !['ws:', 'wss:'].includes(url.protocol)) return null;
        url.pathname = `${url.pathname.replace(/\/$/, '')}/overlay`;
        url.search = '';
        url.searchParams.set('kind', kind);
        // Deterministic query order lets identical browser sources share one
        // connection even when their API query strings were assembled differently.
        for (const [name, value] of [...api.searchParams].sort(([a], [b]) => a.localeCompare(b))) {
            url.searchParams.set(name, value);
        }
        if (initialDataAt && Number.isSafeInteger(initialDataAt) && initialDataAt > 0) url.searchParams.set('since', String(initialDataAt));
        return url.href;
    } catch {return null;}
}
