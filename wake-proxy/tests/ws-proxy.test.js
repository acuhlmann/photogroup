/**
 * A real WebSocket upgrade through createOriginProxy/proxyWs, against a local
 * origin. Regression test for the Cloud Run crash of 2026-11-01: http-proxy
 * emits 'open' with only the origin socket, and a handler that assumed a
 * client socket threw inside a socket data callback, which exits the process.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createOriginProxy, proxyWs } from '../src/proxy.js';

const UPGRADE_REQUEST = [
  'GET /ws HTTP/1.1',
  'Host: photogroup.network',
  'Connection: Upgrade',
  'Upgrade: websocket',
  'Sec-WebSocket-Version: 13',
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
  '',
  '',
].join('\r\n');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function readUntil(socket, text) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes(text)) {
        socket.off('data', onData);
        resolve(buf);
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

describe('proxyWs', () => {
  const servers = [];
  after(() => servers.forEach((s) => { s.closeAllConnections(); s.close(); }));

  it('relays an upgrade and closes the origin leg when the client leaves', async () => {
    const uncaught = [];
    const onUncaught = (err) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);

    let originSocket;
    const originClosed = new Promise((resolve) => {
      const origin = http.createServer();
      origin.on('upgrade', (_req, socket) => {
        originSocket = socket;
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        socket.on('data', (d) => socket.write(d));
        socket.on('end', () => socket.end()); // as nginx does; http.Server sockets are half-open
        socket.on('close', resolve);
      });
      servers.push(origin);
    });
    const originPort = await listen(servers[0]);

    const proxy = createOriginProxy();
    const front = http.createServer();
    front.on('upgrade', (req, socket, head) => {
      proxyWs(proxy, req, socket, head, { scheme: 'http', ip: `127.0.0.1:${originPort}` });
    });
    servers.push(front);
    const frontPort = await listen(front);

    const client = net.connect(frontPort, '127.0.0.1');
    await once(client, 'connect');
    client.write(UPGRADE_REQUEST);
    const head = await readUntil(client, '\r\n\r\n');
    assert.match(head, /^HTTP\/1\.1 101/);

    client.write('ping');
    await readUntil(client, 'ping');

    client.destroy();
    await Promise.race([
      originClosed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('origin leg left open')), 2000)),
    ]);
    assert.equal(originSocket.destroyed, true);

    process.off('uncaughtException', onUncaught);
    assert.deepEqual(uncaught.map((e) => e.message), []);
  });
});
