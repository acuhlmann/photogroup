#!/usr/bin/env bash

# Script to create and configure GCP VM instance for PhotoGroup
# This creates an e2-micro VM with necessary firewall rules and static IP

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-215600
MACHINE_TYPE=e2-micro
IMAGE_FAMILY=ubuntu-2204-lts
IMAGE_PROJECT=ubuntu-os-cloud
DISK_SIZE=10GB

# Extract region from zone (asia-east2-a -> asia-east2)
# Using bash parameter expansion: remove shortest match of -[a-z] from end
REGION="${ZONE%-*}"

# Function to filter Python warnings from Windows output
filter_python_warnings() {
    grep -v "Python was not found" | grep -v "^$" || cat
}

echo "Creating VM instance for PhotoGroup..."
echo "Project: $PROJECT"
echo "Instance: $INSTANCE"
echo "Zone: $ZONE"
echo "Machine Type: $MACHINE_TYPE"
echo ""

# Check if instance already exists
if gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE 2>/dev/null >/dev/null; then
    echo "WARNING: VM instance '$INSTANCE' already exists in project '$PROJECT' zone '$ZONE'"
    echo "Skipping VM creation. If you want to recreate it, delete it first with:"
    echo "  gcloud compute instances delete $INSTANCE --project $PROJECT --zone $ZONE"
    echo ""
    read -p "Do you want to continue with setup? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    # Create static IP address
    echo "Creating static IP address..."
    echo "Region: $REGION"
    
    # First, try to check if IP exists and get it
    STATIC_IP=$(gcloud compute addresses describe $INSTANCE-ip --project $PROJECT --region $REGION --format="value(address)" 2>/dev/null | tr -d '\r\n ')
    
    if [ -n "$STATIC_IP" ]; then
        echo "Static IP already exists."
    else
        echo "Creating new static IP address..."
        CREATE_IP_OUTPUT=$(gcloud compute addresses create $INSTANCE-ip \
            --project $PROJECT \
            --region $REGION \
            --description "Static IP for PhotoGroup VM" 2>&1)
        CREATE_IP_EXIT=$?
        echo "$CREATE_IP_OUTPUT" | filter_python_warnings
        
        # Exit code 49 means "already exists" - treat as success
        if [ $CREATE_IP_EXIT -ne 0 ] && [ $CREATE_IP_EXIT -ne 49 ]; then
            echo "ERROR: Failed to create static IP address (exit code: $CREATE_IP_EXIT)"
            echo "Full output:"
            echo "$CREATE_IP_OUTPUT" | filter_python_warnings
            exit 1
        fi
        
        if [ $CREATE_IP_EXIT -eq 49 ]; then
            echo "Static IP already exists (this is OK)."
        else
            echo "Static IP created."
        fi
        
        # Now retrieve the IP address
        STATIC_IP=$(gcloud compute addresses describe $INSTANCE-ip --project $PROJECT --region $REGION --format="value(address)" 2>/dev/null | tr -d '\r\n ')
    fi
    
    # If still empty, try alternative method: list and filter
    if [ -z "$STATIC_IP" ]; then
        echo "WARNING: Could not retrieve IP with describe, trying list method..."
        STATIC_IP=$(gcloud compute addresses list --project $PROJECT --filter="name=$INSTANCE-ip AND region:$REGION" --format="value(address)" 2>/dev/null | head -1 | tr -d '\r\n ')
    fi
    
    # Final check - if still empty, show error and debug info
    if [ -z "$STATIC_IP" ]; then
        echo "ERROR: Failed to retrieve static IP address"
        echo "Looking for IP named '$INSTANCE-ip' in region '$REGION'"
        echo "Attempting to list all addresses to debug..."
        gcloud compute addresses list --project $PROJECT --format="table(name,address,region)" 2>/dev/null || true
        exit 1
    fi
    echo "Static IP address: $STATIC_IP"
    echo ""
    echo "IMPORTANT: Update your DNS A record for photogroup.network to point to: $STATIC_IP"
    echo ""
    
    # Create firewall rules if they don't exist
    echo "Creating firewall rules..."
    
    # HTTP and HTTPS
    if ! gcloud compute firewall-rules describe allow-http-https --project $PROJECT 2>/dev/null >/dev/null; then
        gcloud compute firewall-rules create allow-http-https \
            --project $PROJECT \
            --allow tcp:80,tcp:443 \
            --source-ranges 0.0.0.0/0 \
            --description "Allow HTTP and HTTPS traffic"
        echo "Firewall rule 'allow-http-https' created."
    else
        echo "Firewall rule 'allow-http-https' already exists."
    fi
    
    # Application ports (8081 for Node.js, 9000 for BitTorrent tracker)
    if ! gcloud compute firewall-rules describe allow-app-ports --project $PROJECT 2>/dev/null >/dev/null; then
        gcloud compute firewall-rules create allow-app-ports \
            --project $PROJECT \
            --allow tcp:8081,tcp:9000,udp:9000 \
            --source-ranges 0.0.0.0/0 \
            --description "Allow PhotoGroup application ports"
        echo "Firewall rule 'allow-app-ports' created."
    else
        echo "Firewall rule 'allow-app-ports' already exists."
    fi
    
    # Create VM instance
    echo ""
    echo "Creating VM instance..."
    echo "This may take a few minutes..."
    
    # Create VM and capture both output and exit code
    VM_OUTPUT=$(gcloud compute instances create $INSTANCE \
        --project $PROJECT \
        --zone $ZONE \
        --machine-type=$MACHINE_TYPE \
        --image-family=$IMAGE_FAMILY \
        --image-project=$IMAGE_PROJECT \
        --boot-disk-size=$DISK_SIZE \
        --boot-disk-type=pd-standard \
        --address=$STATIC_IP \
        --tags=http-server,https-server \
        --metadata=startup-script='#!/bin/bash
        apt-get update
        apt-get install -y curl gnupg2 software-properties-common
        
        # Install Node.js 24.x LTS (latest stable LTS)
        curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
        apt-get install -y nodejs
        
        # Install PM2 globally
        npm install -g pm2
        
        # Install nginx
        apt-get install -y nginx
        
        # Enable nginx
        systemctl enable nginx
        
        # Install build tools (needed for native modules)
        apt-get install -y build-essential python3
        
        # Configure PM2 to start on boot
        pm2 startup systemd -u root --hp /root
        
        echo "VM setup complete!"
        ' 2>&1)
    VM_EXIT_CODE=$?
    
    # Filter Python warnings and display output
    echo "$VM_OUTPUT" | filter_python_warnings
    
    if [ $VM_EXIT_CODE -ne 0 ]; then
        echo ""
        echo "ERROR: Failed to create VM instance (exit code: $VM_EXIT_CODE)"
        echo "Check the error messages above for details."
        exit 1
    fi
    
    echo ""
    echo "VM instance created successfully!"
    echo ""
    echo "Waiting for VM to be ready (this may take a minute)..."
    sleep 30
    
    # Get the external IP - redirect stderr to /dev/null to avoid Python warnings
    EXTERNAL_IP=$(gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE --format="get(networkInterfaces[0].accessConfigs[0].natIP)" 2>/dev/null | tr -d '\r\n' | grep -E "^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$" | head -1)
    if [ -z "$EXTERNAL_IP" ]; then
        echo "WARNING: Could not retrieve external IP. It may still be provisioning."
        EXTERNAL_IP="(check in GCP console)"
    fi
    echo ""
    echo "=========================================="
    echo "VM Setup Complete!"
    echo "=========================================="
    echo "Instance Name: $INSTANCE"
    echo "Zone: $ZONE"
    echo "External IP: $EXTERNAL_IP"
    echo ""
    echo "NEXT STEPS:"
    echo "1. Update DNS: Point photogroup.network A record to: $EXTERNAL_IP"
    echo "2. Wait for DNS propagation (can take up to 48 hours, usually much faster)"
    echo "3. Run SSL setup: ./setup-ssl.sh"
    echo "4. Deploy application: ./deploy-all.sh"
    echo ""
fi

