/**
 * PhotoGroup wake proxy — Cloud Run ingress that starts the GCE VM on demand
 * and reverse-proxies HTTP/WebSocket traffic to nginx on the VM.
 */
import http from 'node:http';
import { loadConfig } from './config.js';
import { GceController, waitForOriginReady } from './gce.js';
import { createOriginProxy, proxyHttp, proxyWs, wantsHtml } from './proxy.js';
import { renderStartingPage } from './starting-page.js';
import { evaluateRequest } from './bot-filter.js';

const config = loadConfig();
const gce = new GceController(config);
const proxy = createOriginProxy();

/** @type {{ phase: string, ready: boolean, message: string, externalIp: string|null, updatedAt: number }} */
let wakeState = {
  phase: 'idle',
  ready: false,
  message: 'Idle',
  externalIp: null,
  updatedAt: Date.now(),
};

/** In-flight ensure-ready promise so concurrent requests share one boot. */
let ensureReadyPromise = null;

function setState(patch) {
  wakeState = { ...wakeState, ...patch, updatedAt: Date.now() };
}

/** Drop cached origin when the VM stopped or got a new ephemeral IP. */
async function reconcileOriginState() {
  if (!wakeState.ready && !wakeState.externalIp) return;

  try {
    const vm = await gce.getStatus();
    if (vm.status !== 'RUNNING') {
      setState({
        phase: 'idle',
        ready: false,
        message: 'VM stopped',
        externalIp: null,
      });
      return;
    }
    if (wakeState.externalIp && vm.externalIp !== wakeState.externalIp) {
      setState({
        phase: 'waiting_health',
        ready: false,
        message: 'Origin IP changed',
        externalIp: vm.externalIp,
      });
    }
  } catch (err) {
    console.error('[wake-proxy] reconcileOriginState:', err.message);
  }
}

function brandForHost(host = '') {
  if (host.startsWith('hackernews.')) return 'Hackersbot';
  return 'PhotoGroup';
}

/**
 * Ensure VM is running and origin is healthy. Returns origin target or throws.
 */
async function ensureReady(host) {
  if (ensureReadyPromise) return ensureReadyPromise;

  ensureReadyPromise = (async () => {
    try {
      setState({ phase: 'starting', ready: false, message: 'Starting VM…' });
      const started = await gce.ensureStarted(config.startCooldownMs);
      setState({
        phase: 'booting',
        ready: false,
        message: `VM ${started.status}`,
        externalIp: started.externalIp,
      });

      setState({ phase: 'waiting_health', message: 'Waiting for app health…' });
      const ready = await waitForOriginReady({
        ip: started.externalIp,
        host: host.split(':')[0],
        path: config.healthPath,
        timeoutMs: config.readyTimeoutMs,
        pollMs: config.healthPollMs,
        scheme: config.originScheme,
        getIp: async () => {
          const s = await gce.getStatus();
          if (s.externalIp) setState({ externalIp: s.externalIp });
          return s.externalIp;
        },
      });

      if (!ready.healthy || !ready.ip) {
        setState({
          phase: 'error',
          ready: false,
          message: ready.error || 'Origin not healthy',
        });
        throw new Error(ready.error || 'Origin not healthy');
      }

      setState({
        phase: 'ready',
        ready: true,
        message: 'Ready',
        externalIp: ready.ip,
      });
      return { scheme: config.originScheme, ip: ready.ip };
    } finally {
      // Allow a later retry after failure; keep success cached via wakeState.ready
      ensureReadyPromise = null;
    }
  })();

  return ensureReadyPromise;
}

async function handleWakeStatus(_req, res) {
  // GCE API only — do not HTTP-probe nginx here (that resets idle-stop).
  await reconcileOriginState();

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({
    ...wakeState,
    projectId: config.projectId,
    zone: config.zone,
    instance: config.instance,
    idleMinutesHint: config.idleMinutesHint,
  }));
}

/** Reject junk without waking the VM or touching nginx. */
function rejectBot(res, reason) {
  console.log(`[wake-proxy] blocked (${reason})`);
  res.writeHead(404, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-store',
  });
  res.end('Not found');
}

async function handleWakeStop(req, res) {
  if (!config.stopSecret) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'stop endpoint disabled' }));
    return;
  }
  const provided = req.headers['x-wake-stop-secret'] || '';
  if (provided !== config.stopSecret) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  try {
    const result = await gce.ensureStopped();
    setState({
      phase: 'idle',
      ready: false,
      message: 'Stopped',
      externalIp: null,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleRequest(req, res) {
  const url = req.url || '/';
  const path = url.split('?')[0];
  const host = req.headers.host || 'photogroup.network';

  if (path === '/__wake__/status') {
    return handleWakeStatus(req, res);
  }
  if (path === '/__wake__/stop' && req.method === 'POST') {
    return handleWakeStop(req, res);
  }
  // Cloud Run / LB health checks — do not start the VM
  if (path === '/__wake__/healthz' || path === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(path === '/robots.txt' ? 'User-agent: *\nDisallow: /\n' : 'ok');
    return;
  }

  // Never wake or proxy scanner traffic (also when VM is already warm).
  const verdict = evaluateRequest(req);
  if (!verdict.allow) {
    return rejectBot(res, verdict.reason);
  }

  await reconcileOriginState();

  // Fast path: already ready
  if (wakeState.ready && wakeState.externalIp) {
    return proxyHttp(proxy, req, res, {
      scheme: config.originScheme,
      ip: wakeState.externalIp,
    });
  }

  // Browser navigations get the starting page immediately while boot continues
  if (wantsHtml(req)) {
    // Kick off boot without awaiting
    ensureReady(host).catch((err) => {
      console.error('[wake-proxy] ensureReady failed:', err.message);
    });
    const html = renderStartingPage({
      brand: brandForHost(host),
      statusText: 'Starting the server…',
      idleMinutes: config.idleMinutesHint,
    });
    res.writeHead(503, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '15',
    });
    res.end(html);
    return;
  }

  // API / non-HTML: wait for ready then proxy (or 503)
  try {
    const target = await ensureReady(host);
    return proxyHttp(proxy, req, res, target);
  } catch (err) {
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Retry-After': '30',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({
      error: 'origin_starting',
      message: err.message,
      phase: wakeState.phase,
    }));
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[wake-proxy] unhandled:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error');
    }
  });
});

server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host || 'photogroup.network';

  const go = async () => {
    try {
      const verdict = evaluateRequest(req);
      if (!verdict.allow) {
        console.log(`[wake-proxy] blocked ws (${verdict.reason})`);
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      await reconcileOriginState();
      let target;
      if (wakeState.ready && wakeState.externalIp) {
        target = { scheme: config.originScheme, ip: wakeState.externalIp };
      } else {
        target = await ensureReady(host);
      }
      proxyWs(proxy, req, socket, head, target);
    } catch (err) {
      console.error('[wake-proxy] ws upgrade failed:', err.message);
      socket.destroy();
    }
  };
  go();
});

server.listen(config.port, () => {
  console.log(`[wake-proxy] listening on :${config.port}`);
  console.log(`[wake-proxy] target VM ${config.projectId}/${config.zone}/${config.instance}`);
});
