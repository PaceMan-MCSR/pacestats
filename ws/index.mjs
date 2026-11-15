import { timingSafeEqual } from 'node:crypto';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import { CoalescedBroadcasts } from './coalesced-broadcasts.mjs';
import { HeartbeatWheel } from './heartbeat-wheel.mjs';
import { SnapshotBroker } from './snapshot-broker.mjs';
import { SnapshotDelivery } from './snapshot-delivery.mjs';
import { createSnapshotFetcher, parseSnapshotSubscription } from './snapshot-subscription.mjs';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

const port = Number.parseInt(process.env.WS_PORT || '8080', 10);
const maxClients = Number.parseInt(process.env.WS_MAX_CLIENTS || '10000', 10);
const maxClientsPerUuid = Number.parseInt(process.env.WS_MAX_CLIENTS_PER_UUID || '100', 10);
const maxBufferedBytes = Number.parseInt(process.env.WS_MAX_BUFFERED_BYTES || '1048576', 10);
const coalesceMs = Number.parseInt(process.env.WS_COALESCE_MS || '100', 10);
const redisChannel = process.env.WS_REDIS_CHANNEL || 'pacestats:run-updates';
const redisUrl = process.env.REDIS_URL;
if (!redisUrl && process.env.WS_ALLOW_LEGACY_WITHOUT_REDIS !== 'true') {
    throw new Error('REDIS_URL is required unless WS_ALLOW_LEGACY_WITHOUT_REDIS=true is explicitly set.');
}
const allowedOrigins = new Set(
    (process.env.WS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
);

const wss = new WebSocketServer({ port, maxPayload: 1024 });
const clientsByUuid = new Map();
const pendingBroadcasts = new CoalescedBroadcasts(broadcast, coalesceMs, {
    weightFor: uuid => clientsByUuid.get(uuid)?.size || 1,
});
const heartbeat = new HeartbeatWheel();
const snapshotDelivery = new SnapshotDelivery(send);
const snapshots = new SnapshotBroker({
    fetchSnapshot: createSnapshotFetcher({
        endpoint: process.env.WS_SNAPSHOT_ENDPOINT || 'http://127.0.0.1:5050/stats/api/obsSnapshot/',
        token: process.env.WS_TOKEN,
    }),
    send: (client, message) => snapshotDelivery.add(client, message),
    onError: (error) => console.error('Overlay snapshot unavailable:', error.message),
});
let subscriber = null;
let shuttingDown = false;

function isValidUuid(uuid) {
    return typeof uuid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(uuid);
}

function tokensMatch(actual, expected) {
    if (!actual || !expected) return false;
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function removePullClient(ws) {
    heartbeat.remove(ws);
    snapshots.remove(ws);
    snapshotDelivery.remove(ws);
    if (!ws.uuid) return;
    const clients = clientsByUuid.get(ws.uuid);
    if (!clients) return;
    clients.delete(ws);
    if (clients.size === 0) clientsByUuid.delete(ws.uuid);
    ws.uuid = undefined;
}

function send(client, message) {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > maxBufferedBytes) {
        client.terminate();
        return;
    }
    client.send(message, (error) => {
        if (error) client.terminate();
    });
}

function broadcast(uuid, message = 'refresh') {
    snapshots.notify(uuid, message);
    const clients = clientsByUuid.get(uuid);
    if (!clients) return;
    for (const client of clients) {
        send(client, message);
    }
}

function scheduleBroadcast(uuid, message = 'refresh') {
    pendingBroadcasts.add(uuid, message);
}

function parseRequestPath(requestUrl) {
    const url = new URL(requestUrl || '/', 'ws://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'ws2') parts.shift();
    return {
        action: parts[0],
        uuid: parts[1] ? decodeURIComponent(parts[1]) : '',
        token: parts[2] ? decodeURIComponent(parts[2]) : '',
        searchParams: url.searchParams,
    };
}

function watchPullClient(ws, label) {
    ws.isAlive = true;
    heartbeat.add(ws);
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => removePullClient(ws));
    ws.on('error', (error) => {
        console.error(`WebSocket client error for ${label}:`, error);
        removePullClient(ws);
    });
}

wss.on('connection', (ws, req) => {
    try {
        const { action, uuid, token, searchParams } = parseRequestPath(req.url);
        const requestOrigin = req.headers.origin || '';
        // Browser pull subscriptions must come from the configured site. Keep
        // originless, token-authenticated server-to-server push calls working
        // during the Redis Pub/Sub migration.
        if (allowedOrigins.size > 0
            && (action === 'pull' || action === 'overlay' || requestOrigin !== '')
            && !allowedOrigins.has(requestOrigin)) {
            ws.close(1008, 'Origin not allowed');
            return;
        }
        if (wss.clients.size > maxClients) {
            ws.close(1013, 'Server at capacity');
            return;
        }
        if (action === 'overlay') {
            if (uuid || token || (req.url?.length || 0) > 8192) {
                ws.close(1008, 'Invalid overlay subscription');
                return;
            }
            const subscription = parseSnapshotSubscription(searchParams);
            watchPullClient(ws, 'overlay');
            if (!snapshots.add(ws, subscription)) ws.close(1013, 'Too many overlay subscriptions');
            return;
        }
        if (!isValidUuid(uuid)) {
            ws.close(1008, 'Invalid UUID');
            return;
        }

        if (action === 'pull') {
            let clients = clientsByUuid.get(uuid);
            if (!clients) {
                clients = new Set();
                clientsByUuid.set(uuid, clients);
            }
            if (clients.size >= maxClientsPerUuid) {
                ws.close(1013, 'Too many subscriptions');
                return;
            }
            ws.uuid = uuid;
            clients.add(ws);
            watchPullClient(ws, uuid);
            return;
        }

        if (action === 'push') {
            if (!tokensMatch(token, process.env.WS_TOKEN)) {
                ws.close(1008, 'Invalid token');
                return;
            }
            scheduleBroadcast(uuid, 'refresh');
            ws.close(1000);
            return;
        }

        ws.close(1008, 'Invalid action');
    } catch (error) {
        console.error('Invalid WebSocket request:', error);
        ws.close(1008, 'Invalid request');
    }
});

if (redisUrl) {
    subscriber = new Redis(redisUrl, {
        connectTimeout: Number.parseInt(process.env.WS_REDIS_CONNECT_TIMEOUT_MS || '10000', 10),
        maxRetriesPerRequest: null,
    });
    subscriber.on('error', (error) => console.error('Redis subscriber error:', error));
    subscriber.on('message', (channel, rawMessage) => {
        if (channel !== redisChannel) return;
        try {
            const payload = JSON.parse(rawMessage);
            const uuid = payload?.uuid;
            const message = payload?.type || 'refresh';
            if (!isValidUuid(uuid) || (message !== 'refresh' && message !== 'reloadPage')) {
                throw new Error('Expected {uuid,type?:"refresh"|"reloadPage"}');
            }
            scheduleBroadcast(uuid, message);
        } catch (error) {
            console.error(`Ignoring invalid message on Redis channel '${redisChannel}':`, error);
        }
    });
    subscriber.subscribe(redisChannel)
        .then(() => console.log(`Subscribed to Redis channel '${redisChannel}'.`))
        .catch((error) => console.error(`Failed to subscribe to Redis channel '${redisChannel}':`, error));
}

wss.on('listening', () => console.log(`Pace Stats WebSocket server listening on port ${port}.`));
wss.on('error', (error) => console.error('WebSocket server error:', error));

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down WebSocket server.`);
    heartbeat.clear();
    pendingBroadcasts.clear();
    snapshots.clear();
    snapshotDelivery.clear();
    for (const clients of clientsByUuid.values()) {
        for (const ws of clients) ws.close(1001, 'Server shutting down');
    }
    clientsByUuid.clear();
    for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
    await new Promise((resolve) => wss.close(resolve));
    if (subscriber) {
        try {
            await subscriber.unsubscribe(redisChannel);
            await subscriber.quit();
        } catch {
            subscriber.disconnect();
        }
    }
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
