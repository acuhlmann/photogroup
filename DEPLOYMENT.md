# PhotoGroup Deployment Guide

## GCP Project Configuration

- **Project ID**: `photogroup-215600`
- **Domain**: `photogroup.network`
- **Additional service**: `hackernews.photogroup.network` (reverse-proxied to a Docker container on the same VM)
- **Zone**: `asia-east2-a`
- **Instance Name**: `main`

## Prerequisites

1. GCP project `photogroup-215600` exists and you have access
2. `gcloud` CLI installed and authenticated (run `gcloud auth login` if needed)
3. Domain `photogroup.network` registered and DNS access available

## Initial Setup (First-Time Only)

### Step 1: Create VM Instance

Use the automated script to create the VM with all necessary configuration:

```bash
./create-vm.sh
```

This script will:
- Create an e2-micro VM instance named `main` in zone `asia-east2-a`
- Create a static IP address
- Set up firewall rules for ports 80, 443, 8081, and 9000
- Install Node.js 24.x LTS (latest stable LTS), PM2, nginx, and build tools via startup script
- Display the static IP address for DNS configuration

**Alternative manual creation** (if you prefer not to use the script):
```bash
gcloud compute instances create main \
  --project photogroup-215600 \
  --zone asia-east2-a \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=10GB
```

### Step 2: Configure DNS

After the VM is created, you need to point your domain to the VM's static IP address.

1. **Get the VM's external IP address**:
   ```bash
   gcloud compute instances describe main \
     --project photogroup-215600 \
     --zone asia-east2-a \
     --format="get(networkInterfaces[0].accessConfigs[0].natIP)"
   ```
   
   Or if you used `create-vm.sh`, the IP will be displayed at the end.

2. **Update DNS records** at your domain registrar:
   - Create an **A record** for `photogroup.network` pointing to the VM's external IP
   - Optionally create an **A record** for `www.photogroup.network` pointing to the same IP
   - Create an **A record** for `hackernews.photogroup.network` pointing to the same IP
   
   **Common DNS providers:**
   - **Google Domains/Cloud DNS**: Add A record in DNS settings
   - **Namecheap**: Advanced DNS → Add A record
   - **GoDaddy**: DNS Management → Add A record
   - **Cloudflare**: DNS → Add A record

3. **Wait for DNS propagation** (usually 5 minutes to 48 hours, typically 15-30 minutes)
   - Verify DNS is working: `nslookup photogroup.network` or `dig photogroup.network`
   - The domain should resolve to your VM's IP address

**Important**: DNS must be configured and propagated before proceeding to SSL setup, as Let's Encrypt needs to verify domain ownership.

### Step 3: SSL Certificate Setup (One-Time)

The project is configured to use Let's Encrypt SSL certificates. Set up SSL certificates after DNS is configured:

1. **Verify DNS is working**: Ensure `photogroup.network` resolves to your VM's IP
   ```bash
   nslookup photogroup.network
   # or
   dig photogroup.network
   ```

2. **Update email in setup-ssl.sh** (if needed): Email is already set to `acuhlmann@gmail.com`

3. **Deploy nginx configuration first** (required before SSL setup):
   ```bash
   ./deploy-nginx.sh
   ```
   This ensures nginx is configured to handle all three domains before certbot runs.

4. **Run the SSL setup script from your local machine**:
   ```bash
   ./setup-ssl.sh
   ```
   
   **Note**: This script runs locally but executes commands remotely on the GCP VM via `gcloud compute ssh`. You don't need to upload it to the VM.
   
   **If the VM doesn't exist**, the script will show an error. Create the VM first using `./create-vm.sh` or update the `INSTANCE`, `ZONE`, or `PROJECT` variables in the script.

This will:
- Install certbot on the VM
- Obtain SSL certificates from Let's Encrypt for all three domains: `photogroup.network`, `www.photogroup.network`, and `hackernews.photogroup.network`
- Verify the certificate includes all three domains
- Configure automatic renewal
- Update nginx configuration for HTTPS

**Important**: 
- DNS must be pointing to the VM before running this script, as Let's Encrypt needs to verify domain ownership for all three domains
- Nginx configuration must be deployed first (step 3 above) so certbot can properly configure SSL

## Deployment Process

### Automated Deployment via GitHub Actions

