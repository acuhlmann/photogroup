/**
 * PhotoGroup wake proxy — Cloud Run ingress that starts the GCE VM on demand
 * and reverse-proxies HTTP/WebSocket traffic to nginx on the VM.
 */
import http from 'node:http';
import { loadConfig } from './config.js';
import { GceController, waitForOriginReady } from './gce.js';
import { createOriginProxy, proxyHttp, proxyWs, wantsHtml } from './proxy.js';
import { renderStartingPage } from './starting-page.js';
import { ActivityStore } from './activity.js';

const config = loadConfig();
const gce = new GceController(config);
const proxy = createOriginProxy();
const activity = new ActivityStore({ gce });

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

function brandForHost(host = '') {
  if (host.startsWith('hackernews.')) return 'Hackersbot';
  return 'PhotoGroup';
}

function touchActivity() {
  activity.touch().catch(() => {});
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
      touchActivity();
      return { scheme: config.originScheme, ip: ready.ip };
    } finally {
      ensureReadyPromise = null;
    }
  })();

  return ensureReadyPromise;
}

async function handleWakeStatus(_req, res) {
  if (wakeState.ready && wakeState.externalIp) {
    const probeHost = 'photogroup.network';
    try {
      const { probeOriginHttp, probeOriginHttps } = await import('./gce.js');
      const probeFn = config.originScheme === 'https' ? probeOriginHttps : probeOriginHttp;
      const probe = await probeFn({
        ip: wakeState.externalIp,
        host: probeHost,
        path: config.healthPath,
      });
      if (!probe.ok) {
        setState({ ready: false, phase: 'waiting_health', message: 'Origin lost health' });
      }
    } catch {
      // ignore probe errors in status
    }
  }

  const lastActivityMs = await activity.getLastActivityMs();
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({
    ...wakeState,
    projectId: config.projectId,
    zone: config.zone,
    instance: config.instance,
    idleMinutesHint: config.idleMinutes,
    lastActivityMs,
    lastActivityIso: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
  }));
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

/**
 * Public idle-stop: stops the VM only if it has been idle longer than IDLE_MINUTES.
 * Safe to expose — worst case an attacker stops an already-idle VM.
 */
async function handleStopIfIdle(_req, res) {
  try {
    const status = await gce.getStatus();
    if (status.status === 'TERMINATED' || status.status === 'STOPPED') {
      setState({ phase: 'idle', ready: false, message: 'Already stopped', externalIp: null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ action: 'none', reason: 'already_stopped', status }));
      return;
    }

    const lastActivityMs = await activity.getLastActivityMs();
    const idleMs = Date.now() - (lastActivityMs || 0);
    const thresholdMs = config.idleMinutes * 60_000;

    if (!lastActivityMs) {
      // No activity recorded yet — do not stop a freshly started VM blindly.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        action: 'none',
        reason: 'no_activity_recorded',
        status,
      }));
      return;
    }

    if (idleMs < thresholdMs) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        action: 'none',
        reason: 'still_active',
        idleMinutes: Math.round(idleMs / 60_000),
        thresholdMinutes: config.idleMinutes,
        lastActivityIso: new Date(lastActivityMs).toISOString(),
        status,
      }));
      return;
    }

    const result = await gce.ensureStopped();
    setState({
      phase: 'idle',
      ready: false,
      message: 'Stopped (idle)',
      externalIp: null,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      action: 'stopped',
      reason: 'idle',
      idleMinutes: Math.round(idleMs / 60_000),
      thresholdMinutes: config.idleMinutes,
      result,
    }));
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
  if (path === '/__wake__/stop-if-idle' && (req.method === 'POST' || req.method === 'GET')) {
    return handleStopIfIdle(req, res);
  }
  // Cloud Run / LB health checks — do not start the VM or count as activity
  if (path === '/__wake__/healthz' || path === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(path === '/robots.txt' ? 'User-agent: *\nDisallow: /\n' : 'ok');
    return;
  }

  // Real user traffic — refresh idle timer
  touchActivity();

  // Fast path: already ready
  if (wakeState.ready && wakeState.externalIp) {
    return proxyHttp(proxy, req, res, {
      scheme: config.originScheme,
      ip: wakeState.externalIp,
    });
  }

  // Browser navigations get the starting page immediately while boot continues
  if (wantsHtml(req)) {
    ensureReady(host).catch((err) => {
      console.error('[wake-proxy] ensureReady failed:', err.message);
    });
    const html = renderStartingPage({
      brand: brandForHost(host),
      statusText: 'Starting the server…',
      idleMinutes: config.idleMinutes,
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
  touchActivity();

  const go = async () => {
    try {
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
  console.log(`[wake-proxy] idle stop after ${config.idleMinutes}m via /__wake__/stop-if-idle`);
});
