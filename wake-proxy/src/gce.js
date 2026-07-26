/**
 * Compute Engine start / stop / status via the REST API.
 * Uses JSON responses directly — avoids @google-cloud/compute proto deserialization bugs.
 */
import { GoogleAuth } from 'google-auth-library';

const COMPUTE_SCOPE = 'https://www.googleapis.com/auth/compute';

export class GceController {
  /**
   * @param {{ projectId: string, zone: string, instance: string }} opts
   * @param {{ request?: (options: object) => Promise<{ data: object }>, sleep?: (ms: number) => Promise<void> }} [deps]
   */
  constructor(opts, deps = {}) {
    this.projectId = opts.projectId;
    this.zone = opts.zone;
    this.instance = opts.instance;
    this._auth = deps.auth || new GoogleAuth({ scopes: [COMPUTE_SCOPE] });
    this._request = deps.request || this._defaultRequest.bind(this);
    this._sleep = deps.sleep || sleep;
    this._lastStartAttempt = 0;
  }

  _zoneBase() {
    return `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${this.zone}`;
  }

  async _defaultRequest(options) {
    const client = await this._auth.getClient();
    return client.request(options);
  }

  async getInstance() {
    const { data } = await this._request({
      url: `${this._zoneBase()}/instances/${this.instance}`,
      method: 'GET',
    });
    return data;
  }

  /**
   * @returns {Promise<{ status: string, externalIp: string|null, name: string }>}
   */
  async getStatus() {
    const vm = await this.getInstance();
    const status = vm.status || 'UNKNOWN';
    const nic = vm.networkInterfaces?.[0];
    const access = nic?.accessConfigs?.[0];
    const externalIp = access?.natIP || null;
    return {
      status,
      externalIp,
      name: vm.name || this.instance,
    };
  }

  async _waitOperation(operationName) {
    const url = `${this._zoneBase()}/operations/${operationName}`;
    while (true) {
      const { data: op } = await this._request({ url, method: 'GET' });
      if (op.status === 'DONE') {
        if (op.error?.errors?.length) {
          const msg = op.error.errors.map((e) => e.message).join('; ');
          throw new Error(msg || 'operation failed');
        }
        return op;
      }
      await this._sleep(2_000);
    }
  }

  /**
   * Start the VM if it is not already running / provisioning.
   * @param {number} cooldownMs
   */
  async ensureStarted(cooldownMs = 30_000) {
    const current = await this.getStatus();
    if (current.status === 'RUNNING') {
      return { started: false, ...current };
    }
    if (current.status === 'STAGING' || current.status === 'PROVISIONING') {
      return { started: false, ...current };
    }

    const now = Date.now();
    if (now - this._lastStartAttempt < cooldownMs) {
      return {
        started: false,
        skipped: 'cooldown',
        ...current,
      };
    }
    this._lastStartAttempt = now;

    const { data: operation } = await this._request({
      url: `${this._zoneBase()}/instances/${this.instance}/start`,
      method: 'POST',
    });

    if (operation?.name) {
      await this._waitOperation(operation.name);
    }

    const after = await this.getStatus();
    return { started: true, ...after };
  }

  /**
   * Stop the VM if it is running.
   */
  async ensureStopped() {
    const current = await this.getStatus();
    if (current.status === 'TERMINATED' || current.status === 'STOPPED') {
      return { stopped: false, ...current };
    }

    const { data: operation } = await this._request({
      url: `${this._zoneBase()}/instances/${this.instance}/stop`,
      method: 'POST',
    });

    if (operation?.name) {
      await this._waitOperation(operation.name);
    }

    const after = await this.getStatus();
    return { stopped: true, ...after };
  }
}

/**
 * Poll until the origin health endpoint returns 200, or timeout.
 * @param {{ scheme: string, ip: string, host: string, path: string, timeoutMs: number, pollMs: number, fetchImpl?: typeof fetch }} opts
 */
export async function waitForHealthy(opts) {
  const {
    scheme,
    ip,
    host,
    path,
    timeoutMs,
    pollMs,
    fetchImpl = fetch,
  } = opts;

  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (!ip) {
      lastError = new Error('no external IP yet');
      await sleep(pollMs);
      continue;
    }

    try {
      const url = `${scheme}://${ip}${path}`;
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: { Host: host, Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        return { healthy: true };
      }
      lastError = new Error(`health status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(pollMs);
  }

  return {
    healthy: false,
    error: lastError?.message || 'timeout',
  };
}

/**
 * HTTPS health probe that tolerates certificate hostname mismatch (IP target).
 */
export async function probeOriginHttps({ ip, host, path, timeoutMs = 5_000 }) {
  const https = await import('node:https');
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: ip,
        port: 443,
        path,
        method: 'GET',
        headers: { Host: host, Accept: 'application/json', 'X-Wake-Proxy': '1' },
        rejectUnauthorized: false,
        servername: host,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end();
  });
}

/**
 * HTTP health probe for wake-proxy → nginx :80 (preferred when DNS is on Cloud Run).
 */
export async function probeOriginHttp({ ip, host, path, timeoutMs = 5_000 }) {
  const http = await import('node:http');
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: ip,
        port: 80,
        path,
        method: 'GET',
        headers: { Host: host, Accept: 'application/json', 'X-Wake-Proxy': '1' },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end();
  });
}

/**
 * Wait until origin is healthy (HTTP or HTTPS to ephemeral IP).
 */
export async function waitForOriginReady(opts) {
  const { ip, host, path, timeoutMs, pollMs, getIp, scheme = 'http' } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastError = 'waiting';
  let currentIp = ip;
  const probe = scheme === 'https' ? probeOriginHttps : probeOriginHttp;

  while (Date.now() < deadline) {
    if (typeof getIp === 'function') {
      currentIp = await getIp();
    }
    if (!currentIp) {
      lastError = 'no external IP yet';
      await sleep(pollMs);
      continue;
    }
    const result = await probe({ ip: currentIp, host, path });
    if (result.ok) {
      return { healthy: true, ip: currentIp };
    }
    lastError = result.error || `status ${result.status}`;
    await sleep(pollMs);
  }

  return { healthy: false, error: lastError, ip: currentIp };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
