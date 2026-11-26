#!/usr/bin/env bash

# Copy the problem reports people sent from the app ("Send a problem report")
# off the VM into ./reports/. The server keeps them in the photogroup-data
# volume (/app/data/reports) for 30 days, at most 500.
#   ./get-reports.sh            all reports
#   ./get-reports.sh K7QX-M2PA  only the report with this number

set -euo pipefail
ZONE="${ZONE:-us-central1-a}"
INSTANCE="${INSTANCE:-main}"
PROJECT="${PROJECT:-photogroup-215600}"
CONTAINER_NAME=photogroup-app
ID="${1:-}"
OUT=./reports

# The VM stops when idle; start it, so the copy has something to copy from.
STATUS=$(gcloud compute instances describe "$INSTANCE" --project "$PROJECT" --zone "$ZONE" --format='value(status)')
if [ "$STATUS" != "RUNNING" ]; then
    echo "Starting $INSTANCE ($STATUS)..."
    gcloud compute instances start "$INSTANCE" --project "$PROJECT" --zone "$ZONE"
fi

PATTERN="*${ID}*.json"
gcloud compute ssh "$INSTANCE" --project "$PROJECT" --zone "$ZONE" --command "
    rm -rf /tmp/pg-reports && mkdir -p /tmp/pg-reports &&
    sudo docker exec $CONTAINER_NAME sh -c 'cd /app/data/reports 2>/dev/null && tar cf - $PATTERN 2>/dev/null || true' | tar xf - -C /tmp/pg-reports
"
mkdir -p "$OUT"
gcloud compute scp --recurse "$INSTANCE:/tmp/pg-reports/*" "$OUT/" --project "$PROJECT" --zone "$ZONE" || echo "No reports found."
ls -1 "$OUT"
