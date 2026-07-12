/**
 * Cold-start HTML shown while the GCE VM is booting.
 * Uses @starting-style for entry motion; respects prefers-reduced-motion.
 */
export function renderStartingPage({ brand = 'PhotoGroup', statusText = 'Starting the server…', idleMinutes = 60 } = {}) {
  const safeBrand = escapeHtml(brand);
  const safeStatus = escapeHtml(statusText);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${safeBrand} — Starting</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg0: #0b1c1a;
      --bg1: #14322d;
      --ink: #f2f7f4;
      --muted: #a8c0b8;
      --accent: #3dd6c3;
      --accent-dim: #1f8f84;
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
    }
    main {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 2rem 1.25rem;
    }
    .panel {
      width: min(28rem, 100%);
      text-align: center;
      opacity: 1;
      translate: 0;
      transition: opacity 0.5s ease, translate 0.5s ease;
      transition-behavior: allow-discrete;
    }
    @starting-style {
      .panel {
        opacity: 0;
        translate: 0 16px;
      }
    }
    .brand {
      font-family: Fraunces, Georgia, serif;
      font-weight: 700;
      font-size: clamp(2rem, 6vw, 2.75rem);
      letter-spacing: -0.02em;
      margin: 0 0 0.75rem;
    }
    .status {
      margin: 0;
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.5;
    }
    .bar {
      margin: 1.75rem auto 0;
      width: min(16rem, 80%);
      height: 4px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent-dim) 40%, transparent);
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      width: 40%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent-dim), var(--accent));
      animation: slide 1.4s ease-in-out infinite;
    }
    @keyframes slide {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(280%); }
    }
    .hint {
      margin-top: 1.5rem;
      font-size: 0.85rem;
      color: color-mix(in srgb, var(--muted) 80%, transparent);
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { transition-duration: 0.01ms; translate: none; }
      @starting-style { .panel { translate: none; } }
      .bar > span { animation: none; width: 100%; opacity: 0.7; }
    }
  </style>
</head>
<body>
  <main>
    <div class="panel" role="status" aria-live="polite">
      <h1 class="brand">${safeBrand}</h1>
      <p class="status" id="status">${safeStatus}</p>
      <div class="bar" aria-hidden="true"><span></span></div>
      <p class="hint">Cold start usually takes 1–2 minutes. The app auto-sleeps after about ${idleMinutes} minutes idle.</p>
    </div>
  </main>
  <script>
    (function () {
      const statusEl = document.getElementById('status');
      const started = Date.now();
      let tries = 0;

      async function tick() {
        tries += 1;
        const elapsed = Math.round((Date.now() - started) / 1000);
        try {
          const res = await fetch('/__wake__/status', { cache: 'no-store' });
          const data = await res.json();
          if (data.ready) {
            statusEl.textContent = 'Ready — loading…';
            window.location.replace(window.location.pathname + window.location.search + window.location.hash);
            return;
          }
          if (data.phase === 'starting' || data.phase === 'booting') {
            statusEl.textContent = 'Starting the server… (' + elapsed + 's)';
          } else if (data.phase === 'waiting_health') {
            statusEl.textContent = 'Almost there — waiting for the app… (' + elapsed + 's)';
          } else {
            statusEl.textContent = (data.message || 'Waking up…') + ' (' + elapsed + 's)';
          }
        } catch (_) {
          statusEl.textContent = 'Connecting… (' + elapsed + 's)';
        }
        const delay = tries < 10 ? 2000 : 4000;
        setTimeout(tick, delay);
      }
      setTimeout(tick, 1500);
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
