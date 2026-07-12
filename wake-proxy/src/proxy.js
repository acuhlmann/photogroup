/**
 * Reverse-proxy helpers for HTTP and WebSocket traffic to the VM origin.
 */
import httpProxy from 'http-proxy';
import https from 'node:https';
import http from 'node:http';

const httpsAgentCache = new Map();
const httpAgent = new http.Agent({ keepAlive: true });

function httpsAgentFor(servername) {
  const key = servername || '_';
  let agent = httpsAgentCache.get(key);
  if (!agent) {
    agent = new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      servername: servername || undefined,
    });
    httpsAgentCache.set(key, agent);
  }
  return agent;
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
