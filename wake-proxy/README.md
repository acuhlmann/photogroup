# PhotoGroup wake proxy

Cloud Run front door that **starts the GCE VM on demand**, shows a cold-start page, then reverse-proxies HTTP and WebSocket traffic to nginx on the VM.

## Architecture

```
Browser → Cloud Run (this service, asia-east2)
            ├─ VM stopped → GCE Start API → wait for /api/__rtcConfig__
            └─ VM running → HTTPS proxy to ephemeral VM IP (Host header preserved)
VM idle-stop timer → stops instance after ~60 minutes without nginx traffic
```

When the VM is **stopped**, its ephemeral external IP is released → **~$0/month** idle cost (disk within free tier). DNS points at Cloud Run, not the VM.

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

## Endpoints

| Path | Purpose |
|------|---------|
| `/__wake__/healthz` | Liveness (does **not** start the VM) |
| `/__wake__/status` | JSON boot status for the starting page |
| `/__wake__/stop` | POST + `X-Wake-Stop-Secret` — stop the VM (optional) |
| `/*` | Start VM if needed, then proxy to origin |

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
