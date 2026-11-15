/** Compare complete HTML and its declared JS, without contacting third parties. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {brotliCompressSync,constants} from 'node:zlib';

assert.ok(existsSync('/.dockerenv'),'Run inside local Docker');
const servers=[process.env.PERF_BASELINE_URL,process.env.PERF_BASE_URL].map(value=>new URL(value));
for(const server of servers)assert.ok(['127.0.0.1','localhost','[::1]'].includes(server.hostname));
const output=process.env.PERF_OUTPUT??'/app/test-artifacts/performance/bundles/payloads.json';
const compressed=body=>brotliCompressSync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}).length;
const results=[],assets=new Map();
for(const path of ['', 'player/NoFearr1337/', 'player/NoFearr1337/runs/', 'player/CroProYT/runs/aa/', 'obs/', 'api/']) {
    for(const [index,base]of servers.entries()) {
        const response=await fetch(new URL(path,base));assert.equal(response.status,200);
        const html=await response.text(),body=Buffer.from(html);
        // Chromium ignores nomodule fallbacks; counting them as downloads
        // would add an unused 112 KB polyfill to every modern page.
        const tags=[...html.matchAll(/<script\b[^>]*>/g)].map(match=>match[0]);
        const scripts=[...new Set(tags.filter(tag=>!(/\bnomodule(?:\s|=|>)/i.test(tag)))
            .map(tag=>tag.match(/\bsrc="([^"]+)"/)?.[1]).filter(Boolean))];
        const files=await Promise.all(scripts.map(async path=>{
            const url=new URL(path,base);assert.equal(url.origin,base.origin);
            let pending=assets.get(url.href);
            if(!pending){pending=fetch(url).then(async response=>{
                assert.equal(response.status,200);const body=Buffer.from(await response.arrayBuffer());
                return {path:url.pathname,bytes:body.length,brotli5Bytes:compressed(body)};
            });assets.set(url.href,pending);}
            return pending;
        }));
        results.push({kind:index?'final':'baseline',path,documentBytes:body.length,documentBrotli5Bytes:compressed(body),
            declaredScripts:files.length,excludedNomoduleScripts:tags.filter(tag=>/\bnomodule(?:\s|=|>)/i.test(tag)).length,
            declaredScriptBytes:files.reduce((sum,file)=>sum+file.bytes,0),
            declaredScriptBrotli5Bytes:files.reduce((sum,file)=>sum+file.brotli5Bytes,0),files});
    }
}
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({method:'Complete streamed HTML and unique modern-browser declared script src assets; nomodule fallbacks excluded. Brotli quality5 estimates, not measured production wire transfer. Excludes fonts, images, RSC navigations and subsequent dynamic/idle scripts.',results},null,2));
for(const row of results)console.log(JSON.stringify({...row,files:undefined}));
