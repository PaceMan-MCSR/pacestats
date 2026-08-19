type SentryModule = typeof import("@sentry/nextjs");

let sentryPromise: Promise<SentryModule> | undefined;

const loadSentry = () => {
    sentryPromise ??= import("@sentry/nextjs").then((Sentry) => {
        Sentry.init({
            dsn: "https://33c40b5996ec0ff3d0edbbf986d7e65c@o4507196383690752.ingest.us.sentry.io/4507196383887360",
            tracesSampleRate: 0.1,
            debug: false,
        });
        return Sentry;
    });
    return sentryPromise;
};

const initializeWhenIdle = () => {
    const initialize = () => void loadSentry();
    if ("requestIdleCallback" in window) {
        window.requestIdleCallback(initialize, {timeout: 5_000});
    } else {
        setTimeout(initialize, 5_000);
    }
};

initializeWhenIdle();

export function onRouterTransitionStart(
    ...args: Parameters<SentryModule["captureRouterTransitionStart"]>
) {
    void loadSentry().then((Sentry) => Sentry.captureRouterTransitionStart(...args));
}
