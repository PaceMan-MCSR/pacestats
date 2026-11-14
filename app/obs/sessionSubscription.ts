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
