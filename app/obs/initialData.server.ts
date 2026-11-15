import {readOverlaySnapshot} from './snapshot.server';
import {overlayNameQuery} from './sessionSubscription';

type InitialRuntime = typeof globalThis & {
    __paceStatsInitialOverlayReads?: Map<string, Promise<any>>;
    __paceStatsInitialOverlayData?: Map<string, {data: any; expiresAt: number}>;
};
const runtime = globalThis as InitialRuntime;
const pending = runtime.__paceStatsInitialOverlayReads ?? new Map<string, Promise<any>>();
runtime.__paceStatsInitialOverlayReads = pending;
const recent = runtime.__paceStatsInitialOverlayData ?? new Map<string, {data: any; expiresAt: number}>();
runtime.__paceStatsInitialOverlayData = recent;

/** Seed browser-source HTML without another round trip. Identical simultaneous
 * page loads share a read; overload leaves the ordinary socket recovery path. */
export async function initialOverlayData(kind: string, name: string,
    settings: Record<string, number | boolean>, demo: boolean) {
    if (demo) return undefined;
    const params = new URLSearchParams(`${kind.startsWith('combined') ? 'names' : 'name'}=${overlayNameQuery(name)}`);
    params.set('kind', kind);
    for (const [key, value] of Object.entries(settings)) params.set(key, String(value));
    const key = params.toString();
    const cached = recent.get(key);
    if (cached) {
        recent.delete(key);
        if (cached.expiresAt > Date.now()) {recent.set(key, cached);return cached.data;}
    }
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 4) return undefined;
    const request = readOverlaySnapshot(params).then(snapshot => {
        // This short seed cache absorbs page-load bursts. The subsequent live
        // snapshot always reads fresh data and never consumes this cache.
        if (recent.size >= 64) recent.delete(recent.keys().next().value!);
        // A socket read must begin after this seed finished, rather than
        // overlap it, before it may replace the HTML's initial value.
        const seed = {data: snapshot.data, at: Date.now()};
        recent.set(key, {data: seed, expiresAt: Date.now() + 2000});
        return seed;
    }).catch(() => undefined)
        .finally(() => {if (pending.get(key) === request) pending.delete(key);});
    pending.set(key, request);
    return request;
}
