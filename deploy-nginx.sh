#!/usr/bin/env bash

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-215600
DOMAIN=photogroup.network

echo "Deploying nginx configuration..."
echo "Project: $PROJECT"
echo "Instance: $INSTANCE"
echo "Zone: $ZONE"
echo "Domain: $DOMAIN"
echo ""

# Verify instance exists
if ! gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE &>/dev/null; then
    echo "ERROR: VM instance '$INSTANCE' not found in project '$PROJECT' zone '$ZONE'"
    echo "Create the VM first using: ./create-vm.sh"
    exit 1
fi

# Verify nginx config file exists
if [ ! -f "./server/config/$DOMAIN" ]; then
    echo "ERROR: nginx config file not found: ./server/config/$DOMAIN"
    exit 1
fi

# Copy nginx config to sites-available
echo "Uploading nginx configuration..."
gcloud compute scp ./server/config/$DOMAIN $INSTANCE:/tmp/$DOMAIN --project $PROJECT --zone $ZONE

# Move config to sites-available
echo "Installing nginx configuration..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo mv /tmp/$DOMAIN /etc/nginx/sites-available/$DOMAIN"

# Remove default nginx site if it exists
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo rm -f /etc/nginx/sites-enabled/default" || true

# Enable site if not already enabled
echo "Enabling nginx site..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN"

# Test nginx configuration
echo "Testing nginx configuration..."
if ! gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo nginx -t"; then
    echo "ERROR: nginx configuration test failed!"
    exit 1
fi

# Restart nginx
echo "Restarting nginx..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo systemctl restart nginx"

echo ""
echo "Nginx configuration deployed successfully!"
echo ""
echo "Note: If SSL certificates are not yet set up, run: ./setup-ssl.sh"
