#!/usr/bin/env bash

# Script to diagnose and fix common VM deployment issues

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-215600

echo "=========================================="
echo "PhotoGroup VM Deployment Fix Script"
echo "=========================================="
echo ""

# Function to run gcloud commands
run_gcloud_ssh() {
    local cmd="$1"
    local description="$2"
    local temp_output
    local exit_code
    
    temp_output=$(gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "$cmd" 2>&1)
    exit_code=$?
    
    echo "$temp_output" | grep -v "^Updating project ssh metadata\.\.\." | grep -v "^Updating instance ssh metadata\.\.\." | grep -v "^\.$" | grep -v "^done\.$" || true
    
    return $exit_code
}

echo "Step 1: Checking nginx status..."
if ! run_gcloud_ssh "sudo systemctl is-active nginx" "Checking nginx" >/dev/null 2>&1; then
    echo "⚠️  Nginx is not running. Starting nginx..."
    run_gcloud_ssh "sudo systemctl start nginx && sudo systemctl enable nginx" "Starting nginx" || {
        echo "❌ Failed to start nginx"
        exit 1
    }
    echo "✅ Nginx started"
else
    echo "✅ Nginx is running"
fi
echo ""

echo "Step 2: Checking nginx configuration..."
if ! run_gcloud_ssh "sudo nginx -t" "Testing nginx config" >/dev/null 2>&1; then
    echo "❌ Nginx configuration has errors!"
    run_gcloud_ssh "sudo nginx -t" "Showing nginx errors"
    echo ""
    echo "Attempting to deploy nginx config..."
    ./deploy-nginx.sh
else
    echo "✅ Nginx configuration is valid"
fi
echo ""

echo "Step 3: Checking if nginx site is enabled..."
if ! run_gcloud_ssh "test -f /etc/nginx/sites-enabled/photogroup.network" "Checking nginx site" >/dev/null 2>&1; then
    echo "⚠️  Nginx site not enabled. Deploying nginx configuration..."
    ./deploy-nginx.sh
else
    echo "✅ Nginx site is enabled"
fi
echo ""

echo "Step 4: Checking PM2 status..."
PM2_STATUS=$(run_gcloud_ssh "sudo pm2 list" "Checking PM2" 2>/dev/null | grep -E "app|online|stopped|errored" || echo "")
if echo "$PM2_STATUS" | grep -q "app.*online"; then
    echo "✅ PM2 app is running"
elif echo "$PM2_STATUS" | grep -q "app.*stopped\|app.*errored"; then
    echo "⚠️  PM2 app is stopped or errored. Restarting..."
    run_gcloud_ssh "cd ~/pg && sudo pm2 restart app || sudo pm2 start app.js --name app" "Restarting PM2 app"
    run_gcloud_ssh "sudo pm2 save" "Saving PM2 config"
elif [ -z "$PM2_STATUS" ] || ! echo "$PM2_STATUS" | grep -q "app"; then
    echo "⚠️  PM2 app not found. Starting app..."
    if run_gcloud_ssh "test -f ~/pg/app.js" "Checking app.js exists" >/dev/null 2>&1; then
        run_gcloud_ssh "cd ~/pg && sudo pm2 start app.js --name app" "Starting PM2 app"
        run_gcloud_ssh "sudo pm2 save" "Saving PM2 config"
    else
        echo "❌ App files not found in ~/pg. You may need to run: ./deploy-app.sh"
        exit 1
    fi
fi
echo ""

echo "Step 5: Checking if app is listening on port 8081..."
if ! run_gcloud_ssh "sudo lsof -i :8081 2>/dev/null || sudo netstat -tlnp 2>/dev/null | grep :8081 || sudo ss -tlnp 2>/dev/null | grep :8081" "Checking port 8081" >/dev/null 2>&1; then
    echo "⚠️  Nothing listening on port 8081. Checking PM2 logs..."
    run_gcloud_ssh "sudo pm2 logs app --lines 30 --nostream" "PM2 logs"
    echo ""
    echo "Attempting to restart app..."
    run_gcloud_ssh "cd ~/pg && sudo pm2 restart app || (sudo pm2 delete app 2>/dev/null; sudo pm2 start app.js --name app)" "Restarting app"
    sleep 3
    if ! run_gcloud_ssh "sudo lsof -i :8081 2>/dev/null" "Rechecking port 8081" >/dev/null 2>&1; then
        echo "❌ App still not listening on port 8081. Check logs above for errors."
    fi
else
    echo "✅ App is listening on port 8081"
fi
echo ""

echo "Step 6: Checking if WebSocket tracker is listening on port 9000..."
if ! run_gcloud_ssh "sudo lsof -i :9000 2>/dev/null || sudo netstat -tlnp 2>/dev/null | grep :9000 || sudo ss -tlnp 2>/dev/null | grep :9000" "Checking port 9000" >/dev/null 2>&1; then
    echo "⚠️  Nothing listening on port 9000 (WebSocket tracker)"
    echo "   This might be OK if the app is still starting up"
else
    echo "✅ WebSocket tracker is listening on port 9000"
fi
echo ""

echo "Step 7: Testing local connectivity..."
HTTP_CODE=$(run_gcloud_ssh "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/ || echo '000'" "Testing local connection" 2>/dev/null | tail -1)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    echo "✅ App is responding locally (HTTP $HTTP_CODE)"
else
    echo "⚠️  App not responding locally (HTTP $HTTP_CODE)"
    echo "   Checking recent PM2 logs..."
    run_gcloud_ssh "sudo pm2 logs app --lines 20 --nostream" "Recent PM2 logs"
fi
echo ""

echo "Step 8: Checking nginx can reach the app..."
if run_gcloud_ssh "sudo curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/ || echo '000'" "Testing nginx->app" >/dev/null 2>&1 | grep -qE "200|301|302"; then
    echo "✅ Nginx can reach the app"
else
    echo "⚠️  Nginx cannot reach the app"
fi
echo ""

echo "Step 9: Restarting nginx to ensure it picks up any changes..."
run_gcloud_ssh "sudo systemctl restart nginx" "Restarting nginx" || true
echo ""

echo "Step 10: Final status check..."
echo ""
echo "PM2 Status:"
run_gcloud_ssh "sudo pm2 list" "PM2 status" || true
echo ""
echo "Nginx Status:"
run_gcloud_ssh "sudo systemctl status nginx --no-pager -l | head -10" "Nginx status" || true
echo ""
echo "Port Status:"
run_gcloud_ssh "echo 'Port 8081:'; sudo lsof -i :8081 2>/dev/null || echo '  Not listening'; echo 'Port 9000:'; sudo lsof -i :9000 2>/dev/null || echo '  Not listening'" "Port status" || true
echo ""

echo "=========================================="
echo "Fix script complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Check if the website is accessible: https://photogroup.network"
echo "2. If still not working, run: ./check-vm-status.sh for detailed diagnostics"
echo "3. Check PM2 logs: gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command 'sudo pm2 logs app'"
echo "4. Check nginx logs: gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command 'sudo tail -f /var/log/nginx/error.log'"
echo ""

