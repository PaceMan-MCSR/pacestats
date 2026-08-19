import {NextRequest, NextResponse} from "next/server";

type Bucket = {count: number; resetAt: number; lastSeen: number};
const runtime = globalThis as typeof globalThis & {__paceStatsApiLimits?: Map<string, Bucket>};
const buckets = runtime.__paceStatsApiLimits ?? new Map<string, Bucket>();
runtime.__paceStatsApiLimits = buckets;

const tiers: Array<{match: RegExp; limit: number}> = [
    {match: /\/aa\/api\/getAllData\/?$/, limit: 6},
    {match: /\/api\/getRunsPaginated\/?$/, limit: 12},
    {match: /\/api\/deleteRun\/?$/, limit: 30},
    {match: /\/api\/(?:getCombinedStats|getCombinedNethers)\/?$/, limit: 60},
    {match: /\/api\/getAllUsers\/?$/, limit: 90},
    {match: /\/api\/(?:submitStats|searchPlayers|getPlayerRuns|getAAPlayerRuns)\/?$/, limit: 120},
    {match: /\/api\/(?:getLeaderboard|getFastest|getWorld)\/?$/, limit: 240},
];

function clientIp(request: NextRequest) {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || request.headers.get("x-real-ip")?.trim()
        || "unknown";
}

export function proxy(request: NextRequest) {
    const path = request.nextUrl.pathname;
    if (!/\/(?:api|aa\/api)\//.test(path)) return NextResponse.next();
    const limit = tiers.find((tier) => tier.match.test(path))?.limit ?? 180;
    const now = Date.now();
    const key = `${path}:${clientIp(request)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        bucket = {count: 0, resetAt: now + 60_000, lastSeen: now};
        buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.lastSeen = now;
    // Keep Map insertion order in least-recently-used order. This makes
    // bounded eviction linear in the number removed instead of sorting every
    // bucket during a traffic spike.
    buckets.delete(key);
    buckets.set(key, bucket);
    if (buckets.size > 10_000) {
        const staleKeys = buckets.keys();
        for (let index = 0; index < 1_000; index += 1) {
            const staleKey = staleKeys.next().value;
            if (staleKey === undefined) break;
            buckets.delete(staleKey);
        }
    }
    if (bucket.count <= limit) return NextResponse.next();
    return NextResponse.json({error: "Too many requests"}, {
        status: 429,
        headers: {"Cache-Control": "private, no-store", "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)))},
    });
}

export const config = {matcher: ["/api/:path*", "/aa/api/:path*"]};
