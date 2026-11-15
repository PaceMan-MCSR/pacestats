/** Fresh Next process per request; local Docker, read-only SQL and Redis. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,readFileSync} from 'node:fs';
import {mkdir,realpath,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createConnection} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import Redis from 'ioredis';

assert.ok(existsSync('/.dockerenv'),'Use the local Docker environment');
const roots=await Promise.all([process.env.PERF_BASELINE_ROOT,process.env.PERF_SOURCE_ROOT].map(async root=>{
    assert.ok(root,'Set both frozen production roots');
    const path=await realpath(root);
    assert.ok(path.startsWith('/tmp/pacestats-'));
    assert.ok(existsSync(resolve(path,'.next/BUILD_ID')),'Build each frozen root first');
    return path;
}));
const rounds=Number(process.env.PERF_ROUNDS??3);
assert.ok(Number.isSafeInteger(rounds)&&rounds>0&&rounds<=10);
const output=process.env.PERF_OUTPUT??'/app/test-artifacts/performance/cold-loads/cold-start.json';
const reserved=new Redis('redis://127.0.0.1:6379/14');
assert.equal(await reserved.dbsize(),0,'Reserved Redis14 must be empty');
const ticks=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim());
const cases=[
    {name:'front:lifetime',path:'?days=9999',html:true,front:true},
    {name:'profile:lifetime',path:'player/NoFearr1337/?days=9999',html:true},
    {name:'profile:1day',path:'player/NoFearr1337/?days=1',html:true},
    {name:'aa-profile:lifetime',path:'player/CroProYT/aa/?days=9999',html:true,content:'Stats for CroProYT'},
    {name:'api:latest-completion',path:'api/getLatestCompletion/?name=NoFearr1337'},
    {name:'api:recent-runs',path:'api/getRecentRuns/?name=NoFearr1337&limit=10'},
];
const results=[];

const sample=pid=>{
    const stat=readFileSync(`/proc/${pid}/stat`,'utf8');
    const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
    const status=readFileSync(`/proc/${pid}/status`,'utf8');
    return {cpuTicks:Number(fields[11])+Number(fields[12]),rssMiB:Number(status.match(/^VmRSS:\s+(\d+)/m)[1])/1024};
};
const listening=port=>new Promise(done=>{
    const socket=createConnection({host:'127.0.0.1',port});
    socket.once('connect',()=>{socket.destroy();done(true);});
    socket.once('error',()=>{socket.destroy();done(false);});
});
async function stop(child){
    if(child.exitCode!==null||child.signalCode!==null)return;
    // This is the child launched below, never an existing user's server.
    const exited=once(child,'exit');child.kill('SIGTERM');
    const timeout=new AbortController();
    const stopped=await Promise.race([exited.then(()=>true),delay(3_000,false,{signal:timeout.signal})]);
    timeout.abort();
    if(!stopped&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
}

try{
    for(let round=0;round<rounds;round++)for(const emptyRedis of [false,true])for(const item of cases){
        for(const index of round%2?[1,0]:[0,1]){
            const kind=index?'final':'baseline',port=5125+index;
            assert.equal(await listening(port),false,`Private port${port} must be unused`);
            const launched=performance.now();let log='',spawnError;
            const child=spawn(process.execPath,['--import','/app/tests/local-upstreams.mjs',
                'node_modules/next/dist/bin/next','start','-p',String(port)],{
                cwd:roots[index],env:{...process.env,NODE_ENV:'production',
                    REDIS_URL:`redis://127.0.0.1:6379/${emptyRedis?14:0}`},stdio:['ignore','pipe','pipe'],
            });
            child.stdout.on('data',chunk=>{log=(log+chunk).slice(-8_000);});
            child.stderr.on('data',chunk=>{log=(log+chunk).slice(-8_000);});
            child.once('error',error=>{spawnError=error;});
            try{
                while(!await listening(port)){
                    if(spawnError)throw spawnError;
                    assert.equal(child.exitCode,null,log);
                    assert.equal(child.signalCode,null,log);
                    assert.ok(performance.now()-launched<20_000,`Startup timeout: ${log}`);
                    await delay(25);
                }
                const startupMs=performance.now()-launched,before=sample(child.pid);
                let peakRssMiB=before.rssMiB;
                const timer=setInterval(()=>{try{peakRssMiB=Math.max(peakRssMiB,sample(child.pid).rssMiB);}catch{}},10);
                let durationMs,after,body,response;
                try{
                    const started=performance.now();
                    response=await fetch(`http://127.0.0.1:${port}/stats/${item.path}`,{headers:{connection:'close'},signal:AbortSignal.timeout(30_000)});
                    body=await response.text();durationMs=performance.now()-started;after=sample(child.pid);
                }finally{clearInterval(timer);}
                assert.equal(response.status,200,body.slice(0,200));
                if(item.html){assert.ok(body.includes(item.front?(emptyRedis?'Retry leaderboards':'Nether Enters'):(item.content??'Stats for NoFearr1337')));assert.ok(!body.includes('An error has occurred'));}
                else assert.ok(Array.isArray(JSON.parse(body)));
                const result={round,kind,emptyRedis,name:item.name,status:response.status,
                    startupMs:Math.round(startupMs*10)/10,durationMs:Math.round(durationMs*10)/10,
                    cpuMs:(after.cpuTicks-before.cpuTicks)/ticks*1000,startRssMiB:before.rssMiB,
                    peakRssMiB:Math.max(peakRssMiB,after.rssMiB),responseBytes:Buffer.byteLength(body)};
                results.push(result);console.log(JSON.stringify(result));
            }finally{await stop(child);}
        }
    }
    assert.equal(await reserved.dbsize(),0);
}finally{
    reserved.disconnect();await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify({method:'One first HTTP request per fresh production Next process. Warm Redis0 or empty reserved Redis14; no browser emulation, MySQL/OS buffers not flushed. TCP startup time is separate. CPU ticks and10ms RSS samples describe this process, not total Docker memory or a peak CPU ceiling.',roots,rounds,expectedSamples:rounds*2*cases.length*roots.length,results},null,2));
}
