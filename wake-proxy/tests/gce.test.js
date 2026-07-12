import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GceController } from '../src/gce.js';

function makeClients({ status = 'TERMINATED', natIP = null, startCalls = [] } = {}) {
  const instances = {
    get: mock.fn(async () => [{
      status,
      name: 'main',
      networkInterfaces: [{
        accessConfigs: [{ natIP }],
      }],
    }]),
    start: mock.fn(async () => {
      startCalls.push('start');
      status = 'RUNNING';
      natIP = '203.0.113.10';
      return [{ name: 'op-start' }];
    }),
    stop: mock.fn(async () => {
      status = 'TERMINATED';
      natIP = null;
      return [{ name: 'op-stop' }];
    }),
  };
  const operations = {
    wait: mock.fn(async () => [{}]),
  };
  return { instances, operations, startCalls, getStatus: () => status, getIp: () => natIP };
}

describe('GceController', () => {
  it('ensureStarted starts a terminated VM', async () => {
    const clients = makeClients({ status: 'TERMINATED' });
    const gce = new GceController(
      { projectId: 'p', zone: 'z', instance: 'main' },
      clients
    );
    const result = await gce.ensureStarted(0);
    assert.equal(result.started, true);
    assert.equal(result.status, 'RUNNING');
    assert.equal(result.externalIp, '203.0.113.10');
    assert.equal(clients.instances.start.mock.callCount(), 1);
    assert.equal(clients.operations.wait.mock.callCount(), 1);
  });

  it('ensureStarted is a no-op when already running', async () => {
    const clients = makeClients({ status: 'RUNNING', natIP: '203.0.113.9' });
    const gce = new GceController(
      { projectId: 'p', zone: 'z', instance: 'main' },
      clients
    );
    const result = await gce.ensureStarted(0);
    assert.equal(result.started, false);
    assert.equal(result.externalIp, '203.0.113.9');
    assert.equal(clients.instances.start.mock.callCount(), 0);
  });

  it('respects start cooldown', async () => {
    const clients = makeClients({ status: 'TERMINATED' });
    const gce = new GceController(
      { projectId: 'p', zone: 'z', instance: 'main' },
      clients
    );
    gce._lastStartAttempt = Date.now();
    const result = await gce.ensureStarted(60_000);
    assert.equal(result.skipped, 'cooldown');
    assert.equal(clients.instances.start.mock.callCount(), 0);
  });

  it('ensureStopped stops a running VM', async () => {
    const clients = makeClients({ status: 'RUNNING', natIP: '203.0.113.9' });
    const gce = new GceController(
      { projectId: 'p', zone: 'z', instance: 'main' },
      clients
    );
    const result = await gce.ensureStopped();
    assert.equal(result.stopped, true);
    assert.equal(result.status, 'TERMINATED');
    assert.equal(clients.instances.stop.mock.callCount(), 1);
  });
});
