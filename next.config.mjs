import {withSentryConfig} from '@sentry/nextjs';
/** @type {import('next').NextConfig} */
const nextConfig = {
    basePath: '/stats',
    trailingSlash: true,
    async headers() {
        return [
            {
                source: '/',
                headers: [
                    {
                        key: 'Cache-Control',
                        value: 'public, s-maxage=30, stale-while-revalidate=120',
                    },
                ],
            },
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
