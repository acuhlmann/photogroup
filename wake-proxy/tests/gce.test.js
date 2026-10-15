import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GceController } from '../src/gce.js';

function makeController({ status = 'TERMINATED', natIP = null } = {}) {
  let vmStatus = status;
  let vmIp = natIP;
  const startCalls = [];

  const request = mock.fn(async ({ url, method }) => {
    if (url.endsWith('/instances/main') && method === 'GET') {
      return {
        data: {
          status: vmStatus,
          name: 'main',
          networkInterfaces: [{
            accessConfigs: [{ natIP: vmIp }],
          }],
        },
      };
    }
    if (url.endsWith('/instances/main/start') && method === 'POST') {
      startCalls.push('start');
      return { data: { name: 'op-start', status: 'DONE' } };
    }
    if (url.endsWith('/instances/main/stop') && method === 'POST') {
      vmStatus = 'TERMINATED';
      vmIp = null;
      return { data: { name: 'op-stop', status: 'DONE' } };
    }
    if (url.endsWith('/operations/op-start') && method === 'GET') {
      vmStatus = 'RUNNING';
      vmIp = '203.0.113.10';
      return { data: { status: 'DONE' } };
    }
    if (url.endsWith('/operations/op-stop') && method === 'GET') {
      return { data: { status: 'DONE' } };
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });

  const gce = new GceController(
    { projectId: 'p', zone: 'z', instance: 'main' },
    { request, sleep: async () => {} },
  );

  return { gce, startCalls, request };
}

describe('GceController', () => {
  it('ensureStarted starts a terminated VM', async () => {
    const { gce, startCalls } = makeController({ status: 'TERMINATED' });
    const result = await gce.ensureStarted(0);
    assert.equal(result.started, true);
    assert.equal(result.status, 'RUNNING');
    assert.equal(result.externalIp, '203.0.113.10');
    assert.equal(startCalls.length, 1);
  });

  it('ensureStarted is a no-op when already running', async () => {
    const { gce, startCalls } = makeController({ status: 'RUNNING', natIP: '203.0.113.9' });
    const result = await gce.ensureStarted(0);
    assert.equal(result.started, false);
    assert.equal(result.externalIp, '203.0.113.9');
    assert.equal(startCalls.length, 0);
  });

  it('respects start cooldown', async () => {
    const { gce, startCalls } = makeController({ status: 'TERMINATED' });
    gce._lastStartAttempt = Date.now();
    const result = await gce.ensureStarted(60_000);
    assert.equal(result.skipped, 'cooldown');
    assert.equal(startCalls.length, 0);
  });

  it('ensureStopped stops a running VM', async () => {
    const { gce } = makeController({ status: 'RUNNING', natIP: '203.0.113.9' });
    const result = await gce.ensureStopped();
    assert.equal(result.stopped, true);
    assert.equal(result.status, 'TERMINATED');
  });
});