The project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically deploys the application to the GCP VM on:
- Push to `main` or `master` branch
- Pull request merge to `main` or `master`
- Manual trigger via `workflow_dispatch`

#### Setup GitHub Actions

1. **Create a GCP Service Account**:
   ```bash
   gcloud iam service-accounts create github-actions-deploy \
     --project photogroup-215600 \
     --display-name "GitHub Actions Deploy"
   ```

2. **Grant necessary permissions**:
   ```bash
   gcloud projects add-iam-policy-binding photogroup-215600 \
     --member="serviceAccount:github-actions-deploy@photogroup-215600.iam.gserviceaccount.com" \
     --role="roles/compute.instanceAdmin.v1"
   
   gcloud projects add-iam-policy-binding photogroup-215600 \
     --member="serviceAccount:github-actions-deploy@photogroup-215600.iam.gserviceaccount.com" \
     --role="roles/compute.osLogin"
   ```

3. **Grant service account user permission** (required for SSH access to VMs):
   ```bash
   # Get the compute service account email (usually PROJECT_NUMBER-compute@developer.gserviceaccount.com)
   # You can find it in the GCP Console or by running:
   gcloud projects describe photogroup-215600 --format="value(projectNumber)"
   
   # Then grant the serviceAccountUser role (replace PROJECT_NUMBER with actual number)
   gcloud iam service-accounts add-iam-policy-binding PROJECT_NUMBER-compute@developer.gserviceaccount.com \
     --member="serviceAccount:github-actions-deploy@photogroup-215600.iam.gserviceaccount.com" \
     --role="roles/iam.serviceAccountUser" \
     --project photogroup-215600
   ```
   
   **Note**: For project `photogroup-215600`, the compute service account is `990406861533-compute@developer.gserviceaccount.com`

4. **Create and download service account key**:
   ```bash
   gcloud iam service-accounts keys create github-actions-key.json \
     --iam-account=github-actions-deploy@photogroup-215600.iam.gserviceaccount.com \
     --project photogroup-215600
   ```

5. **Add secret to GitHub**:
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `GCP_SA_KEY`
   - Value: Copy the entire contents of `github-actions-key.json`
   - Click "Add secret"

6. **Delete the local key file** (for security):
   ```bash
   rm github-actions-key.json
   ```

7. **Add Twilio secrets to GitHub** (required for WebRTC/TURN functionality):
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `TWILIO_ACCOUNT_SID`
   - Value: Your Twilio Account SID (from `server/secret/index.js` or Twilio console)
   - Click "Add secret"
   - Click "New repository secret" again
   - Name: `TWILIO_AUTH_TOKEN`
   - Value: Your Twilio Auth Token (from `server/secret/index.js` or Twilio console)
   - Click "Add secret"

   **Note**: The workflow will automatically create `server/secret/index.js` from these secrets during deployment. This file is gitignored and should never be committed to the repository.

The workflow will automatically:
- Install dependencies
- Create `server/secret/index.js` from GitHub Secrets
- Build the UI
- Prepare deployment files
- Authenticate with GCP
- Deploy nginx configuration
- Deploy the application

### Manual Deployment

### 1. Build the UI
```bash
npm run build
```

### 2. Deploy Application
```bash
./deploy-all.sh
```

Or deploy step by step:
```bash
# Copy files to bin directory
./deploy-copy.sh

# Deploy nginx configuration
./deploy-nginx.sh

# Deploy application to VM
./deploy-app.sh
```

**Note**: If you encounter issues with `wrtc` package installation (node-pre-gyp not found), install it globally first:
```bash
gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "sudo npm install -g node-pre-gyp"
```

**Note**: If SSL certificates are not yet set up, nginx will use HTTP only. After setting up SSL with `./setup-ssl.sh`, update the nginx config to use the SSL-enabled version from `./server/config/photogroup.network`.

## Deployment Scripts

- **create-vm.sh**: Creates VM instance with firewall rules and static IP (first-time setup)
- **deploy-all.sh**: Runs all deployment steps in sequence
- **deploy-copy.sh**: Copies UI build and server files to `./bin/` directory
- **deploy-app.sh**: Uploads application files to VM and restarts with PM2
- **deploy-docker.sh**: Deploys application to VM using Docker (alternative to PM2 deployment)
- **deploy-nginx.sh**: Deploys nginx configuration
- **setup-ssl.sh**: One-time SSL certificate setup script (run from local machine, executes remotely on VM)

