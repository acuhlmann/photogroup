#!/usr/bin/env bash
# Deploy the PhotoGroup wake proxy to Cloud Run and (optionally) install VM idle-stop.
#
# Prerequisites (one-time, as project Owner):
#   ./setup-wake-proxy-iam.sh
#
# Then:
#   ./deploy-wake-proxy.sh
#   WAKE_STOP_SECRET=... IDLE_MINUTES=60 ./deploy-wake-proxy.sh
#   SKIP_IDLE_STOP=1 ./deploy-wake-proxy.sh   # deploy Cloud Run only

set -euo pipefail

ZONE="${ZONE:-asia-east2-a}"
REGION="${REGION:-asia-east2}"
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
echo "Account:  $(gcloud config get-value account 2>/dev/null || echo unknown)"
echo ""

gcloud config set project "$PROJECT" >/dev/null

# Prefer soft-enable: GitHub Actions SA usually cannot enable APIs (needs
# serviceusage.serviceUsageAdmin). Owner should run ./setup-wake-proxy-iam.sh once.
echo "Checking required APIs (enable is best-effort)..."
ENABLE_OUT=$(gcloud services enable \
  run.googleapis.com \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project "$PROJECT" 2>&1) && ENABLE_OK=1 || ENABLE_OK=0
if [ "$ENABLE_OK" != "1" ]; then
  echo "$ENABLE_OUT" | sed 's/^/  /'
  echo ""
  echo "WARNING: Could not enable APIs (often missing serviceusage permission)."
  echo "         Continuing — APIs may already be enabled."
  echo "         If deploy fails next, run as project Owner:"
  echo "           ./setup-wake-proxy-iam.sh"
  echo ""
fi

# Verify critical APIs are actually usable
for API in run.googleapis.com compute.googleapis.com; do
  STATE=$(gcloud services list --enabled --project "$PROJECT" \
    --filter="config.name:$API" --format='value(config.name)' 2>/dev/null || true)
  if [ -z "$STATE" ]; then
    echo "ERROR: Required API '$API' is not enabled on project $PROJECT."
    echo "Run as Owner: ./setup-wake-proxy-iam.sh"
    echo "Or: gcloud services enable $API --project $PROJECT"
    exit 1
  fi
done
echo "Required APIs are enabled."

# Service account for the wake proxy
SA_NAME="photogroup-wake"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" &>/dev/null; then
  echo "Creating service account $SA_EMAIL..."
  if ! gcloud iam service-accounts create "$SA_NAME" \
      --project "$PROJECT" \
      --display-name "PhotoGroup wake proxy"; then
    echo "ERROR: Failed to create $SA_EMAIL"
    echo "The deploy identity needs roles/iam.serviceAccountAdmin, or run:"
    echo "  ./setup-wake-proxy-iam.sh"
    exit 1
  fi
fi

# Grant start/stop/get on Compute Engine (best-effort; setup script is authoritative)
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
if ! docker push "$IMAGE"; then
  echo "ERROR: docker push failed."
  echo "GitHub Actions SA needs roles/storage.admin (GCR) or Artifact Registry writer."
  echo "Fix with: ./setup-wake-proxy-iam.sh"
  exit 1
fi

ENV_VARS="GCP_PROJECT=${PROJECT},GCE_ZONE=${ZONE},GCE_INSTANCE=${INSTANCE},ORIGIN_SCHEME=http,HEALTH_PATH=/api/__rtcConfig__,IDLE_MINUTES=${IDLE_MINUTES}"
if [ -n "${WAKE_STOP_SECRET:-}" ]; then
  ENV_VARS="${ENV_VARS},WAKE_STOP_SECRET=${WAKE_STOP_SECRET}"
fi

echo "Deploying Cloud Run service $SERVICE ..."
if ! gcloud run deploy "$SERVICE" \
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
  --set-env-vars "$ENV_VARS"; then
  echo "ERROR: Cloud Run deploy failed."
  echo "GitHub Actions SA needs roles/run.admin and permission to act as $SA_EMAIL."
  echo "Fix with: ./setup-wake-proxy-iam.sh"
  exit 1
fi

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
echo "1) Map custom domains (if supported in $REGION):"
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
