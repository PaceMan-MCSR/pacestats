import {withSentryConfig} from '@sentry/nextjs';
/** @type {import('next').NextConfig} */
const nextConfig = {
    basePath: '/stats',
    // nginx compresses responses (Brotli, with gzip as the fallback). If Next
    // gzipped them first, nginx would pass that through and Brotli would
    // never apply. See ops/nginx/pacestats.conf.
    compress: false,
    trailingSlash: true,
    experimental: {
        // Let the browser reuse page data it already has for 30 seconds:
        // going back to the leaderboard, reopening a player or switching the
        // day range back needs no request. The pages themselves are cached
        // for 15 to 30 seconds on the server, so this adds no staleness.
        staleTimes: {
            dynamic: 30,
        },
    },
    async headers() {
        // These pages are the same for every visitor, so a shared cache
        // (nginx proxy_cache, a CDN) may reuse them briefly instead of
        // rendering each view. Browsers still revalidate on every load.
        // See ops/nginx/pacestats.conf for a proxy cache that honours these.
        const sharedCache = (sMaxAge, staleWhileRevalidate) => [
            {
                key: 'Cache-Control',
                value: `public, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
            },
        ];
        return [
            // Icons, backgrounds and fonts in public/. Their names carry no
            // content hash, so cache for a day and refresh in the background.
            {
                source: '/:file(.+\\.(?:webp|png|ico|ttf|woff2?|svg))',
                headers: [{
                    key: 'Cache-Control',
                    value: 'public, max-age=86400, stale-while-revalidate=604800',
                }],
            },
            {source: '/', headers: sharedCache(30, 120)},
            {source: '/aa', headers: sharedCache(30, 120)},
            {source: '/obs', headers: sharedCache(300, 600)},
            // Profile pages show recent runs, so keep them close to live.
            {source: '/player/:path*', headers: sharedCache(15, 60)},
        ];
    },
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'mc-api.io',
                port: '',
                pathname: '/render/**',
            },
        ],
    },
};

const sentryBuildOptions = {
    // The token is supplied by the production build environment. It needs
    // project:releases scope so the build can create the release and upload maps.
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: "jojoe-pacestats",
    project: "javascript-nextjs",
    // Keep the release injected into the client in sync with the release that
    // receives source maps. When unset, the SDK falls back to the git revision.
    release: {
        name: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
    },
    // `executors/*.js` and other Turbopack runtime chunks live outside the
    // default app/page upload paths. Upload all client chunks so their frames
    // symbolicate in Sentry, then remove maps from the deploy output.
    widenClientFileUpload: true,
    sourcemaps: {
        deleteSourcemapsAfterUpload: true,
    },
    // Do not hide upload failures: a successful build without source maps is
    // otherwise difficult to spot until the next production exception.
    silent: false,
};

// Only production builds need release creation and source-map uploads.
export default process.env.NODE_ENV === "production"
    ? withSentryConfig(nextConfig, sentryBuildOptions)
    : nextConfig;