### Docker Deployment (Alternative to PM2)

You can deploy the application using Docker instead of PM2:

```bash
# Set Twilio credentials (optional, for WebRTC/TURN functionality)
export TWILIO_ACCOUNT_SID="your_account_sid"
export TWILIO_AUTH_TOKEN="your_auth_token"

# Deploy using Docker
./deploy-docker.sh
```

This script will:
- Build the Docker image locally (with BuildKit for efficient layer caching)
- Upload it to the VM
- Run the container with ports bound to `127.0.0.1:8081` and `127.0.0.1:9000` (for nginx)
- Configure automatic restart
- **Prune unused Docker images and stopped containers on the VM** so disk space is not filled by old PhotoGroup images

**Note**: The Docker container binds to `127.0.0.1` (localhost only) so nginx can proxy to it, but it's not exposed publicly. This matches the nginx configuration which expects the app on `127.0.0.1:8081` and `127.0.0.1:9000`.

**Advantages of Docker deployment**:
- Consistent runtime environment
- Easier rollbacks (just run previous image)
- Isolation from host system
- Works with the same nginx configuration

**Note**: The VM must have Docker installed (which is done automatically by `create-vm.sh`).

## Additional service: Hackersbot (Docker) on `hackernews.photogroup.network`

This repository's nginx config is set up to route:

- `photogroup.network` → Node app on `127.0.0.1:8081` (PM2 or Docker)
- `hackernews.photogroup.network` → a Dockerized Python service on `127.0.0.1:18080`

### Expected Docker contract (VM side)

Run your Hackersbot container so it is **only exposed locally** and nginx can reach it:

```bash
docker run -d --name hackersbot --restart unless-stopped \
  -p 127.0.0.1:18080:8000 \
  ghcr.io/acuhlmann/hackersbot:latest
```

- If Hackersbot listens on a different container port than `8000`, adjust the right side of the port mapping.
- No additional firewall rules are required, since the service is not exposed publicly (only nginx is).

## SSL Certificate Renewal

Let's Encrypt certificates are automatically renewed via certbot.timer. Manual renewal can be done with:
```bash
gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "sudo certbot renew"
```

## Troubleshooting

### VM Creation Issues
- Verify project access: `gcloud config get-value project`
- Check if VM already exists: `gcloud compute instances list --project photogroup-215600`
- Verify zone availability: `gcloud compute zones list --project photogroup-215600`

### DNS Issues
- Verify DNS propagation: `nslookup photogroup.network` or `dig photogroup.network`
- Check DNS records at your registrar
- DNS propagation can take up to 48 hours (usually much faster)
- Ensure A record points to the correct IP address

### SSL Certificate Issues
- Ensure DNS is pointing to VM before running `setup-ssl.sh`
- Check certificate status: `gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "sudo certbot certificates"`
- Verify nginx config: `gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "sudo nginx -t"`
- Check Let's Encrypt rate limits if certificate requests fail
- **If certificate is missing `hackernews.photogroup.network`** (e.g., from an older setup): Run `./fix-ssl-subdomain.sh` to expand the existing certificate to include all three domains. Note: New VMs set up with `./setup-ssl.sh` will automatically include all domains, so this script is only needed for fixing existing certificates.

### Application Not Starting
- Check PM2 status: `gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "pm2 list"`
- Check application logs: `gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "pm2 logs app"`
- Verify ports 8081 and 9000 are not blocked
- Check Node.js installation: `gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "node --version"`

### Nginx Issues
- Test configuration: `gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "sudo nginx -t"`
- Check nginx status: `gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "sudo systemctl status nginx"`
- View nginx logs: `gcloud compute ssh main --project photogroup-215600 --zone asia-east2-a --command "sudo tail -f /var/log/nginx/error.log"`

### Firewall Issues
- Verify firewall rules: `gcloud compute firewall-rules list --project photogroup-215600`
- Check if ports are open: `gcloud compute firewall-rules describe allow-http-https --project photogroup-215600`
- Ensure VM has the correct network tags: `gcloud compute instances describe main --project photogroup-215600 --zone asia-east2-a --format="get(tags.items)"`

