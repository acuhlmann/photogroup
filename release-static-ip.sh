#!/usr/bin/env bash
# Release the reserved regional static IP used by the PhotoGroup VM.
# After DNS points at Cloud Run, the VM should use an ephemeral IP only
# (assigned automatically when the instance starts).
#
# Usage:
#   ./release-static-ip.sh
#   ./release-static-ip.sh --dry-run

set -euo pipefail

ZONE="${ZONE:-asia-east2-a}"
REGION="${ZONE%-*}"
INSTANCE="${INSTANCE:-main}"
PROJECT="${PROJECT:-photogroup-215600}"
ADDRESS_NAME="${ADDRESS_NAME:-${INSTANCE}-ip}"
DRY_RUN=0

if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

echo "Release static IP '$ADDRESS_NAME' in $REGION (project $PROJECT)"
echo ""

CURRENT_IP=$(gcloud compute addresses describe "$ADDRESS_NAME" \
  --project "$PROJECT" --region "$REGION" \
  --format='value(address)' 2>/dev/null || true)

if [ -z "$CURRENT_IP" ]; then
  echo "No reserved address named '$ADDRESS_NAME' — nothing to do."
  exit 0
fi

echo "Found reserved IP: $CURRENT_IP"

STATUS=$(gcloud compute addresses describe "$ADDRESS_NAME" \
  --project "$PROJECT" --region "$REGION" \
  --format='value(status)' 2>/dev/null || true)
echo "Address status: $STATUS"

# Detach from VM access config if still attached
if gcloud compute instances describe "$INSTANCE" --project "$PROJECT" --zone "$ZONE" &>/dev/null; then
  NIC=$(gcloud compute instances describe "$INSTANCE" --project "$PROJECT" --zone "$ZONE" \
    --format='value(networkInterfaces[0].name)' 2>/dev/null || echo "nic0")
  ACCESS=$(gcloud compute instances describe "$INSTANCE" --project "$PROJECT" --zone "$ZONE" \
    --format='value(networkInterfaces[0].accessConfigs[0].name)' 2>/dev/null || true)
  VM_IP=$(gcloud compute instances describe "$INSTANCE" --project "$PROJECT" --zone "$ZONE" \
    --format='value(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null || true)

  if [ -n "$ACCESS" ] && [ "$VM_IP" = "$CURRENT_IP" ]; then
    echo "Detaching static IP from $INSTANCE ($ACCESS on $NIC)..."
    if [ "$DRY_RUN" = "1" ]; then
      echo "DRY-RUN: would delete-access-config + add ephemeral access-config"
    else
      # Remove static access config
      gcloud compute instances delete-access-config "$INSTANCE" \
        --project "$PROJECT" --zone "$ZONE" \
        --access-config-name="$ACCESS" \
        --network-interface="$NIC" || true
      # Add ephemeral external IP so the VM remains reachable when running
      gcloud compute instances add-access-config "$INSTANCE" \
        --project "$PROJECT" --zone "$ZONE" \
        --network-interface="$NIC" \
        --access-config-name="External NAT" || true
      echo "VM now uses an ephemeral external IP (released when stopped)."
    fi
  else
    echo "VM is not using $CURRENT_IP (or has no access config) — skipping detach."
  fi
fi

echo "Deleting reserved address $ADDRESS_NAME..."
if [ "$DRY_RUN" = "1" ]; then
  echo "DRY-RUN: would delete address $ADDRESS_NAME"
else
  gcloud compute addresses delete "$ADDRESS_NAME" \
    --project "$PROJECT" --region "$REGION" --quiet
  echo "Static IP released. Savings ≈ \$3.65/month when the VM is stopped."
fi
