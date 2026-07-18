import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { renderStartingPage } from '../src/starting-page.js';
import { wantsHtml } from '../src/proxy.js';
import { waitForHealthy } from '../src/gce.js';
import {
  evaluateRequest,
  isProbePath,
  isScannerUserAgent,
  looksLikeBrowser,
} from '../src/bot-filter.js';

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

describe('bot-filter', () => {
  const chrome =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  it('flags common probe paths', () => {
    assert.equal(isProbePath('/wp-admin/'), true);
    assert.equal(isProbePath('/.env'), true);
    assert.equal(isProbePath('/xmlrpc.php'), true);
    assert.equal(isProbePath('/index.php'), true);
    assert.equal(isProbePath('/'), false);
    assert.equal(isProbePath('/api/rooms/abc'), false);
    assert.equal(isProbePath('/ws'), false);
    assert.equal(isProbePath('/static/js/main.js'), false);
  });

  it('allows browsers and blocks scanners / empty UA', () => {
    assert.equal(looksLikeBrowser(chrome), true);
    assert.equal(isScannerUserAgent(chrome), false);
    assert.equal(isScannerUserAgent('curl/8.0.0'), true);
    assert.equal(isScannerUserAgent('python-requests/2.31.0'), true);
    assert.equal(isScannerUserAgent(''), true);
    assert.equal(
      isScannerUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'),
      true,
    );
  });

  it('evaluateRequest combines path and UA', () => {
    assert.equal(evaluateRequest({ url: '/', headers: { 'user-agent': chrome } }).allow, true);
    assert.equal(evaluateRequest({ url: '/wp-login.php', headers: { 'user-agent': chrome } }).allow, false);
    assert.equal(evaluateRequest({ url: '/', headers: { 'user-agent': 'curl/8.0' } }).allow, false);
    assert.equal(evaluateRequest({ url: '/api/__rtcConfig__', headers: { 'user-agent': chrome } }).allow, true);
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
