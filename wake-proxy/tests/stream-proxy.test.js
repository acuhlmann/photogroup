/**
 * A long response (the room's update stream) whose origin goes away midway:
 * a deploy or a VM stop kills the app without ending the stream. http-proxy
 * only pipes the origin's body, so without help the browser kept a stream
 * that would never say anything again, and never knew to join the room once
 * more. The server had forgotten its session, and every change it then
 * asked for came back 403 ("Could not change the name", 2026-11-19).
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createOriginProxy, proxyHttp } from '../src/proxy.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

describe('proxyHttp stream', () => {
  const servers = [];
  after(() => servers.forEach((s) => { s.closeAllConnections(); s.close(); }));

  it('closes the browser side when the origin drops a stream midway', async () => {
    let originSocket;
    const origin = http.createServer((req, res) => {
      originSocket = req.socket;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(':ok\n\n');
    });
    servers.push(origin);
    const originPort = await listen(origin);

    const proxy = createOriginProxy();
    const front = http.createServer((req, res) => {
      proxyHttp(proxy, req, res, { scheme: 'http', ip: `127.0.0.1:${originPort}` });
    });
    servers.push(front);
    const frontPort = await listen(front);

    const response = await new Promise((resolve, reject) => {
      http.get({ port: frontPort, host: '127.0.0.1', path: '/api/rooms/x/updates/', agent: false }, resolve)
        .on('error', reject);
    });
    assert.equal(response.statusCode, 200);
    response.on('error', () => {});
    await once(response, 'data');

    const ended = Promise.race([
      new Promise((resolve) => response.on('close', () => resolve('closed'))),
      new Promise((resolve) => setTimeout(() => resolve('still open'), 2000)),
    ]);
    originSocket.destroy();
    assert.equal(await ended, 'closed');
  });
});
