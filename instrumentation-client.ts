type SentryClient = typeof import("./sentry.client.lazy");
import {installSentryLoader, registerSentryClient, reportSentryError, reportSentryTransition} from './sentry.client.bridge';

let sentryPromise: Promise<SentryClient> | undefined;

const loadSentry = () => {
    sentryPromise ??= import("./sentry.client.lazy").then((sentry) => {
        sentry.initSentry();
        registerSentryClient(sentry);
        // From here the SDK's own global handlers report errors.
        stopEarlyReporting();
        return sentry;
    }).catch(error => {sentryPromise = undefined;throw error;});
    return sentryPromise;
};

// The SDK is about 220 KB. requestIdleCallback alone fired within 100 ms of
// navigation start, so the download competed with the page's own files.
// Wait for the load event, then a quiet moment.
const SENTRY_DELAY_MS = 3_000;

const initializeAfterLoad = () => {
    const initialize = () => void loadSentry().catch(() => {});
    const whenIdle = () => {
        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(initialize, {timeout: 5_000});
        } else {
            initialize();
        }
    };
    const schedule = () => setTimeout(whenIdle, SENTRY_DELAY_MS);
    if (document.readyState === "complete") {
        schedule();
    } else {
        window.addEventListener("load", schedule, {once: true});
    }
};

// An error thrown before the SDK arrives is still worth reporting: load the
// SDK straight away and hand it the error.
const reportEarlyError = (event: ErrorEvent | PromiseRejectionEvent) => {
    const error = "reason" in event ? event.reason : event.error;
    if (error === undefined || error === null) return;
    reportSentryError(error);
};
window.addEventListener("error", reportEarlyError);
window.addEventListener("unhandledrejection", reportEarlyError);
const stopEarlyReporting = () => {
    window.removeEventListener("error", reportEarlyError);
    window.removeEventListener("unhandledrejection", reportEarlyError);
};

installSentryLoader(loadSentry);
initializeAfterLoad();

export function onRouterTransitionStart(
    ...args: Parameters<SentryClient["captureRouterTransitionStart"]>
) {
    reportSentryTransition(...args);
}
