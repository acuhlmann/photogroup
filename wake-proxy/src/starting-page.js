/**
 * Cold-start HTML shown while the GCE VM is booting.
 * Renders a live boot console: the wake pipeline stage by stage, every
 * /__wake__/status poll with its round-trip time, and what the browser can
 * measure about its own connection. Respects prefers-reduced-motion.
 */
export function renderStartingPage({ brand = 'PhotoGroup', statusText = 'Starting the server…', idleMinutes = 60 } = {}) {
  const safeBrand = escapeHtml(brand);
  const safeStatus = escapeHtml(statusText);
  const safeIdle = escapeHtml(idleMinutes);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${safeBrand} — Starting</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg0: #0b1c1a;
      --bg1: #14322d;
      --ink: #f2f7f4;
      --muted: #a8c0b8;
      --faint: #6f8a82;
      --accent: #3dd6c3;
      --accent-dim: #1f8f84;
      --warn: #f2c14e;
      --err: #ff7a6b;
      --panel: rgba(4, 16, 14, 0.55);
      --line: rgba(61, 214, 195, 0.18);
      --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      font-family: "IBM Plex Sans", system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 10% -10%, #1d4d45 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #0e3a4a 0%, transparent 50%),
        linear-gradient(160deg, var(--bg0), var(--bg1));
      background-attachment: fixed;
    }
    main {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 2rem 16px;
    }
    .panel {
      width: min(36rem, 100%);
      opacity: 1;
      translate: 0;
      transition: opacity 0.5s ease, translate 0.5s ease;
      transition-behavior: allow-discrete;
    }
    @starting-style {
      .panel { opacity: 0; translate: 0 16px; }
    }
    header { text-align: center; }
    .brand {
      font-family: Fraunces, Georgia, serif;
      font-weight: 700;
      font-size: clamp(2rem, 6vw, 2.75rem);
      letter-spacing: -0.02em;
      margin: 0 0 0.5rem;
    }
    .status {
      margin: 0;
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.5;
    }
    .clock {
      font-family: var(--mono);
      font-size: 0.8rem;
      color: var(--faint);
      margin-top: 0.25rem;
      font-variant-numeric: tabular-nums;
    }
    .rail {
      list-style: none;
      padding: 0;
      margin: 1.5rem 0 0;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 6px;
    }
    .rail li { min-width: 0; }
    .rail .bar {
      height: 4px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent-dim) 30%, transparent);
      overflow: hidden;
      position: relative;
    }
    .rail li.done .bar { background: var(--accent-dim); }
    .rail li.active .bar::after {
      content: "";
      position: absolute;
      inset: 0;
      width: 45%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent-dim), var(--accent));
      animation: slide 1.4s ease-in-out infinite;
    }
    .rail li.error .bar { background: var(--err); }
    .rail .name {
      display: block;
      margin-top: 6px;
      font-family: var(--mono);
      font-size: 0.68rem;
      color: var(--faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rail li.active .name { color: var(--accent); font-weight: 600; }
    .rail li.done .name { color: var(--muted); }
    .rail .dur {
      display: block;
      font-family: var(--mono);
      font-size: 0.62rem;
      color: var(--faint);
      font-variant-numeric: tabular-nums;
      min-height: 1em;
    }
    @keyframes slide {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(240%); }
    }
    .grid {
      margin-top: 1.25rem;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      min-width: 0;
    }
    .stat dt {
      font-family: var(--mono);
      font-size: 0.6rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--faint);
    }
    .stat dd {
      margin: 2px 0 0;
      font-family: var(--mono);
      font-size: 0.82rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-variant-numeric: tabular-nums;
    }
    .console {
      margin-top: 12px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      font-family: var(--mono);
      font-size: 0.72rem;
      line-height: 1.55;
      height: 11.5rem;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .console div { white-space: pre-wrap; word-break: break-word; }
    .console .t { color: var(--faint); margin-right: 0.5em; }
    .console .ok { color: var(--accent); }
    .console .warn { color: var(--warn); }
    .console .err { color: var(--err); }
    .console .dim { color: var(--muted); }
    @media (max-width: 30rem) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .spark { display: block; width: 100%; height: 14px; margin-top: 4px; color: var(--accent); }
    .note {
      margin: 1rem 0 0;
      min-height: 3.2em;
      font-size: 0.88rem;
      line-height: 1.5;
      color: var(--muted);
      transition: opacity 0.4s ease;
    }
    .note b { color: var(--ink); font-weight: 500; }
    .hint {
      margin-top: 1rem;
      font-size: 0.8rem;
      text-align: center;
      color: color-mix(in srgb, var(--muted) 80%, transparent);
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { transition-duration: 0.01ms; translate: none; }
      @starting-style { .panel { translate: none; } }
      .rail li.active .bar::after { animation: none; width: 100%; opacity: 0.7; }
      .note { transition: none; }
    }
  </style>
</head>
<body>
  <main>
    <div class="panel">
      <header role="status" aria-live="polite">
        <h1 class="brand">${safeBrand}</h1>
        <p class="status" id="status">${safeStatus}</p>
        <div class="clock" id="clock">T+0.0s</div>
      </header>

      <ol class="rail" id="rail" aria-label="Wake pipeline">
        <li data-stage="edge" class="done"><div class="bar"></div><span class="name">edge</span><span class="dur"></span></li>
        <li data-stage="starting"><div class="bar"></div><span class="name">vm start</span><span class="dur"></span></li>
        <li data-stage="booting"><div class="bar"></div><span class="name">boot</span><span class="dur"></span></li>
        <li data-stage="waiting_health"><div class="bar"></div><span class="name">health</span><span class="dur"></span></li>
        <li data-stage="ready"><div class="bar"></div><span class="name">ready</span><span class="dur"></span></li>
      </ol>

      <dl class="grid">
        <div class="stat"><dt>instance</dt><dd id="s-instance">…</dd></div>
        <div class="stat"><dt>zone</dt><dd id="s-zone">…</dd></div>
        <div class="stat"><dt>origin ip</dt><dd id="s-ip">unassigned</dd></div>
        <div class="stat"><dt>poll rtt</dt><dd id="s-rtt">—</dd><svg class="spark" id="spark" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true"></svg></div>
        <div class="stat"><dt>your link</dt><dd id="s-link">—</dd></div>
        <div class="stat"><dt>this page</dt><dd id="s-ttfb">—</dd></div>
      </dl>

      <div class="console" id="log" role="log" aria-label="Boot log"></div>

      <p class="note" id="note"></p>
      <p class="hint">Cold start usually takes 1–2 minutes. The app auto-sleeps after about ${safeIdle} minutes idle.</p>
    </div>
  </main>
  <script>
    (function () {
      var STAGES = ['edge', 'starting', 'booting', 'waiting_health', 'ready'];
      var NOTES = {
        starting: [
          '<b>Why the wait?</b> To cost ~$0 when nobody is sharing, the server VM is powered off. Your request just reached a Cloud Run proxy, which asked the Compute Engine API to start it.',
          'The VM has no static IP. Each boot leases a fresh ephemeral address, which the proxy discovers through the GCE API and forwards to.',
        ],
        booting: [
          '<b>Booting:</b> the hypervisor is up, the guest kernel is starting, then systemd brings up Docker, nginx and the PhotoGroup container.',
          'Once this is warm, photos never touch this proxy: browsers exchange them directly over WebRTC data channels using the BitTorrent wire protocol.',
        ],
        waiting_health: [
          '<b>Health check:</b> the proxy probes the origin through nginx and waits for the Node.js app to answer with its STUN/TURN config.',
          'That config lists ICE servers: STUN to learn your public address for NAT hole punching, TURN as a relay when both sides are behind strict NATs.',
        ],
        ready: ['Origin healthy. Handing you over to the app…'],
        error: ['The origin did not come up in time. This page keeps retrying; a reload also starts a new attempt.'],
      };

      var $ = function (id) { return document.getElementById(id); };
      var statusEl = $('status'), logEl = $('log'), noteEl = $('note'), clockEl = $('clock');
      var started = performance.now();
      var stageAt = { edge: 0 };
      var observed = { edge: true };
      var current = 'edge';
      var tries = 0, noteIdx = 0, lastMsg = '', lastIp = null, prevPhase = null;
      var rtts = [];

      function since(ms) { return '+' + (ms / 1000).toFixed(1) + 's'; }
      function now() { return performance.now() - started; }

      function log(text, cls) {
        var row = document.createElement('div');
        var t = document.createElement('span');
        t.className = 't';
        t.textContent = since(now());
        var body = document.createElement('span');
        if (cls) body.className = cls;
        body.textContent = text;
        row.appendChild(t);
        row.appendChild(body);
        var stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 24;
        logEl.appendChild(row);
        while (logEl.childNodes.length > 120) logEl.removeChild(logEl.firstChild);
        if (stick) logEl.scrollTop = logEl.scrollHeight;
      }

      function setText(id, value) { var el = $(id); if (el && value != null && value !== '') el.textContent = String(value); }

      function setStage(stage, assumed) {
        if (stage === 'idle') stage = 'starting';
        if (!assumed) observed[stage] = true;
        var isError = stage === 'error';
        var target = isError ? current : stage;
        var idx = STAGES.indexOf(target);
        if (idx < 0) return;
        for (var i = 0; i <= idx; i++) if (stageAt[STAGES[i]] == null) stageAt[STAGES[i]] = now();
        current = target;
        var items = document.querySelectorAll('#rail li');
        for (var j = 0; j < items.length; j++) {
          var li = items[j];
          var s = STAGES.indexOf(li.getAttribute('data-stage'));
          li.className = s < idx ? 'done' : s === idx ? (isError ? 'error' : (target === 'ready' ? 'done' : 'active')) : '';
          var next = STAGES[s + 1];
          var dur = li.querySelector('.dur');
          if (s < idx && stageAt[next] != null && li.getAttribute('data-stage') !== 'edge') {
            // A stage the server had already passed before we first polled has no real duration.
            dur.textContent = observed[STAGES[s]] ? ((stageAt[next] - stageAt[STAGES[s]]) / 1000).toFixed(1) + 's' : 'earlier';
          }
        }
      }

      function renderSpark() {
        var svg = $('spark');
        if (rtts.length < 2) return;
        var max = Math.max.apply(null, rtts.concat([50]));
        var step = 100 / 39;
        var off = 40 - rtts.length;
        var pts = rtts.map(function (v, i) {
          return ((i + off) * step).toFixed(1) + ',' + (13 - (v / max) * 12).toFixed(1);
        }).join(' ');
        svg.innerHTML = '<polyline fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke" points="' + pts + '"/>';
      }

      function rotateNote() {
        var key = prevPhase === 'error' ? 'error' : current;
        var list = NOTES[key] || NOTES.starting;
        noteEl.style.opacity = '0';
        setTimeout(function () {
          noteEl.innerHTML = list[noteIdx % list.length];
          noteEl.style.opacity = '1';
          noteIdx += 1;
        }, 200);
      }

      function describeClient() {
        try {
          var nav = performance.getEntriesByType('navigation')[0];
          if (nav) {
            var dns = nav.domainLookupEnd - nav.domainLookupStart;
            var tcp = nav.connectEnd - nav.connectStart;
            var tls = nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0;
            var ttfb = nav.responseStart - nav.requestStart;
            setText('s-ttfb', (nav.nextHopProtocol || 'http') + ' ' + Math.round(ttfb) + 'ms');
            document.querySelector('#rail li[data-stage="edge"] .dur').textContent = Math.round(ttfb) + 'ms';
            log('page: ' + (nav.nextHopProtocol || 'http') + ' · dns ' + Math.round(dns) + 'ms · tcp ' + Math.round(tcp) +
              'ms · tls ' + Math.round(tls) + 'ms · ttfb ' + Math.round(ttfb) + 'ms', 'dim');
          }
        } catch (_) {}
        var c = navigator.connection;
        if (c && (c.effectiveType || c.rtt != null)) {
          var link = (c.effectiveType || '?') + (c.downlink ? ' ' + c.downlink + 'Mb/s' : '');
          setText('s-link', link);
          log('network info: ' + link + (c.rtt != null ? ' · est. rtt ' + c.rtt + 'ms' : '') + (c.saveData ? ' · save-data' : ''), 'dim');
        } else {
          setText('s-link', navigator.onLine ? 'online' : 'offline');
        }
        log('edge: request accepted by Cloud Run wake proxy (HTTP 503 + this page while origin is cold)', 'ok');
      }

      async function tick() {
        tries += 1;
        var t0 = performance.now();
        try {
          var res = await fetch('/__wake__/status', { cache: 'no-store' });
          var data = await res.json();
          var rtt = Math.round(performance.now() - t0);
          rtts.push(rtt);
          if (rtts.length > 40) rtts.shift();
          setText('s-rtt', rtt + 'ms');
          renderSpark();
          setText('s-instance', data.instance);
          setText('s-zone', data.zone);
          if (data.externalIp && data.externalIp !== lastIp) {
            log('GCE assigned ephemeral IPv4 ' + data.externalIp, 'ok');
            lastIp = data.externalIp;
            setText('s-ip', data.externalIp);
          }
          if (data.phase !== prevPhase) {
            log('phase → ' + data.phase + (data.message ? ' (' + data.message + ')' : ''), data.phase === 'error' ? 'err' : 'ok');
            prevPhase = data.phase;
            setStage(data.phase);
            noteIdx = 0;
            rotateNote();
          } else if (data.message && data.message !== lastMsg) {
            log(data.message, 'dim');
          } else {
            log('poll ' + res.status + ' · ' + rtt + 'ms', 'dim');
          }
          lastMsg = data.message;
          if (data.ready) {
            setStage('ready');
            statusEl.textContent = 'Ready — loading…';
            log('origin healthy · redirecting', 'ok');
            setTimeout(function () {
              window.location.replace(window.location.pathname + window.location.search + window.location.hash);
            }, 400);
            return;
          }
          if (data.phase === 'starting' || data.phase === 'booting') {
            statusEl.textContent = 'Starting the server…';
          } else if (data.phase === 'waiting_health') {
            statusEl.textContent = 'Almost there — waiting for the app…';
          } else {
            statusEl.textContent = data.message || 'Waking up…';
          }
        } catch (err) {
          log('poll #' + tries + ' failed: ' + (err && err.message ? err.message : 'network error'), 'warn');
          statusEl.textContent = 'Connecting…';
        }
        var delay = tries < 10 ? 2000 : 4000;
        setTimeout(tick, delay);
      }

      setInterval(function () { clockEl.textContent = 'T' + since(now()) + ' · poll #' + tries; }, 100);
      setInterval(rotateNote, 7000);
      describeClient();
      setStage('starting', true);
      rotateNote();
      setTimeout(tick, 600);
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
