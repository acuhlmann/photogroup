/**
 * Block scanner / bot traffic at the wake proxy so it never starts the VM
 * or touches nginx (which would reset idle-stop).
 *
 * Policy: allow only browser-like clients on app paths. Probe URLs are always
 * rejected. Non-browser UAs (curl, scanners, empty) never wake or proxy.
 */

/** Exact path prefixes that are almost never used by PhotoGroup clients. */
const PROBE_PREFIXES = [
  '/wp-',
  '/wordpress',
  '/xmlrpc.php',
  '/phpmyadmin',
  '/.env',
  '/.git',
  '/.svn',
  '/.aws',
  '/.well-known/security.txt',
  '/cgi-bin',
  '/vendor/',
  '/admin',
  '/administrator',
  '/manager',
  '/solr',
  '/actuator',
  '/console',
  '/debug',
  '/server-status',
  '/server-info',
  '/telescope',
  '/_ignition',
  '/laravel',
  '/api/v1',
  '/api/v2',
  '/graphql',
  '/swagger',
  '/v2/_catalog',
];

/** File extensions scanners probe for; PhotoGroup serves SPA + /api + /ws. */
const PROBE_EXT =
  /\.(php|asp|aspx|jsp|cgi|cfm|py|rb|pl|exe|dll|bat|sh|sql|bak|old|orig|swp|dist)$/i;

/** Crawlers that often include "Mozilla" but must not keep the VM awake. */
const CRAWLER_UA =
  /\b(googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|facebookexternalhit|twitterbot|linkedinbot|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|ccbot|dataforseo|screaming frog)\b/i;

/** Real browser clients (PhotoGroup SPA / WebTorrent in-browser). */
const BROWSER_UA =
  /\b(Chrome\/|CriOS\/|Firefox\/|FxiOS\/|Edg\/|OPR\/|SamsungBrowser\/|Version\/[\d.]+.*Safari\/)/i;

/**
 * Normalize path for matching (lowercase, strip query, collapse //).
 * @param {string} rawPath
 * @returns {string}
 */
export function normalizePath(rawPath = '/') {
  let path = rawPath.split('?')[0] || '/';
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep raw
  }
  path = path.replace(/\/+/g, '/');
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path.toLowerCase() || '/';
}

/**
 * @param {string} path normalized or raw path
 * @returns {boolean}
 */
export function isProbePath(path) {
  const p = normalizePath(path);
  if (p === '/' || p.startsWith('/api/') || p.startsWith('/__wake__/') || p === '/ws' || p.startsWith('/ws/')) {
    return false;
  }
  if (p.startsWith('/static/') || p.startsWith('/assets/') || p === '/favicon.ico' || p === '/manifest.json') {
    return false;
  }
  if (PROBE_EXT.test(p)) return true;
  for (const prefix of PROBE_PREFIXES) {
    if (p === prefix || p.startsWith(prefix)) return true;
  }
  if (/^\/(wp-login|wp-config|xmlrpc|phpinfo|info|test|shell|cmd|eval|config|credentials|secrets)(\.|$)/i.test(p)) {
    return true;
  }
  return false;
}

/**
 * @param {string|undefined} userAgent
 * @returns {boolean}
 */
export function looksLikeBrowser(userAgent = '') {
  const ua = userAgent.trim();
  if (!ua) return false;
  if (CRAWLER_UA.test(ua)) return false;
  return BROWSER_UA.test(ua);
}

/**
 * Non-browser / crawler UAs that must not wake or touch nginx.
 * @param {string|undefined} userAgent
 * @returns {boolean}
 */
export function isScannerUserAgent(userAgent = '') {
  return !looksLikeBrowser(userAgent);
}

/**
 * Decide whether this request may wake the VM or be proxied to nginx.
 * @param {{ url?: string, headers?: Record<string, string|string[]|undefined> }} req
 * @returns {{ allow: boolean, reason: string }}
 */
export function evaluateRequest(req) {
  const path = normalizePath(req.url || '/');
  const uaHeader = req.headers?.['user-agent'];
  const ua = Array.isArray(uaHeader) ? uaHeader[0] : (uaHeader || '');

  if (isProbePath(path)) {
    return { allow: false, reason: 'probe_path' };
  }
  if (isScannerUserAgent(ua)) {
    return { allow: false, reason: 'scanner_ua' };
  }
  return { allow: true, reason: 'ok' };
}
