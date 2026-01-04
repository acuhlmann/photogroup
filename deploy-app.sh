#!/usr/bin/env bash

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-215600
# Use a fixed absolute path to avoid issues with different deploying users
APP_DIR=/opt/photogroup

echo "Deploying application to VM..."
echo "Project: $PROJECT"
echo "Instance: $INSTANCE"
echo "Zone: $ZONE"
echo "App directory: $APP_DIR"
echo ""

# Verify instance exists
if ! gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE &>/dev/null; then
    echo "ERROR: VM instance '$INSTANCE' not found in project '$PROJECT' zone '$ZONE'"
    echo "Create the VM first using: ./create-vm.sh"
    exit 1
fi

# Clean up old deployment directory and stop processes (combined for efficiency)
echo "Cleaning up old deployment and stopping processes..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "
  sudo rm -rf $APP_DIR && sudo mkdir -p $APP_DIR && sudo chmod 777 $APP_DIR
  sudo lsof -ti:8081 | sudo xargs kill -9 2>/dev/null || true
  sudo lsof -ti:9000 | sudo xargs kill -9 2>/dev/null || true
  sudo pm2 stop app 2>/dev/null || true
  sudo pm2 delete app 2>/dev/null || true
" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

# Upload application files with compression
echo "Uploading application files (this may take 1-2 minutes)..."
gcloud compute scp --recurse --compress ./bin/* $INSTANCE:$APP_DIR/ --project $PROJECT --zone $ZONE 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

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

# Install dependencies and start application (combined for efficiency)
echo "Installing dependencies and starting application..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "
  cd $APP_DIR
  npm install --production --prefer-offline --no-audit --no-fund
  
  # Stop and delete existing app to ensure clean restart
  sudo pm2 stop app 2>/dev/null || true
  sudo pm2 delete app 2>/dev/null || true
  
  # Start app using npm start (required for ES modules support)
  # PM2 has issues directly loading ES module files, so we use npm start
  cd $APP_DIR && sudo pm2 start npm --name app -- start
  sudo pm2 save
" 2>&1 | grep -v "^Updating project ssh metadata" | grep -v "^Updating instance ssh metadata" | grep -v "^\.$" | grep -v "^done\.$" || true

echo ""
echo "Application deployed successfully!"
echo "Check status with: gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command 'sudo pm2 list'"
