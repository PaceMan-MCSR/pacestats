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
                hostname: 'mc-heads.net',
                port: '',
                pathname: '/avatar/*/*',
            },
        ],
    },
};

const sentryWebpackPluginOptions = {
// For all available options, see:
// https://github.com/getsentry/sentry-webpack-plugin#options

// Suppresses source map uploading logs during build
silent: true,
org: "jojoe-pacestats",
project: "javascript-nextjs",
};

const sentryBuildOptions = {
// For all available options, see:
// https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

// Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
// This can increase your server load as well as your hosting bill.
// Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
// side errors will fail.
// Hides source maps from generated client bundles
hideSourceMaps: true,

// Automatically tree-shake Sentry logger statements to reduce bundle size
disableLogger: true,
};

// The Sentry wrapper injects webpack-only build hooks. Retain those hooks for
// production source maps, but keep Turbopack development on a native config.
export default process.env.NODE_ENV === "production"
    ? withSentryConfig(nextConfig, sentryWebpackPluginOptions, sentryBuildOptions)
    : nextConfig;
