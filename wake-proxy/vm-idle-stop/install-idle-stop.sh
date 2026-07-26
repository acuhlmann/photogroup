#!/usr/bin/env bash
# Install idle-stop.sh as a systemd timer on the PhotoGroup VM.
# Run from the repo root: ./wake-proxy/vm-idle-stop/install-idle-stop.sh
# Or invoke via deploy-wake-proxy.sh / deploy-docker.sh.

set -euo pipefail

ZONE="${ZONE:-asia-east2-a}"
INSTANCE="${INSTANCE:-main}"
PROJECT="${PROJECT:-photogroup-215600}"
IDLE_MINUTES="${IDLE_MINUTES:-60}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing VM idle-stop (idle after ${IDLE_MINUTES} minutes)..."
echo "Project: $PROJECT  Instance: $INSTANCE  Zone: $ZONE"

if ! gcloud compute instances describe "$INSTANCE" --project "$PROJECT" --zone "$ZONE" &>/dev/null; then
  echo "ERROR: VM '$INSTANCE' not found"
  exit 1
fi

gcloud compute scp "$SCRIPT_DIR/idle-stop.sh" "$INSTANCE:/tmp/idle-stop.sh" \
  --project "$PROJECT" --zone "$ZONE" 2>&1 | grep -v "ssh metadata" || true

gcloud compute ssh "$INSTANCE" --project "$PROJECT" --zone "$ZONE" --command "
  set -e
  sudo mkdir -p /opt/photogroup
  sudo mv /tmp/idle-stop.sh /opt/photogroup/idle-stop.sh
  sudo chmod 755 /opt/photogroup/idle-stop.sh

  sudo tee /etc/systemd/system/photogroup-idle-stop.service > /dev/null <<EOF
[Unit]
Description=Stop PhotoGroup VM when nginx has been idle
After=network-online.target

[Service]
Type=oneshot
Environment=IDLE_MINUTES=${IDLE_MINUTES}
Environment=ACCESS_LOG=/var/log/nginx/wake-access.log
ExecStart=/opt/photogroup/idle-stop.sh
EOF

  sudo tee /etc/systemd/system/photogroup-idle-stop.timer > /dev/null <<EOF
[Unit]
Description=Check PhotoGroup VM idle every 10 minutes

[Timer]
OnBootSec=15min
OnUnitActiveSec=10min
AccuracySec=1min
Unit=photogroup-idle-stop.service

[Install]
WantedBy=timers.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable --now photogroup-idle-stop.timer
  sudo systemctl status photogroup-idle-stop.timer --no-pager || true
  echo 'Idle-stop timer installed.'
" 2>&1 | grep -v "ssh metadata" || true

echo ""
echo "NOTE: The VM service account needs roles/compute.instanceAdmin.v1 (or"
echo "compute.instances.stop) on this instance. Grant if stop calls fail:"
echo "  gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE --format='get(serviceAccounts[0].email)'"
echo "  gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:SA_EMAIL --role=roles/compute.instanceAdmin.v1"
