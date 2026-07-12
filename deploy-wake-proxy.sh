#!/usr/bin/env bash
# Deploy the PhotoGroup wake proxy to Cloud Run and (optionally) install VM idle-stop.
#
# Prerequisites:
#   - gcloud authenticated with permission to deploy Cloud Run + manage IAM
#   - Docker available locally (or Cloud Build)
#
# Usage:
#   ./deploy-wake-proxy.sh
#   WAKE_STOP_SECRET=... IDLE_MINUTES=60 ./deploy-wake-proxy.sh
#   SKIP_IDLE_STOP=1 ./deploy-wake-proxy.sh   # deploy Cloud Run only

set -euo pipefail

ZONE="${ZONE:-asia-east2-a}"
# Domain mappings are not supported in asia-east2; use asia-southeast1 for Cloud Run.
REGION="${REGION:-asia-southeast1}"
INSTANCE="${INSTANCE:-main}"
PROJECT="${PROJECT:-photogroup-215600}"
SERVICE="${WAKE_SERVICE:-photogroup-wake}"
IMAGE="gcr.io/${PROJECT}/${SERVICE}:latest"
IDLE_MINUTES="${IDLE_MINUTES:-60}"
SKIP_IDLE_STOP="${SKIP_IDLE_STOP:-0}"
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "Deploy PhotoGroup wake proxy"
echo "=========================================="
echo "Project:  $PROJECT"
echo "Region:   $REGION"
echo "Service:  $SERVICE"
echo "VM:       $INSTANCE ($ZONE)"
echo ""

gcloud config set project "$PROJECT" >/dev/null

# Enable required APIs (idempotent)
gcloud services enable \
  run.googleapis.com \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project "$PROJECT" >/dev/null

# Service account for the wake proxy
SA_NAME="photogroup-wake"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" &>/dev/null; then
  echo "Creating service account $SA_EMAIL..."
  gcloud iam service-accounts create "$SA_NAME" \
    --project "$PROJECT" \
    --display-name "PhotoGroup wake proxy"
fi

# Grant start/stop/get on Compute Engine
echo "Ensuring IAM roles on wake service account..."
for ROLE in roles/compute.instanceAdmin.v1 roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --condition=None \
    >/dev/null 2>&1 || true
done

# Also allow the VM's own SA to stop itself (for idle-stop)
VM_SA=$(gcloud compute instances describe "$INSTANCE" \
  --project "$PROJECT" --zone "$ZONE" \
  --format='get(serviceAccounts[0].email)' 2>/dev/null || true)
if [ -n "${VM_SA:-}" ]; then
  echo "Ensuring VM SA can stop itself: $VM_SA"
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${VM_SA}" \
    --role="roles/compute.instanceAdmin.v1" \
    --condition=None \
    >/dev/null 2>&1 || true
fi

echo "Building and pushing image $IMAGE ..."
export DOCKER_BUILDKIT=1
docker build -t "$IMAGE" "$ROOT/wake-proxy"
gcloud auth configure-docker --quiet
docker push "$IMAGE"

ENV_VARS="GCP_PROJECT=${PROJECT},GCE_ZONE=${ZONE},GCE_INSTANCE=${INSTANCE},ORIGIN_SCHEME=http,HEALTH_PATH=/api/__rtcConfig__,IDLE_MINUTES=${IDLE_MINUTES}"
if [ -n "${WAKE_STOP_SECRET:-}" ]; then
  ENV_VARS="${ENV_VARS},WAKE_STOP_SECRET=${WAKE_STOP_SECRET}"
fi

echo "Deploying Cloud Run service $SERVICE ..."
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 3600 \
  --concurrency 80 \
  --session-affinity \
  --service-account "$SA_EMAIL" \
  --set-env-vars "$ENV_VARS"

SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --format='value(status.url)')

echo ""
echo "Wake proxy URL: $SERVICE_URL"

if [ "$SKIP_IDLE_STOP" != "1" ]; then
  echo ""
  IDLE_MINUTES="$IDLE_MINUTES" ZONE="$ZONE" INSTANCE="$INSTANCE" PROJECT="$PROJECT" \
    bash "$ROOT/wake-proxy/vm-idle-stop/install-idle-stop.sh"
fi

echo ""
echo "=========================================="
echo "Next: point DNS at Cloud Run"
echo "=========================================="
echo "1) Map custom domains (must use $REGION — not asia-east2):"
echo "     ./setup-domain-mappings.sh"
echo "   (Run on your laptop after: gcloud auth login)"
echo "   Or manually:"
echo "     gcloud beta run domain-mappings create --service $SERVICE --domain photogroup.network --region $REGION --project $PROJECT"
echo "     gcloud beta run domain-mappings create --service $SERVICE --domain www.photogroup.network --region $REGION --project $PROJECT"
echo "     gcloud beta run domain-mappings create --service $SERVICE --domain hackernews.photogroup.network --region $REGION --project $PROJECT"
echo "   Then add the DNS records Cloud Run prints (replace your old A record)."
echo ""
echo "   OR use Cloudflare: CNAME each hostname to the run.app host of:"
echo "     $SERVICE_URL"
echo "   (proxy/orange-cloud ON)."
echo ""
echo "2) Release the unused static IP to save ~\$3.65/mo:"
echo "     ./release-static-ip.sh"
echo ""
echo "3) Verify:"
echo "     curl -sS $SERVICE_URL/__wake__/status"
echo "     open $SERVICE_URL  # should show starting page then the app"
echo ""
