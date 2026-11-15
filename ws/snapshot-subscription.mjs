const kinds = new Set(['session', 'nethers', 'combinedStats', 'combinedNethers']);

/** Canonical, bounded keys let identical overlays share one backend read. */
export function parseSnapshotSubscription(input) {
    const kind = input.get('kind');
    if (!kinds.has(kind)) throw new Error('Invalid snapshot kind');
    const combined = kind.startsWith('combined');
    const params = new URLSearchParams({kind});
    const rawSince = input.get('since');
    const since = rawSince === null ? 0 : Number(rawSince);
    if (rawSince !== null && (!/^\d+$/.test(rawSince) || !Number.isSafeInteger(since))) throw new Error('Invalid since');
    const integer = (name, fallback, minimum, maximum) => {
        const raw = input.get(name);
        if (raw !== null && raw !== '' && !/^-?\d+$/.test(raw.trim())) throw new Error(`Invalid ${name}`);
        const value = raw === null || raw === '' ? fallback : Number(raw);
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
        return value;
    };
    if (combined) {
        const names = (input.get('names') || '').split(',').map(name => name.trim()).filter(Boolean);
        if (!names.length || names.length > 20 || names.some(name => name.length > 64)) throw new Error('Invalid names');
        params.set('names', names.join(','));
    } else {
        const name = (input.get('name') || '').trim();
        if (!name || name.length > 64) throw new Error('Invalid name');
        params.set('name', name);
    }
    params.set('hours', String(Math.min(9_999 * 24, integer('hours', 24, 1, 9_999_999))));
    params.set('hoursBetween', String(integer('hoursBetween', 6, combined ? 1 : 0, 9_999_999)));
    if (kind === 'nethers') {
        const liveOnly = input.get('liveOnly');
        if (liveOnly !== null && liveOnly !== '' && liveOnly !== 'true' && liveOnly !== 'false') throw new Error('Invalid liveOnly');
        params.set('liveOnly', String(liveOnly === 'true'));
        const nph = input.get('nph');
        if (nph !== null && nph !== '' && nph !== 'true' && nph !== 'false') throw new Error('Invalid nph');
        params.set('nph', String(nph === null || nph === '' || nph === 'true'));
        params.set('dp', String(integer('dp', 0, 0, 3)));
    }
    if (combined) params.set('start', String(integer('start', 0, 0, Number.MAX_SAFE_INTEGER)));
    if (kind === 'combinedNethers') params.set('maxTime', String(integer('maxTime', 99_999_999, 1, 99_999_999)));
    // The seed age belongs to this browser, never to the shared query/cache key.
    return {key: params.toString(), params, since};
}

/** Bound memory even if a broken internal upstream streams a huge response. */
export function createSnapshotFetcher({endpoint, token, timeoutMs = 8_000, maxBytes = 32 * 1024, fetchImpl = fetch}) {
    const base = new URL(endpoint);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid WS_SNAPSHOT_ENDPOINT');
    return async (subscription, signal) => {
        if (!token) throw new Error('WS_TOKEN is required for overlay snapshots');
        const url = new URL(base);
        url.search = subscription.params.toString();
        const response = await fetchImpl(url, {headers: {authorization: `Bearer ${token}`},
            cache: 'no-store', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])});
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Overlay snapshot upstream returned ${response.status}`);
        }
        const declaredBytes = Number(response.headers.get('content-length'));
        if (declaredBytes > maxBytes) {
            await response.body?.cancel();
            throw new Error('Overlay snapshot exceeds limit');
        }
        if (!response.body) throw new Error('Missing overlay snapshot body');
        const reader = response.body.getReader();
        const buffer = new Uint8Array(maxBytes);
        let length = 0;
        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                if (length + value.byteLength > maxBytes) throw new Error('Overlay snapshot exceeds limit');
                buffer.set(value, length);
                length += value.byteLength;
            }
        } finally {
            await reader.cancel();
            reader.releaseLock();
        }
        return JSON.parse(new TextDecoder().decode(buffer.subarray(0, length)));
    };
}
