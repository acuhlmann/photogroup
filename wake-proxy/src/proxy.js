/**
 * Reverse-proxy helpers for HTTP and WebSocket traffic to the VM origin.
 */
import httpProxy from 'http-proxy';
import https from 'node:https';
import http from 'node:http';

/** Outbound sockets to nginx must not linger for an hour when clients drop. */
const ORIGIN_AGENT_OPTS = {
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxFreeSockets: 4,
  maxSockets: 64,
  timeout: 120_000,
};

const httpsAgentCache = new Map();
const httpAgent = new http.Agent(ORIGIN_AGENT_OPTS);

function httpsAgentFor(servername) {
  const key = servername || '_';
  let agent = httpsAgentCache.get(key);
  if (!agent) {
    agent = new https.Agent({
      rejectUnauthorized: false,
      servername: servername || undefined,
      ...ORIGIN_AGENT_OPTS,
    });
    httpsAgentCache.set(key, agent);
  }
  return agent;
}

/**
 * Close the origin leg when the browser or Cloud Run gives up on the client
 * side, so nginx does not accumulate hundreds of idle :80 connections.
 * @param {import('http-proxy').Server} proxy
 */
export function wireOriginTeardown(proxy) {
  proxy.on('proxyReq', (proxyReq, req, res) => {
    const destroyUpstream = () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    };
    req.on('aborted', destroyUpstream);
    res.on('close', () => {
      if (!res.writableFinished) destroyUpstream();
    });
  });

  proxy.on('open', (proxySocket, _req, socket) => {
    const destroyBoth = () => {
      try {
        if (!proxySocket.destroyed) proxySocket.destroy();
      } catch {
        // ignore
      }
      try {
        if (!socket.destroyed) socket.destroy();
      } catch {
        // ignore
      }
    };
    socket.on('close', destroyBoth);
    proxySocket.on('close', () => {
      try {
        if (!socket.destroyed) socket.destroy();
      } catch {
        // ignore
      }
    });
  });
}

/**
 * Create an http-proxy instance for VM origins.
 */
export function createOriginProxy() {
  const proxy = httpProxy.createProxyServer({
    ws: true,
    xfwd: true,
    changeOrigin: false,
  });

  wireOriginTeardown(proxy);

  proxy.on('error', (err, _req, res) => {
    console.error('[wake-proxy] proxy error:', err.message);
    if (res && !res.headersSent && typeof res.writeHead === 'function') {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Origin unavailable');
    } else if (res && typeof res.end === 'function') {
      try {
        res.end();
      } catch {
        // ignore
      }
    } else if (res && typeof res.destroy === 'function') {
      res.destroy();
    }
  });

  return proxy;
}

function originHost(req) {
  return (req.headers.host || 'photogroup.network').split(':')[0];
}

function proxyHeaders(req) {
  return {
    Host: originHost(req),
    'X-Wake-Proxy': '1',
  };
}

/**
 * @param {import('http-proxy')} proxy
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ scheme: string, ip: string }} target
 */
export function proxyHttp(proxy, req, res, target) {
  const host = originHost(req);
  const isHttps = target.scheme === 'https';
  proxy.web(req, res, {
    target: `${target.scheme}://${target.ip}`,
    secure: false,
    agent: isHttps ? httpsAgentFor(host) : httpAgent,
    headers: proxyHeaders(req),
  });
}

/**
 * @param {import('http-proxy')} proxy
 * @param {import('http').IncomingMessage} req
 * @param {import('stream').Duplex} socket
 * @param {Buffer} head
 * @param {{ scheme: string, ip: string }} target
 */
export function proxyWs(proxy, req, socket, head, target) {
  const host = originHost(req);
  const isHttps = target.scheme === 'https';
  proxy.ws(req, socket, head, {
    target: `${target.scheme}://${target.ip}`,
    secure: false,
    agent: isHttps ? httpsAgentFor(host) : httpAgent,
    headers: proxyHeaders(req),
  });
}

/**
 * Whether this request should get an HTML starting page instead of a JSON/API error.
 */
export function wantsHtml(req) {
  const accept = req.headers.accept || '';
  const dest = req.headers['sec-fetch-dest'] || '';
  if (dest === 'document') return true;
  if (accept.includes('text/html')) return true;
  if (!accept || accept === '*/*') {
    const path = req.url?.split('?')[0] || '/';
    if (!path.startsWith('/api/') && !path.startsWith('/__wake__/') && !path.startsWith('/ws')) {
      return true;
    }
  }
  return false;
}
