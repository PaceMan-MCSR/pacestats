type SentryClient = typeof import("./sentry.client.lazy");

let sentryPromise: Promise<SentryClient> | undefined;

const loadSentry = () => {
    sentryPromise ??= import("./sentry.client.lazy").then((sentry) => {
        sentry.initSentry();
        return sentry;
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
    ...args: Parameters<SentryClient["captureRouterTransitionStart"]>
) {
    void loadSentry().then((sentry) => sentry.captureRouterTransitionStart(...args));
}
