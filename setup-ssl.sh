#!/usr/bin/env bash

# One-time SSL certificate setup script for Let's Encrypt
# Run this script from your LOCAL machine (it uses gcloud to SSH into the VM)
# This script will remotely install certbot and set up SSL certificates on the GCP VM

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-215600
DOMAIN=photogroup.network
EMAIL= # Update this with your email

echo "Setting up Let's Encrypt SSL certificates for $DOMAIN"
echo "Project: $PROJECT"
echo "Instance: $INSTANCE"
echo "Zone: $ZONE"
echo ""

# Verify instance exists
echo "Verifying VM instance exists..."
if ! gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE &>/dev/null; then
    echo "ERROR: VM instance '$INSTANCE' not found in project '$PROJECT' zone '$ZONE'"
    echo ""
    echo "Listing available instances in project '$PROJECT':"
    gcloud compute instances list --project $PROJECT 2>/dev/null || echo "  (Could not list instances - check project access)"
    echo ""
    echo "OPTIONS:"
    echo "1. If your VM exists with a different name/zone, update these variables at the top of this script:"
    echo "   - INSTANCE (currently: $INSTANCE)"
    echo "   - ZONE (currently: $ZONE)"
    echo "   - PROJECT (currently: $PROJECT)"
    echo ""
    echo "2. To create a new VM instance, run:"
    echo "   ./create-vm.sh"
    echo ""
    echo "   Or manually:"
    echo "   gcloud compute instances create $INSTANCE --project $PROJECT --zone $ZONE --machine-type=e2-micro --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud"
    echo ""
    exit 1
fi

echo "VM instance found. Continuing with SSL setup..."
echo "This script will:"
echo "1. Install certbot"
echo "2. Obtain SSL certificates"
echo "3. Set up automatic renewal"
echo ""

# Install certbot
echo "Installing certbot..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo apt-get update && sudo apt-get install -y certbot python3-certbot-nginx"

# Ensure nginx is running and configured (temporarily allow HTTP)
echo "Ensuring nginx is running..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo systemctl start nginx || true"

# Obtain certificates using certbot with nginx plugin
echo "Obtaining SSL certificates from Let's Encrypt..."
echo "Note: This requires DNS to be pointing to the VM's external IP"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email $EMAIL --redirect"

# Set up automatic renewal
echo "Setting up automatic certificate renewal..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo systemctl enable certbot.timer"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo systemctl start certbot.timer"

# Test renewal
echo "Testing certificate renewal..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo certbot renew --dry-run"

echo ""
echo "SSL setup complete!"
echo "Certificates are located at: /etc/letsencrypt/live/$DOMAIN/"
echo "Automatic renewal is configured via certbot.timer"

