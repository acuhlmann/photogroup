#!/usr/bin/env bash

# Fix SSL certificate to include hackernews.photogroup.network subdomain
# This script expands the existing certificate to include the subdomain
# Run this script from your LOCAL machine (it uses gcloud to SSH into the VM)

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-215600
DOMAIN=photogroup.network
HACKERNEWS_SUBDOMAIN=hackernews.$DOMAIN
EMAIL=acuhlmann@gmail.com

echo "Fixing SSL certificate to include $HACKERNEWS_SUBDOMAIN"
echo "Project: $PROJECT"
echo "Instance: $INSTANCE"
echo "Zone: $ZONE"
echo ""

# Verify instance exists
if ! gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE &>/dev/null; then
    echo "ERROR: VM instance '$INSTANCE' not found in project '$PROJECT' zone '$ZONE'"
    exit 1
fi

# Function to run gcloud commands and ignore metadata update warnings
run_gcloud_ssh() {
    local cmd="$1"
    local description="$2"
    local temp_output
    local exit_code
    
    temp_output=$(gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "$cmd" 2>&1)
    exit_code=$?
    
    echo "$temp_output" | grep -v "^Updating project ssh metadata\.\.\." | grep -v "^Updating instance ssh metadata\.\.\." | grep -v "^\.$" | grep -v "^done\.$" || true
    
    if [ $exit_code -ne 0 ]; then
        echo "ERROR: $description failed (exit code: $exit_code)"
        return $exit_code
    fi
    return 0
}

# Check current certificate domains
echo "Checking current certificate configuration..."
run_gcloud_ssh "sudo certbot certificates" "Checking certificates"

# Expand certificate to include the subdomain
echo ""
echo "Expanding certificate to include $HACKERNEWS_SUBDOMAIN..."
echo "This will add the subdomain to the existing certificate..."
if ! run_gcloud_ssh "sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN -d $HACKERNEWS_SUBDOMAIN --non-interactive --agree-tos --email $EMAIL --expand" "Expanding certificate"; then
    echo ""
    echo "Certificate expansion failed. Attempting to delete and recreate certificate..."
    echo "Deleting existing certificate..."
    run_gcloud_ssh "sudo certbot delete --cert-name $DOMAIN --non-interactive" "Deleting certificate" || true
    
    echo ""
    echo "Obtaining new certificate with all domains..."
    if ! run_gcloud_ssh "sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN -d $HACKERNEWS_SUBDOMAIN --non-interactive --agree-tos --email $EMAIL --redirect" "Obtaining new certificate"; then
        echo "ERROR: Failed to obtain certificate with all domains"
        exit 1
    fi
fi

# Verify certificate includes all domains
echo ""
echo "Verifying certificate includes all domains..."
CERT_OUTPUT=$(gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo certbot certificates" 2>&1 | grep -v "^Updating project ssh metadata\.\.\." | grep -v "^Updating instance ssh metadata\.\.\." | grep -v "^\.$" | grep -v "^done\.$" || true)
echo "$CERT_OUTPUT"

# Check if all domains are present
if ! echo "$CERT_OUTPUT" | grep -q "$DOMAIN"; then
    echo "ERROR: Certificate verification failed - $DOMAIN not found in certificate"
    exit 1
fi
if ! echo "$CERT_OUTPUT" | grep -q "www.$DOMAIN"; then
    echo "ERROR: Certificate verification failed - www.$DOMAIN not found in certificate"
    exit 1
fi
if ! echo "$CERT_OUTPUT" | grep -q "$HACKERNEWS_SUBDOMAIN"; then
    echo "ERROR: Certificate verification failed - $HACKERNEWS_SUBDOMAIN not found in certificate"
    exit 1
fi
echo "✓ Certificate verified: includes $DOMAIN, www.$DOMAIN, and $HACKERNEWS_SUBDOMAIN"

# Test nginx configuration
echo ""
echo "Testing nginx configuration..."
if ! run_gcloud_ssh "sudo nginx -t" "Testing nginx configuration"; then
    echo "ERROR: nginx configuration test failed!"
    exit 1
fi

# Reload nginx
echo ""
echo "Reloading nginx..."
run_gcloud_ssh "sudo systemctl reload nginx" "Reloading nginx" || exit 1

echo ""
echo "SSL certificate fix complete!"
echo "The certificate should now include:"
echo "  - $DOMAIN"
echo "  - www.$DOMAIN"
echo "  - $HACKERNEWS_SUBDOMAIN"
echo ""
echo "You can verify by checking: https://$HACKERNEWS_SUBDOMAIN"

