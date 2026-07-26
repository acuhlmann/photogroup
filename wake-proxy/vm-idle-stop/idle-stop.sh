#!/usr/bin/env bash
# Auto-stop this GCE VM when nginx has been idle for IDLE_MINUTES.
# Installed as a systemd timer by install-idle-stop.sh.
# Uses the instance metadata service + Compute Engine REST API (no gcloud required).

set -euo pipefail

IDLE_MINUTES="${IDLE_MINUTES:-60}"
ACCESS_LOG="${ACCESS_LOG:-/var/log/nginx/wake-access.log}"
METADATA="http://metadata.google.internal/computeMetadata/v1"
META_HEADER="Metadata-Flavor: Google"

log() { echo "[idle-stop] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# Skip if someone is actively connected right now (optional soft check)
if command -v ss >/dev/null 2>&1; then
  ACTIVE=$(ss -tn state established '( sport = :443 or sport = :80 )' 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
  if [ "${ACTIVE:-0}" -gt 0 ]; then
    log "active TCP connections on 80/443 ($ACTIVE) — not stopping"
    exit 0
  fi
fi

if [ ! -f "$ACCESS_LOG" ]; then
  log "access log missing ($ACCESS_LOG) — treating as idle"
  LAST_ACTIVITY_EPOCH=0
else
  # Prefer mtime of access log (updated on each request)
  LAST_ACTIVITY_EPOCH=$(stat -c %Y "$ACCESS_LOG" 2>/dev/null || echo 0)
fi

NOW_EPOCH=$(date +%s)
IDLE_SECONDS=$((IDLE_MINUTES * 60))
AGE=$((NOW_EPOCH - LAST_ACTIVITY_EPOCH))

if [ "$AGE" -lt "$IDLE_SECONDS" ]; then
  log "last nginx activity ${AGE}s ago (< ${IDLE_SECONDS}s) — not stopping"
  exit 0
fi

log "idle for ${AGE}s (>= ${IDLE_SECONDS}s) — stopping instance"

PROJECT=$(curl -fsS -H "$META_HEADER" "$METADATA/project/project-id")
ZONE_PATH=$(curl -fsS -H "$META_HEADER" "$METADATA/instance/zone")
ZONE="${ZONE_PATH##*/}"
INSTANCE=$(curl -fsS -H "$META_HEADER" "$METADATA/instance/name")
TOKEN=$(curl -fsS -H "$META_HEADER" "$METADATA/instance/service-accounts/default/token" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ] || [ -z "$PROJECT" ] || [ -z "$ZONE" ] || [ -z "$INSTANCE" ]; then
  log "ERROR: failed to read metadata (project/zone/instance/token)"
  exit 1
fi

HTTP_CODE=$(curl -sS -o /tmp/idle-stop-response.json -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/${INSTANCE}/stop")

log "stop API HTTP $HTTP_CODE — $(head -c 200 /tmp/idle-stop-response.json 2>/dev/null || true)"
if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  exit 0
fi
exit 1
