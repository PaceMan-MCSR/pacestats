import {createHash, timingSafeEqual} from "node:crypto";
import {NextRequest, NextResponse} from "next/server";

export const MAX_LOOKBACK_DAYS = 90;
export const MAX_LOOKBACK_HOURS = MAX_LOOKBACK_DAYS * 24;

export class ApiInputError extends Error {}

interface IntegerOptions {
    defaultValue?: number;
    min?: number;
    max?: number;
    allowed?: readonly number[];
}

export const integerParam = (
    params: URLSearchParams,
    name: string,
    options: IntegerOptions = {}
): number => {
    const raw = params.get(name);
    if (raw === null || raw === "") {
        if (options.defaultValue !== undefined) return options.defaultValue;
        throw new ApiInputError(`Missing ${name}`);
    }
    if (!/^-?\d+$/.test(raw.trim())) throw new ApiInputError(`${name} must be an integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new ApiInputError(`${name} is outside the supported range`);
    if (options.min !== undefined && value < options.min) throw new ApiInputError(`${name} must be at least ${options.min}`);
    if (options.max !== undefined && value > options.max) throw new ApiInputError(`${name} must be at most ${options.max}`);
    if (options.allowed && !options.allowed.includes(value)) {
        throw new ApiInputError(`${name} must be one of ${options.allowed.join(", ")}`);
    }
    return value;
};

interface StringOptions {
    defaultValue?: string;
    required?: boolean;
    maxLength?: number;
    allowed?: readonly string[];
}

export const stringParam = (
    params: URLSearchParams,
    name: string,
    options: StringOptions = {}
): string => {
    const raw = params.get(name);
    if (raw === null) {
        if (options.defaultValue !== undefined) return options.defaultValue;
        if (!options.required) return "";
        throw new ApiInputError(`Missing ${name}`);
    }
    const value = raw.trim();
    if (options.required && value.length === 0) throw new ApiInputError(`Missing ${name}`);
    if (options.maxLength !== undefined && value.length > options.maxLength) {
        throw new ApiInputError(`${name} must be at most ${options.maxLength} characters`);
    }
    if (options.allowed && !options.allowed.includes(value)) {
        throw new ApiInputError(`${name} must be one of ${options.allowed.join(", ")}`);
    }
    return value;
};

export const booleanParam = (params: URLSearchParams, name: string, defaultValue = false): boolean => {
    const raw = params.get(name);
    if (raw === null || raw === "") return defaultValue;
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new ApiInputError(`${name} must be true or false`);
};

export const listParam = (
    params: URLSearchParams,
    name: string,
    maxItems: number,
    maxItemLength = 64
): string[] => {
    const raw = params.get(name);
    if (!raw) return [];
    const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
    if (items.length > maxItems) throw new ApiInputError(`${name} supports at most ${maxItems} entries`);
    if (items.some((item) => item.length > maxItemLength)) {
        throw new ApiInputError(`${name} entries must be at most ${maxItemLength} characters`);
    }
    return items;
};

const requestApiKey = (request: NextRequest): string => {
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.match(/^\s*Bearer\s+(.+?)\s*$/i)?.[1];
    return bearer ?? request.headers.get("x-api-key")?.trim() ?? "";
};

/**
 * Authenticate a protected API without putting credentials in the URL.
 * Hashing both values first keeps the timing-safe comparison fixed-width,
 * including when a caller submits a key with a different length.
 */
export const hasValidApiKey = (request: NextRequest, expected: string | undefined): boolean => {
    if (!expected || expected.length === 0) return false;
    const provided = requestApiKey(request);
    if (provided.length === 0) return false;

    const providedDigest = createHash("sha256").update(provided, "utf8").digest();
    const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
    return timingSafeEqual(providedDigest, expectedDigest);
};

export const mapWithConcurrency = async <T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workers = Array.from({length: Math.min(Math.max(1, concurrency), items.length)}, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
};

export const validationErrorResponse = (error: unknown) => {
    if (!(error instanceof ApiInputError)) return null;
    return NextResponse.json(
        {error: error.message},
        {status: 400, headers: {"Cache-Control": "private, no-store"}}
    );
};

/**
 * JSON response with the shared cache headers. Compression is left to the
 * reverse proxy: Next.js does not compress route-handler responses, and nginx
 * is configured to apply Brotli or gzip to application/json.
 */
export const jsonResponse = (
    data: unknown,
    options: {status?: number; cacheSeconds?: number; staleSeconds?: number} = {}
) => {
    const status = options.status ?? 200;
    const headers: Record<string, string> = {};
    if (status >= 200 && status < 300 && options.cacheSeconds !== undefined) {
        const staleSeconds = options.staleSeconds ?? Math.max(options.cacheSeconds, 30);
        headers["Cache-Control"] = `public, max-age=0, s-maxage=${options.cacheSeconds}, stale-while-revalidate=${staleSeconds}`;
    } else {
        headers["Cache-Control"] = "private, no-store";
    }

    return NextResponse.json(data, {status, headers});
};

interface RateLimitBucket {
    count: number;
    resetAt: number;
    lastSeen: number;
}

type ApiRuntime = typeof globalThis & {
    __paceStatsRateLimits?: Map<string, RateLimitBucket>;
};

const apiRuntime = globalThis as ApiRuntime;
const rateLimits = apiRuntime.__paceStatsRateLimits ?? new Map<string, RateLimitBucket>();
apiRuntime.__paceStatsRateLimits = rateLimits;
const MAX_RATE_LIMIT_BUCKETS = 10_000;

const clientAddress = (request: NextRequest) => {
    // This assumes the deployment proxy replaces, rather than appends untrusted,
    // X-Forwarded-For. Deployments without a trusted proxy will share "unknown".
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
};

export const rateLimit = (
    request: NextRequest,
    options: {namespace: string; limit: number; windowMs: number}
): NextResponse | null => {
    const now = Date.now();
    const key = `${options.namespace}:${clientAddress(request)}`;
    let bucket = rateLimits.get(key);
    if (!bucket || bucket.resetAt <= now) {
        bucket = {count: 0, resetAt: now + options.windowMs, lastSeen: now};
        rateLimits.set(key, bucket);
    }
    bucket.count += 1;
    bucket.lastSeen = now;
    rateLimits.delete(key);
    rateLimits.set(key, bucket);

    if (rateLimits.size > MAX_RATE_LIMIT_BUCKETS) {
        const staleKeys = rateLimits.keys();
        const removeCount = Math.ceil(MAX_RATE_LIMIT_BUCKETS * 0.1);
        for (let index = 0; index < removeCount; index += 1) {
            const staleKey = staleKeys.next().value;
            if (staleKey === undefined) break;
            rateLimits.delete(staleKey);
        }
    }

    if (bucket.count <= options.limit) return null;
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    return NextResponse.json(
        {error: "Too many requests"},
        {
            status: 429,
            headers: {
                "Cache-Control": "private, no-store",
                "Retry-After": String(retryAfterSeconds),
            },
        }
    );
};
