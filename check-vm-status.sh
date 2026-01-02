#!/usr/bin/env bash

# Diagnostic script to check VM status and troubleshoot deployment issues

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-215600

echo "=========================================="
echo "PhotoGroup VM Diagnostic Check"
echo "=========================================="
echo "Project: $PROJECT"
echo "Instance: $INSTANCE"
echo "Zone: $ZONE"
echo ""

# Function to run gcloud commands and ignore metadata update warnings
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

echo "1. Checking VM instance status..."
if ! gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE --format="get(status)" 2>/dev/null | grep -q "RUNNING"; then
    echo "❌ ERROR: VM instance is not running!"
    exit 1
fi
echo "✅ VM is running"
echo ""

echo "2. Checking external IP address..."
EXTERNAL_IP=$(gcloud compute instances describe $INSTANCE --project $PROJECT --zone $ZONE --format="get(networkInterfaces[0].accessConfigs[0].natIP)" 2>/dev/null | tr -d '\r\n')
if [ -z "$EXTERNAL_IP" ]; then
    echo "❌ ERROR: Could not retrieve external IP"
else
    echo "✅ External IP: $EXTERNAL_IP"
    echo "   (Verify DNS points photogroup.network to this IP)"
fi
echo ""

echo "3. Checking nginx status..."
run_gcloud_ssh "sudo systemctl status nginx --no-pager -l" "Checking nginx status" || true
echo ""

echo "4. Checking nginx configuration..."
run_gcloud_ssh "sudo nginx -t" "Testing nginx configuration" || true
echo ""

echo "5. Checking if nginx is listening on ports 80 and 443..."
run_gcloud_ssh "sudo netstat -tlnp | grep -E ':(80|443)' || sudo ss -tlnp | grep -E ':(80|443)'" "Checking nginx ports" || true
echo ""

echo "6. Checking nginx site configuration..."
run_gcloud_ssh "ls -la /etc/nginx/sites-enabled/" "Listing nginx sites" || true
echo ""

echo "7. Checking if app is running on port 8081..."
run_gcloud_ssh "sudo netstat -tlnp | grep :8081 || sudo ss -tlnp | grep :8081 || (sudo lsof -i :8081 2>/dev/null || echo 'No process on port 8081')" "Checking port 8081" || true
echo ""

echo "8. Checking if WebSocket tracker is running on port 9000..."
run_gcloud_ssh "sudo netstat -tlnp | grep :9000 || sudo ss -tlnp | grep :9000 || (sudo lsof -i :9000 2>/dev/null || echo 'No process on port 9000')" "Checking port 9000" || true
echo ""

echo "9. Checking PM2 status..."
run_gcloud_ssh "sudo pm2 list" "Checking PM2 processes" || true
echo ""

echo "10. Checking PM2 logs (last 20 lines)..."
run_gcloud_ssh "sudo pm2 logs app --lines 20 --nostream" "Checking PM2 logs" || true
echo ""

echo "11. Checking Docker containers (if using Docker deployment)..."
run_gcloud_ssh "docker ps -a" "Checking Docker containers" || true
echo ""

echo "12. Checking if app files exist..."
run_gcloud_ssh "ls -la ~/pg/ 2>/dev/null || echo '~/pg directory does not exist'" "Checking app directory" || true
echo ""

echo "13. Checking Node.js version..."
run_gcloud_ssh "node --version" "Checking Node.js version" || true
echo ""

echo "14. Testing local connectivity to app..."
run_gcloud_ssh "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/ || echo 'Failed to connect'" "Testing local app connection" || true
echo ""

echo "15. Checking firewall rules..."
gcloud compute firewall-rules list --project $PROJECT --filter="name~allow" --format="table(name,direction,allowed[].map().firewall_rule().list():label=ALLOW,targetTags.list():label=TARGET_TAGS)" 2>/dev/null || true
echo ""

echo "16. Checking recent nginx error logs..."
run_gcloud_ssh "sudo tail -20 /var/log/nginx/error.log 2>/dev/null || echo 'No error log found'" "Checking nginx errors" || true
echo ""

echo "17. Checking recent nginx access logs..."
run_gcloud_ssh "sudo tail -10 /var/log/nginx/access.log 2>/dev/null || echo 'No access log found'" "Checking nginx access" || true
echo ""

echo "=========================================="
echo "Diagnostic check complete!"
echo "=========================================="
echo ""
echo "Common issues to check:"
echo "1. If nginx is not running: sudo systemctl start nginx"
echo "2. If PM2 app is not running: sudo pm2 restart app"
echo "3. If ports are not listening: Check if app started correctly"
echo "4. If DNS is not configured: Point photogroup.network A record to $EXTERNAL_IP"
echo "5. If SSL is not set up: Run ./setup-ssl.sh"
echo ""

