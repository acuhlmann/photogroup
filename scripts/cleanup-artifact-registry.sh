#!/usr/bin/env bash
# Prune unused Artifact Registry images and remove obsolete App Engine repos.
#
# Usage:
#   ./scripts/cleanup-artifact-registry.sh
#   DRY_RUN=1 ./scripts/cleanup-artifact-registry.sh

set -euo pipefail

PROJECT="${PROJECT:-photogroup-215600}"
DRY_RUN="${DRY_RUN:-0}"

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

echo "Artifact Registry cleanup — project $PROJECT"
echo ""

# Obsolete App Engine Flexible repo (wake-proxy experiment before Cloud Run).
if gcloud artifacts repositories describe gae-flexible \
  --location=asia-south1 --project="$PROJECT" &>/dev/null; then
  echo "Deleting obsolete gae-flexible repository..."
  run gcloud artifacts repositories delete gae-flexible \
    --location=asia-south1 --project="$PROJECT" --quiet
else
  echo "gae-flexible repository not found (already deleted)."
fi

echo ""
echo "Pruning untagged photogroup-wake images (keep latest)..."
  for digest in \
    sha256:409da2c912130de03fa0690c5a46c0d6c4db85a98d910c3b3e3697d95c91e389 \
    sha256:4e82528c6cbd38569e5b9d90fc916c6c136621e5f44fae396044996eccc98ac8; do
  img="us-docker.pkg.dev/${PROJECT}/gcr.io/photogroup-wake@${digest}"
  if gcloud artifacts docker images describe "$img" --project="$PROJECT" &>/dev/null; then
    run gcloud artifacts docker images delete "$img" --quiet --project="$PROJECT"
  else
    echo "  skip (not found): $digest"
  fi
done

echo ""
echo "Deleting App Engine hn-proxy container image (version metadata remains; DNS uses Cloud Run)..."
GAE_IMG="asia-south1-docker.pkg.dev/${PROJECT}/gae-standard/app/default"
GAE_DIGEST=$(gcloud artifacts docker images list "$GAE_IMG" \
  --include-tags --format='value(DIGEST)' --project="$PROJECT" 2>/dev/null | head -1 || true)
if [ -n "$GAE_DIGEST" ]; then
  run gcloud artifacts docker images delete "${GAE_IMG}@${GAE_DIGEST}" --delete-tags --quiet --project="$PROJECT"
else
  echo "  no gae-standard images found."
fi

if gcloud artifacts repositories describe gae-standard \
  --location=asia-south1 --project="$PROJECT" &>/dev/null; then
  COUNT=$(gcloud artifacts docker images list \
    "asia-south1-docker.pkg.dev/${PROJECT}/gae-standard" \
    --include-tags --format='value(IMAGE)' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${COUNT:-0}" = "0" ]; then
    echo "Deleting empty gae-standard repository..."
    run gcloud artifacts repositories delete gae-standard \
      --location=asia-south1 --project="$PROJECT" --quiet
  else
    echo "gae-standard still has $COUNT image(s) — delete manually after confirming unused."
  fi
fi

echo ""
echo "Done."
