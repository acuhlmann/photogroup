# PhotoGroup wake proxy

Cloud Run front door that **starts the GCE VM on demand**, shows a cold-start page, then reverse-proxies HTTP and WebSocket traffic to nginx on the VM.

## Architecture

```
Browser → (optional Cloudflare) → Cloud Run wake-proxy (asia-southeast1)
            ├─ bot / probe → 404 (does not start VM, does not touch nginx)
            ├─ VM stopped → GCE Start API → wait for /api/__rtcConfig__
            └─ VM running → HTTP proxy to ephemeral VM IP (Host header preserved)
VM idle-stop timer → stops instance after ~60 minutes without nginx traffic
```

When the VM is **stopped**, its ephemeral external IP is released → **~$0/month** idle cost (disk within free tier). DNS points at Cloudflare or Cloud Run, not at the VM.

## Bot filtering

Junk traffic was keeping the e2-micro awake (~$8/mo). The proxy now:

1. Returns **404** for scanner paths (`/wp-admin`, `/.env`, `*.php`, …) — never wakes, never proxies.
2. Allows only **browser-like User-Agents** (Chrome / Firefox / Safari / Edge, etc.). `curl`, empty UA, Googlebot, etc. get 404.
3. Applies the same rules when the VM is **already warm**, so probes do not reset nginx idle-stop.
4. Keeps `/__wake__/healthz`, `/robots.txt`, and `/__wake__/status` unfiltered (ops + starting page). Status no longer HTTP-probes nginx (that also reset idle).

Human visits in a normal browser still wake the VM and see the starting page.

## Local development

```bash
cd wake-proxy
npm install
GCP_PROJECT=photogroup-215600 GCE_ZONE=asia-east2-a GCE_INSTANCE=main npm start
npm test
```

Requires Application Default Credentials with `compute.instances.get/start/stop`.

## Deploy

From the repo root:

```bash
./deploy-wake-proxy.sh
```

Then map DNS to the Cloud Run service (see script output) and run `./release-static-ip.sh`.

## Cloudflare (recommended, free)

Cloudflare sits in front of Cloud Run and blocks many bots before they reach the wake proxy. Complementary to the in-proxy filter.

### 1. Add the site

1. Create a free account at [cloudflare.com](https://www.cloudflare.com/).
2. **Add site** → `photogroup.network`.
3. Choose the **Free** plan.
4. Cloudflare shows two nameservers — set those at your domain registrar (replace the current NS records).
5. Wait until the dashboard says the zone is **Active**.

### 2. DNS records (proxied)

Point the apex and `www` at Cloud Run’s domain-mapping target (same records `gcloud` printed for domain mappings), usually:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `@` or `photogroup.network` | `ghs.googlehosted.com` | **Proxied** (orange cloud) |
| CNAME | `www` | `ghs.googlehosted.com` | **Proxied** |

If your domain mapping uses different values, use those instead. Leave proxy **on** (orange) so traffic goes through Cloudflare.

> Apex CNAME: Cloudflare supports CNAME flattening on the free plan. If Google gave you A/AAAA records instead, add those with proxy on.

Do **not** point DNS at the GCE VM IP.

### 3. SSL/TLS

In Cloudflare → **SSL/TLS**:

- Encryption mode: **Full (strict)** — Cloud Run serves a valid Google-managed cert for the custom domain.
- Enable **Always Use HTTPS**.

### 4. Bot Fight Mode

**Security → Bots** (Free):

- Turn on **Bot Fight Mode**.

Optional on Free / easy wins:

- **Security → Settings**: Security Level = **Medium** (or High if you still see junk).
- **Security → WAF** → tools: block common countries you never serve if you want (optional).
- Create a WAF custom rule (free allotment): e.g. block URI paths containing `wp-`, `.env`, `xmlrpc` (belt-and-suspenders with the wake proxy).

### 5. WebSockets

PhotoGroup needs `wss://…/ws` for the BitTorrent tracker.

**Network**: ensure **WebSockets** is **On** (default on).

### 6. Cache

The app is dynamic (SSE, APIs). Avoid caching HTML/API at the edge:

- **Caching → Configuration**: Caching Level = **Standard**.
- Add a Cache Rule (or Page Rule on older UI):  
  `photogroup.network/api/*` → **Bypass cache**  
  `photogroup.network/__wake__/*` → **Bypass cache**  
  `photogroup.network/ws*` → **Bypass cache**

### 7. Verify

```bash
# Ops status still works with curl (not proxied to VM logic for wake)
curl -sS https://photogroup.network/__wake__/status

# Scanner path should 404 at the edge or wake proxy — must NOT start the VM
curl -sS -o /dev/null -w "%{http_code}\n" https://photogroup.network/wp-admin/

# Browser: open https://photogroup.network — starting page only if VM was stopped
```

In Cloudflare **Analytics → Traffic / Security**, you should see mitigated bots. On the VM, `photogroup-idle-stop` should begin stopping the instance after real idle.

### Notes

- Cloudflare ↔ Cloud Run: orange-cloud DNS to the domain-mapping target; Host header stays `photogroup.network`.
- If something breaks after enabling proxy, set the record to **DNS only** (grey cloud) temporarily to isolate Cloudflare vs wake-proxy issues.
- Challenge pages can occasionally hit real users on shared IPs; lower Bot Fight sensitivity or Security Level if that happens.

## Endpoints

| Path | Purpose |
|------|---------|
| `/__wake__/healthz` | Liveness (does **not** start the VM) |
| `/__wake__/status` | JSON boot status for the starting page |
| `/__wake__/stop` | POST + `X-Wake-Stop-Secret` — stop the VM (optional) |
| `/*` | Bot-filtered; start VM if needed, then proxy to origin |

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `GCP_PROJECT` | `photogroup-215600` | Project |
| `GCE_ZONE` | `asia-east2-a` | VM zone |
| `GCE_INSTANCE` | `main` | VM name |
| `ORIGIN_SCHEME` | `http` | Scheme to talk to nginx (`http` recommended; set `X-Wake-Proxy: 1`) |
| `HEALTH_PATH` | `/api/__rtcConfig__` | Readiness probe |
| `READY_TIMEOUT_MS` | `180000` | Max wait for origin |
| `WAKE_STOP_SECRET` | _(empty)_ | Enables `/__wake__/stop` |
| `IDLE_MINUTES` | `60` | Hint shown on starting page |
