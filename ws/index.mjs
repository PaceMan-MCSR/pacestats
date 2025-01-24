import { WebSocketServer } from 'ws';
import 'dotenv/config'

const wss = new WebSocketServer({ port: 8080 });

function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', function connection(ws, req) {
    const url = req.url.replace('/ws2', '')
    const action = url.split('/')[1]
    const uuid = url.split('/')[2]
    if(action === 'pull') {
        ws.uuid = uuid
        console.log('Connected:', uuid)
        ws.isAlive = true;
        ws.on('pong', heartbeat);
        ws.on('error', console.error);
    } else if(action === 'push') {
        const token = url.split('/')[3]
        if (token !== process.env.WS_TOKEN) {
            console.log('Invalid token')
            ws.terminate()
            return
        }
        console.log("Pushing refresh to:", uuid)
        wss.clients.forEach(function each(client) {
            if(client.uuid === undefined) return
            if (client.uuid === uuid && client.readyState === 1) {
                console.log('Sending refresh to:', uuid)
                client.send("refresh");
            }
        });
        ws.terminate()
    } else {
        console.log('Invalid action')
        ws.terminate()
    }
});

const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', function close() {
    clearInterval(interval);
});