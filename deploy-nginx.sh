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

# Function to run gcloud commands and ignore metadata update warnings
run_gcloud_ssh() {
    local cmd="$1"
    local description="$2"
    local temp_output
    local exit_code
    
    # Run command, capture both output and exit code
    temp_output=$(gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "$cmd" 2>&1)
    exit_code=$?
    
    # Filter out metadata warnings but keep everything else, and always show output
    echo "$temp_output" | grep -v "^Updating project ssh metadata\.\.\." | grep -v "^Updating instance ssh metadata\.\.\." | grep -v "^\.$" | grep -v "^done\.$" || true
    
    if [ $exit_code -ne 0 ]; then
        echo "ERROR: $description failed (exit code: $exit_code)"
        return $exit_code
    fi
    return 0
}

# Copy nginx config to sites-available
echo "Uploading nginx configuration..."
# Use scp with error checking - filter warnings but check actual result
SCP_OUTPUT=$(gcloud compute scp ./server/config/$DOMAIN $INSTANCE:/tmp/$DOMAIN --project $PROJECT --zone $ZONE 2>&1)
SCP_EXIT=$?
# Show output but filter metadata warnings
echo "$SCP_OUTPUT" | grep -v "^Updating project ssh metadata\.\.\." | grep -v "^Updating instance ssh metadata\.\.\." | grep -v "^\.$" | grep -v "^done\.$" || true

# Verify upload succeeded
if [ $SCP_EXIT -ne 0 ] || ! run_gcloud_ssh "test -f /tmp/$DOMAIN" "File upload verification" >/dev/null 2>&1; then
    echo "ERROR: Failed to upload nginx configuration"
    exit 1
fi

# Move config to sites-available
echo "Installing nginx configuration..."
run_gcloud_ssh "sudo mv /tmp/$DOMAIN /etc/nginx/sites-available/$DOMAIN" "Installing nginx configuration" || exit 1

# Remove default nginx site if it exists
run_gcloud_ssh "sudo rm -f /etc/nginx/sites-enabled/default" "Removing default nginx site" || true

# Enable site if not already enabled
echo "Enabling nginx site..."
run_gcloud_ssh "sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN" "Enabling nginx site" || exit 1

# Test nginx configuration
echo "Testing nginx configuration..."
if ! run_gcloud_ssh "sudo nginx -t" "Testing nginx configuration"; then
    echo "ERROR: nginx configuration test failed!"
    exit 1
fi

# Restart nginx
echo "Restarting nginx..."
run_gcloud_ssh "sudo systemctl restart nginx" "Restarting nginx" || exit 1

echo ""
echo "Nginx configuration deployed successfully!"
echo ""
echo "Note: If SSL certificates are not yet set up, run: ./setup-ssl.sh"
