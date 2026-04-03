# CLAUDE.md -- Claude Code Agent Instructions for PhotoGroup

For general project navigation, architecture, and development guidance, see `AGENTS.md`.

## GCP Cloud access

Deployment uses `gcloud` CLI authenticated with a service account key (JSON). Claude Code agents use the secret `GCP_SERVICE_ACCOUNT_KEY`. To authenticate:
```bash
echo "$GCP_SERVICE_ACCOUNT_KEY" > /tmp/gcp-key.json
gcloud auth activate-service-account --key-file=/tmp/gcp-key.json
gcloud config set project photogroup-215600
rm /tmp/gcp-key.json
```
GCP project: `photogroup-215600`, zone: `asia-east2-a`, VM instance: `main`. Deployment scripts: `deploy-docker.sh`, `deploy-nginx.sh`, `deploy-app.sh`. See `DEPLOYMENT.md` for full details.

> **Note:** Cursor Cloud agents use `GCP_DEPLOY` instead of `GCP_SERVICE_ACCOUNT_KEY` for the same purpose. See `AGENTS.md` for Cursor-specific instructions.
