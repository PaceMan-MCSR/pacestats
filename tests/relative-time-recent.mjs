/** Docker-only independent Moment parity and Date-allocation diagnostic. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import moment from 'moment';
assert.ok(existsSync('/.dockerenv'),'Use local Docker');
const root=resolve(process.env.PERF_SOURCE_ROOT??process.cwd());
const {fromNow}=await import(pathToFileURL(`${root}/app/components/profile/relativeTime.ts`).href);
const reference=process.env.PERF_REFERENCE_ROOT??'/tmp/pacestats-site-baseline';
const previous=existsSync(`${reference}/app/components/profile/relativeTime.ts`)
    ?(await import(pathToFileURL(`${reference}/app/components/profile/relativeTime.ts`).href)).fromNow:null;
// Frozen legacy outputs at DST setter ambiguities. These differ from Moment;
// keep the test runnable when the optional old checkout is unavailable.
const legacyDstCases=new Map([
    ['America/New_York|2024-11-03T07:30:00Z|2670','2 hours ago'],
    ['America/New_York|2024-11-03T07:30:00Z|5370','2 hours ago'],
    ['America/New_York|2024-11-03T07:30:00Z|4898.143317550421','2 hours ago'],
    ['Australia/Sydney|2024-04-07T03:30:00Z|38151.615634560585','12 hours ago'],
]);
const zones=['UTC','America/New_York','Australia/Sydney','Europe/Berlin'];
const anchors=['2024-03-10T07:30:00Z','2024-11-03T07:30:00Z','2024-02-29T12:00:00Z',
    '2024-03-31T02:30:00Z','2024-04-07T03:30:00Z','2024-10-06T03:30:00Z','2025-01-01T00:00:00Z'];
const ages=[0,.001,.5,1,44.4999999,44.5,44.5000001,59.5,89.4999,89.5,
    44.5*60,89.5*60,21.5*3600,25.5*86400,24.99999999*86400,25*86400,26*86400,
    28*86400,30*86400,45*86400,365*86400,730*86400];
let seed=123456;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/0x100000000);
for(let i=0;i<500;i++)ages.push(random()*25*86400);
let checked=0,legacyMomentDifferences=0;
const previousZone=process.env.TZ;
try{
    process.env.TZ='UTC';
    for(const [now,expected]of [[8.64e15,'NaN years ago'],[-8.64e15,'NaN years ago'],[-62162078400000,'a day ago']]) {
        assert.equal(fromNow(now/1000,now),expected,'Legacy clipped-calendar/year-0 behavior remains unchanged');
    }
    if(previous) {
        for(const now of [-8.64e15,-8.64e15+40*86400000,-62162078400000,-59042995200000,-59011459200000,
            -1,-.5,0,.5,8.64e15-40*86400000,8.64e15-35*86400000,8.64e15-86400000,8.64e15]) {
            for(const age of [0,.001,44.4999999,44.5,86400,24.9999999*86400,25*86400,30*86400]) {
                const start=(now-age*1000)/1000;
                assert.equal(fromNow(start,now),previous(start,now),`Extreme legacy parity now=${now} age=${age}`);
            }
        }
    }
    for(const zone of zones){
        process.env.TZ=zone;
        for(const anchor of anchors){
            const now=Date.parse(anchor);
            for(const age of ages){
                const start=(now-age*1000)/1000;
                const momentExpected=moment.unix(Math.min(start,now/1000)).from(moment(now));
                const expected=previous?previous(start,now):(legacyDstCases.get(`${zone}|${anchor}|${age}`)??momentExpected);
                if(expected!==momentExpected)legacyMomentDifferences++;
                assert.equal(fromNow(start,now),expected,`${zone} ${anchor} age=${age}`);checked++;
            }
            assert.equal(fromNow((now+100_000)/1000,now),'a few seconds ago');
        }
    }
    const NativeDate=globalThis.Date;
    let dates=0,checksum=0;
    globalThis.Date=class extends NativeDate{constructor(...args){dates++;super(...args);}};
    try{
        const now=1_730_000_000_000;
        for(let i=0;i<10_000;i++)checksum+=fromNow((now-(60+i*10)*1000)/1000,now).length;
    }finally{globalThis.Date=NativeDate;}
    if(!process.env.PERF_SOURCE_ROOT)assert.equal(dates,10000);
    console.log(JSON.stringify({checks:'frozen baseline parity across thresholds, fractional milliseconds, month/leap/DST boundaries, future clamping and clipped-calendar edges; independent Moment comparison retains legacy DST quirks',checked,legacyMomentDifferences,
        source:root,reference:previous?reference:'Moment',recentCalls:10000,dateConstructions:dates,checksum}));
}finally{
    if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone;
}
