// Loaded on idle by instrumentation-client.ts. Named imports (instead of the
// whole @sentry/nextjs namespace) let the bundler drop the SDK features this
// site does not use, such as session replay and the feedback widget.
import {captureRouterTransitionStart, init} from "@sentry/nextjs";

export {captureRouterTransitionStart};

export const initSentry = () => {
    init({
        dsn: "https://33c40b5996ec0ff3d0edbbf986d7e65c@o4507196383690752.ingest.us.sentry.io/4507196383887360",
        tracesSampleRate: 0.1,
        debug: false,
    });
};
