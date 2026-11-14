/** Preload only in isolated Docker benchmark servers: no third-party network. */
import {existsSync} from 'node:fs';
if (!existsSync('/.dockerenv')) throw new Error('The local upstream fixture requires Docker.');
const original = globalThis.fetch;
const localHosts = new Set(['localhost','127.0.0.1','[::1]']);
globalThis.fetch = (input,options) => {
    let url;
    try {url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);} catch {return original(input,options);}
    if (localHosts.has(url.hostname)) return original(input,options);
    // Live-state reads use an empty upstream snapshot; thumbnail/identity
    // probes are unavailable. Both revisions get identical immediate replies.
    if (url.hostname === 'paceman.gg' && url.pathname === '/api/ars/liveruns') return Promise.resolve(Response.json([]));
    return Promise.resolve(new Response(null,{status:404}));
};
