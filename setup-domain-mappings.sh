#!/usr/bin/env bash
# Create Cloud Run custom-domain mappings and print Namecheap DNS records.
#
# Run this on YOUR machine (not CI) while logged into the Google account that
# verified photogroup.network in Search Console:
#
#   gcloud auth login
#   gcloud config set project photogroup-215600
#   ./setup-domain-mappings.sh
#
# Cloud Run domain mappings are NOT available in asia-east2 (Hong Kong).
# The wake proxy runs in asia-southeast1 (Singapore) and still starts the VM
# in asia-east2-a.

set -euo pipefail

PROJECT="${PROJECT:-photogroup-215600}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${WAKE_SERVICE:-photogroup-wake}"

DOMAINS=(
  photogroup.network
  www.photogroup.network
  hackernews.photogroup.network
)

echo "Project:  $PROJECT"
echo "Region:   $REGION (domain mappings supported here)"
echo "Service:  $SERVICE"
echo ""

gcloud config set project "$PROJECT" >/dev/null

for domain in "${DOMAINS[@]}"; do
  echo "=========================================="
  echo "Domain: $domain"
  echo "=========================================="
  if gcloud beta run domain-mappings describe \
    --domain "$domain" --region "$REGION" --project "$PROJECT" &>/dev/null; then
    echo "Mapping already exists."
  else
    gcloud beta run domain-mappings create \
      --service "$SERVICE" \
      --domain "$domain" \
      --region "$REGION" \
      --project "$PROJECT"
  fi
  echo ""
  gcloud beta run domain-mappings describe \
    --domain "$domain" \
    --region "$REGION" \
    --project "$PROJECT" \
    --format='yaml(status.resourceRecords,status.conditions)'
  echo ""
done

cat <<'EOF'

Namecheap Advanced DNS (photogroup.network)
-------------------------------------------
1) DELETE old A records pointing at the VM IP (34.92.47.38) for @, www, hackernews.
2) KEEP the SPF TXT on @ unless you know you do not need it.
3) ADD every resourceRecord printed above (exact type/host/value).
4) Wait for DNS propagation, then:
     curl -sS https://photogroup.network/__wake__/status

Typical pattern (confirm against output above):
  photogroup.network      → 4× A + 4× AAAA on Host @
  www.photogroup.network  → CNAME www → ghs.googlehosted.com
  hackernews...           → CNAME hackernews → ghs.googlehosted.com
EOF
