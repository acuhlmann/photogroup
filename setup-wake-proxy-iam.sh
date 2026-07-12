#!/usr/bin/env bash
# One-time IAM + API setup for the PhotoGroup wake proxy.
#
# Run this as a project Owner / Editor (your user account), NOT as the limited
# GitHub Actions deploy SA. After this succeeds, CI can deploy with
# ./deploy-wake-proxy.sh.
#
# Usage:
#   gcloud auth login
#   ./setup-wake-proxy-iam.sh

set -euo pipefail

PROJECT="${PROJECT:-photogroup-215600}"
REGION="${REGION:-asia-east2}"
ZONE="${ZONE:-asia-east2-a}"
INSTANCE="${INSTANCE:-main}"
GHA_SA="${GHA_SA:-github-actions-deploy@${PROJECT}.iam.gserviceaccount.com}"
WAKE_SA_NAME="photogroup-wake"
WAKE_SA="${WAKE_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo "=========================================="
echo "Wake proxy IAM / API one-time setup"
echo "=========================================="
echo "Project:     $PROJECT"
echo "GitHub SA:   $GHA_SA"
echo "Wake SA:     $WAKE_SA"
echo ""
echo "Active account: $(gcloud config get-value account 2>/dev/null || true)"
echo ""

gcloud config set project "$PROJECT" >/dev/null

echo "1) Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  --project "$PROJECT"
echo "   APIs enabled."

echo "2) Creating wake proxy runtime service account (if missing)..."
if gcloud iam service-accounts describe "$WAKE_SA" --project "$PROJECT" &>/dev/null; then
  echo "   Already exists: $WAKE_SA"
else
  gcloud iam service-accounts create "$WAKE_SA_NAME" \
    --project "$PROJECT" \
    --display-name "PhotoGroup wake proxy"
  echo "   Created: $WAKE_SA"
fi

echo "3) Granting roles to wake runtime SA (start/stop VM)..."
for ROLE in roles/compute.instanceAdmin.v1 roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${WAKE_SA}" \
    --role="$ROLE" \
    --condition=None \
    >/dev/null
  echo "   $WAKE_SA ← $ROLE"
done

echo "4) Granting roles to GitHub Actions deploy SA (needed for CI wake-proxy deploy)..."
for ROLE in \
  roles/run.admin \
  roles/iam.serviceAccountAdmin \
  roles/iam.serviceAccountUser \
  roles/storage.admin \
  roles/artifactregistry.writer \
  roles/serviceusage.serviceUsageConsumer
do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${GHA_SA}" \
    --role="$ROLE" \
    --condition=None \
    >/dev/null
  echo "   $GHA_SA ← $ROLE"
done

# Allow GHA SA to act as the wake runtime SA when deploying Cloud Run
gcloud iam service-accounts add-iam-policy-binding "$WAKE_SA" \
  --project "$PROJECT" \
  --member="serviceAccount:${GHA_SA}" \
  --role="roles/iam.serviceAccountUser" \
  >/dev/null
echo "   $GHA_SA can act as $WAKE_SA"

echo "5) Ensuring VM SA can stop itself (idle-stop)..."
VM_SA=$(gcloud compute instances describe "$INSTANCE" \
  --project "$PROJECT" --zone "$ZONE" \
  --format='get(serviceAccounts[0].email)' 2>/dev/null || true)
if [ -n "${VM_SA:-}" ]; then
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${VM_SA}" \
    --role="roles/compute.instanceAdmin.v1" \
    --condition=None \
    >/dev/null
  echo "   $VM_SA ← roles/compute.instanceAdmin.v1"
else
  echo "   WARNING: could not read VM service account (is the instance running?)"
fi

echo ""
echo "=========================================="
echo "Setup complete"
echo "=========================================="
echo "Next:"
echo "  1. Re-run the failed GitHub Actions deploy, or:"
echo "       ./deploy-wake-proxy.sh"
echo "  2. Failed deploy that triggered this fix:"
echo "       https://github.com/acuhlmann/photogroup/actions/runs/29183337976"
echo ""
