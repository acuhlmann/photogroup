#!/usr/bin/env bash

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-215600

echo "Deploying application to VM..."
echo "Project: $PROJECT"
echo "Instance: $INSTANCE"
echo "Zone: $ZONE"
echo ""

# Verify instance exists
if ! gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE &>/dev/null; then
    echo "ERROR: VM instance '$INSTANCE' not found in project '$PROJECT' zone '$ZONE'"
    echo "Create the VM first using: ./create-vm.sh"
    exit 1
fi

# Clean up old deployment directory
echo "Cleaning up old deployment..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "rm -rf ~/pg" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

# Create deployment directory
echo "Creating deployment directory..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "mkdir -p ~/pg" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

# Upload application files
echo "Uploading application files..."
gcloud compute scp --recurse ./bin/* $INSTANCE:~/pg/ --project $PROJECT --zone $ZONE 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

# Stop any existing processes on ports 8081 and 9000
echo "Stopping existing processes..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo lsof -ti:8081 | sudo xargs kill -9 2>/dev/null || true" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo lsof -ti:9000 | sudo xargs kill -9 2>/dev/null || true" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

# Check and update Node.js version if needed (requires >=24.0.0)
echo "Checking Node.js version..."
NODE_VERSION_OUTPUT=$(gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "node --version" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" | grep -E "^v[0-9]" | head -1)
CURRENT_NODE_MAJOR=$(echo "$NODE_VERSION_OUTPUT" | sed 's/v//' | cut -d. -f1)
if [ -z "$CURRENT_NODE_MAJOR" ] || [ "$CURRENT_NODE_MAJOR" -lt 24 ]; then
    echo "Updating Node.js to version 24..."
    gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt-get install -y nodejs" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true
    echo "Node.js updated. New version:"
    gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "node --version" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" | grep -E "^v[0-9]+\.[0-9]+\.[0-9]+" || true
else
    echo "Node.js version is $NODE_VERSION_OUTPUT (OK)"
fi

# Install dependencies
echo "Installing dependencies..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "cd ~/pg && npm install --production" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

# Stop and remove existing PM2 process
echo "Stopping existing PM2 process..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo pm2 stop app 2>/dev/null || true" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo pm2 delete app 2>/dev/null || true" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

# Start application with PM2
echo "Starting application with PM2..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "cd ~/pg && sudo pm2 start app.js --name app" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

# Save PM2 configuration
echo "Saving PM2 configuration..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo pm2 save" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

echo ""
echo "Application deployed successfully!"
echo "Check status with: gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command 'sudo pm2 list'"
