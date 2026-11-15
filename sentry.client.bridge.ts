/** Keep one SDK owner across Next's instrumentation and App Router layers. */
export interface SentryBridgeClient {
    captureException(error: unknown): unknown;
    captureRouterTransitionStart(href: string, navigationType: string): void;
}

interface Bridge {
    client?: SentryBridgeClient;
    load?: () => Promise<unknown>;
    errors: unknown[];
}

const bridge = (): Bridge => {
    const browser = globalThis as typeof globalThis & {__paceStatsSentry?: Bridge};
    return browser.__paceStatsSentry ??= {errors: []};
};

const request = (state: Bridge) => {
    // A failed chunk download must not create an unhandled-rejection loop.
    // Keep queued errors so the next real error or idle attempt can retry.
    if (state.load) void state.load().catch(() => {});
};

export function installSentryLoader(load: () => Promise<unknown>) {
    const state = bridge();
    state.load = load;
    if (state.errors.length) request(state);
}

export function registerSentryClient(client: SentryBridgeClient) {
    const state = bridge();
    state.client = client;
    for (const error of state.errors.splice(0)) client.captureException(error);
}

export function reportSentryError(error: unknown) {
    const state = bridge();
    if (state.client) {state.client.captureException(error);return;}
    if (state.errors.length === 20) state.errors.shift();
    state.errors.push(error);
    request(state);
}

export function reportSentryTransition(...args: Parameters<SentryBridgeClient['captureRouterTransitionStart']>) {
    // Navigation must not start a competing SDK download. The existing idle
    // initializer loads it; early errors still request it immediately. The SDK
    // starts navigation spans at call time, so replaying an earlier transition
    // after it initializes would produce a false trace.
    bridge().client?.captureRouterTransitionStart(...args);
}
