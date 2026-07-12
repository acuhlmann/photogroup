import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { renderStartingPage } from '../src/starting-page.js';
import { wantsHtml } from '../src/proxy.js';
import { waitForHealthy } from '../src/gce.js';

describe('loadConfig', () => {
  it('uses defaults', () => {
    const cfg = loadConfig({});
    assert.equal(cfg.projectId, 'photogroup-215600');
    assert.equal(cfg.zone, 'asia-east2-a');
    assert.equal(cfg.instance, 'main');
    assert.equal(cfg.originScheme, 'http');
    assert.equal(cfg.healthPath, '/api/__rtcConfig__');
  });

  it('reads overrides from env', () => {
    const cfg = loadConfig({
      GCP_PROJECT: 'demo',
      GCE_ZONE: 'us-west1-a',
      GCE_INSTANCE: 'box',
      PORT: '9090',
      READY_TIMEOUT_MS: '1000',
      WAKE_STOP_SECRET: 's3cret',
    });
    assert.equal(cfg.projectId, 'demo');
    assert.equal(cfg.zone, 'us-west1-a');
    assert.equal(cfg.instance, 'box');
    assert.equal(cfg.port, 9090);
    assert.equal(cfg.readyTimeoutMs, 1000);
    assert.equal(cfg.stopSecret, 's3cret');
  });
});

describe('renderStartingPage', () => {
  it('includes brand and escapes HTML', () => {
    const html = renderStartingPage({ brand: '<Hack>', statusText: 'x', idleMinutes: 45 });
    assert.match(html, /&lt;Hack&gt;/);
    assert.doesNotMatch(html, /<Hack>/);
    assert.match(html, /45 minutes/);
    assert.match(html, /__wake__\/status/);
  });
});

describe('wantsHtml', () => {
  it('detects document navigations', () => {
    assert.equal(wantsHtml({ headers: { 'sec-fetch-dest': 'document', accept: '' }, url: '/' }), true);
    assert.equal(wantsHtml({ headers: { accept: 'text/html' }, url: '/' }), true);
    assert.equal(wantsHtml({ headers: { accept: 'application/json' }, url: '/api/rooms/' }), false);
    assert.equal(wantsHtml({ headers: { accept: '*/*' }, url: '/api/__rtcConfig__' }), false);
    assert.equal(wantsHtml({ headers: { accept: '*/*' }, url: '/' }), true);
  });
});

describe('waitForHealthy', () => {
  it('returns healthy when fetch succeeds', async () => {
    const result = await waitForHealthy({
      scheme: 'https',
      ip: '1.2.3.4',
      host: 'example.com',
      path: '/health',
      timeoutMs: 1000,
      pollMs: 10,
      fetchImpl: async () => ({ ok: true }),
    });
    assert.equal(result.healthy, true);
  });

  it('times out when unhealthy', async () => {
    const result = await waitForHealthy({
      scheme: 'https',
      ip: '1.2.3.4',
      host: 'example.com',
      path: '/health',
      timeoutMs: 50,
      pollMs: 10,
      fetchImpl: async () => ({ ok: false, status: 502 }),
    });
    assert.equal(result.healthy, false);
  });
});
