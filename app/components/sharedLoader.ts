/** Share successful work, but let the next user intent retry a failed load. */
export function createSharedLoader<Value>(load: () => Promise<Value>) {
    let current: Value | undefined;
    let request: Promise<Value> | undefined;
    return {
        get current() { return current; },
        load() {
            request ??= Promise.resolve().then(load).then(value => {
                current = value;
                return value;
            }).catch(error => {
                request = undefined;
                throw error;
            });
            return request;
        },
    };
}
