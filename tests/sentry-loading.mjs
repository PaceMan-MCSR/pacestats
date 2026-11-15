/** Docker-only actual instrumentation scheduling with a counted SDK fixture. */
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as bridge from '../sentry.client.bridge.ts';
const {transformSync}=createRequire('/app/package.json')('esbuild');
assert.ok(existsSync('/.dockerenv'),'Use local Docker');
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
const source=readFileSync(new URL('../instrumentation-client.ts',import.meta.url),'utf8')
    .replace('sentryPromise ??= import("./sentry.client.lazy")','sentryPromise ??= globalThis.__loadFixtureSdk()');
const code=transformSync(source,{loader:'ts',format:'cjs'}).code;
function instrument(load) {
    delete globalThis.__paceStatsSentry;
    const listeners=new Map(),timers=new Map(),idle=[];
    let clock=0,id=0;
    const window={
        addEventListener:(name,fn)=>listeners.set(name,fn),
        removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},
        requestIdleCallback:fn=>{idle.push(fn);},
    };
    const context={window,document:{readyState:'loading'},exports:{},module:{exports:{}},
        __loadFixtureSdk:load,
        require:name=>{assert.equal(name,'./sentry.client.bridge');return bridge;},
        setTimeout:(fn,delay)=>{const key=++id;timers.set(key,{fn,at:clock+delay});return key;},
    };
    vm.runInNewContext(code,context);
    return {api:context.module.exports,listeners,timers,idle,
        fire:(name,event)=>listeners.get(name)?.(event),
        advance:ms=>{clock+=ms;for(const [key,timer]of [...timers])if(timer.at<=clock){timers.delete(key);timer.fn();}}};
}

{
    let loads=0,init=0,resolve;
    const errors=[],transitions=[];
    const sdk={initSentry:()=>init++,captureException:error=>errors.push(error),captureRouterTransitionStart:(...args)=>transitions.push(args)};
    const fixture=instrument(()=>{loads++;return new Promise(done=>{resolve=done;});});
    assert.equal(loads,0);
    fixture.api.onRouterTransitionStart('/?days=7','push');
    assert.equal(loads,0,'A first navigation must not fetch the SDK');
    fixture.fire('load');fixture.advance(2999);
    assert.equal(loads,0);fixture.advance(1);
    assert.equal(fixture.idle.length,1);assert.equal(loads,0);
    fixture.idle.shift()();assert.equal(loads,1);
    fixture.api.onRouterTransitionStart('/player/fixture/','push');
    const early=new Error('early error');fixture.fire('error',{error:early});
    assert.equal(loads,1,'Errors and pending navigation share the in-flight SDK import');
    resolve(sdk);await settle();
    assert.equal(init,1);assert.deepEqual(errors,[early]);
    assert.deepEqual(transitions,[],'Completed pre-init transitions must not become false post-init navigation spans');
    assert.equal(fixture.listeners.has('error'),false);assert.equal(fixture.listeners.has('unhandledrejection'),false);
    fixture.api.onRouterTransitionStart('/?days=30','replace');
    const globalError=new Error('global boundary');bridge.reportSentryError(globalError);
    assert.equal(loads,1);assert.equal(init,1);assert.equal(errors.at(-1),globalError);
    assert.deepEqual(transitions.at(-1),['/?days=30','replace']);
}

{
    let loads=0,init=0;
    const errors=[],transitions=[],unhandled=[];
    const onUnhandled=error=>unhandled.push(error);
    process.on('unhandledRejection',onUnhandled);
    try {
        const fixture=instrument(()=>{
            loads++;
            return loads===1?Promise.reject(new Error('fixture chunk unavailable')):Promise.resolve({
                initSentry:()=>init++,captureException:error=>errors.push(error),captureRouterTransitionStart:(...args)=>transitions.push(args),
            });
        });
        const early=new Error('retain through failed SDK download');
        fixture.fire('unhandledrejection',{reason:early});await settle();
        assert.equal(loads,1);assert.deepEqual(errors,[]);assert.deepEqual(unhandled,[]);
        fixture.api.onRouterTransitionStart('/retry/','push');assert.equal(loads,1);
        fixture.fire('load');fixture.advance(3000);fixture.idle.shift()();await settle();
        assert.equal(loads,2);assert.equal(init,1);assert.deepEqual(errors,[early]);
        assert.deepEqual(transitions,[]);assert.deepEqual(unhandled,[]);
    } finally {process.off('unhandledRejection',onUnhandled);}
}

{
    delete globalThis.__paceStatsSentry;
    const errors=[],transitions=[];
    for(let i=0;i<100;i++){bridge.reportSentryError(i);bridge.reportSentryTransition(`/route-${i}/`,'push');}
    bridge.registerSentryClient({captureException:error=>errors.push(error),captureRouterTransitionStart:(...args)=>transitions.push(args)});
    assert.deepEqual(errors,Array.from({length:20},(_,i)=>i+80));
    assert.deepEqual(transitions,[]);
    assert.equal(globalThis.__paceStatsSentry.errors.length,0);
    delete globalThis.__paceStatsSentry;
}
console.log('PASS: first navigation keeps SDK deferred; one shared import/init; early/global errors, ready router hooks, bounded error queue and failed-download retry without false replayed spans or rejection loops');
