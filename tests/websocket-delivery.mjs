/** Docker-only real server test on a private port and Redis Pub/Sub channel. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import Redis from 'ioredis';
import {WebSocket} from 'ws';
assert.ok(existsSync('/.dockerenv'),'Use local Docker');
const reservation = createServer();
reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port = reservation.address().port;
await new Promise(done => reservation.close(done));
const channel = `pacestats:perf:${randomUUID()}`, token = 'local-fixture-token';
const child = spawn('node',['ws/index.mjs'],{cwd:process.cwd(),env:{...process.env,WS_PORT:String(port),
    WS_REDIS_CHANNEL:channel,WS_TOKEN:token,WS_ALLOWED_ORIGINS:'http://localhost:5050',WS_COALESCE_MS:'60',DOTENV_CONFIG_PATH:'/dev/null'},stdio:['ignore','pipe','pipe']});
let logs = '';
const ready = new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error(`Websocket startup: ${logs}`)),5000);
    const check = data => {logs += data; if(logs.includes('listening on port') && logs.includes('Subscribed to Redis channel')){clearTimeout(timer);resolve();}};
    child.stdout.on('data',check);child.stderr.on('data',check);
});
const sockets = [], redis = new Redis(process.env.REDIS_URL);
const connect = async (uuid,path=`pull/${uuid}`) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${path}`,{origin:'http://localhost:5050'});
    sockets.push(socket);await once(socket,'open');return socket;
};
try {
    await ready;
    const a = await connect('player-a'), b = await connect('player-b');
    const aMessages = [], bMessages = [];
    a.on('message',data => aMessages.push(String(data)));b.on('message',data => bMessages.push(String(data)));
    const first = once(a,'message');
    await Promise.all(Array.from({length:50},() => redis.publish(channel,JSON.stringify({uuid:'player-a'}))));
    await redis.publish(channel,JSON.stringify({uuid:'player-a',type:'reloadPage'}));
    await first;
    assert.deepEqual(aMessages,['reloadPage']);assert.deepEqual(bMessages,[]);
    const second = once(a,'message');
    await connect('player-a',`push/player-a/${token}`);await second;
    assert.deepEqual(aMessages,['reloadPage','refresh']);
    const third = once(b,'message');
    await redis.publish(channel,JSON.stringify({uuid:'player-b'}));await third;
    assert.deepEqual(bMessages,['refresh']);
    await connect('invalid','pull/not-valid!');
    console.log('PASS: actual Redis and legacy push delivery, duplicate coalescing, reload priority and UUID isolation');
} finally {
    for(const socket of sockets) socket.terminate();
    await redis.quit();
    const exit = once(child,'exit');child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'),5000);timer.unref();
    await exit;clearTimeout(timer);
}
