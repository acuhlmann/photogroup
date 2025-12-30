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
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "rm -rf ~/pg" || true

# Create deployment directory
echo "Creating deployment directory..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "mkdir -p ~/pg"

# Upload application files
echo "Uploading application files..."
gcloud compute scp --recurse ./bin/* $INSTANCE:~/pg/ --project $PROJECT --zone $ZONE

# Stop any existing processes on ports 8081 and 9000
echo "Stopping existing processes..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo lsof -ti:8081 | sudo xargs kill -9 2>/dev/null || true"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo lsof -ti:9000 | sudo xargs kill -9 2>/dev/null || true"

# Install dependencies
echo "Installing dependencies..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "cd ~/pg && npm install --production"

# Stop and remove existing PM2 process
echo "Stopping existing PM2 process..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo pm2 stop app 2>/dev/null || true"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo pm2 delete app 2>/dev/null || true"

# Start application with PM2
echo "Starting application with PM2..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "cd ~/pg && sudo pm2 start app.js --name app"

# Save PM2 configuration
echo "Saving PM2 configuration..."
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo pm2 save"

echo ""
echo "Application deployed successfully!"
echo "Check status with: gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command 'sudo pm2 list'"
