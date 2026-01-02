# Test script for Docker build
# Run this script to test if the Docker setup works

Write-Host "Testing Docker build for PhotoGroup AI..." -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "1. Checking Docker daemon..." -ForegroundColor Yellow
try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker daemon is not running. Please start Docker Desktop." -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Docker daemon is running" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Docker is not available. Please install Docker Desktop." -ForegroundColor Red
    exit 1
}

# Clean up any existing test containers/images
Write-Host ""
Write-Host "2. Cleaning up any existing test containers/images..." -ForegroundColor Yellow
docker stop photogroup-test 2>$null
docker rm photogroup-test 2>$null
docker rmi photogroup-ai:test 2>$null
Write-Host "✓ Cleanup complete" -ForegroundColor Green

# Build the image
Write-Host ""
Write-Host "3. Building Docker image (this may take several minutes)..." -ForegroundColor Yellow
$buildStart = Get-Date
docker build -t photogroup-ai:test .
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker build failed!" -ForegroundColor Red
    exit 1
}
$buildEnd = Get-Date
$buildTime = ($buildEnd - $buildStart).TotalSeconds
Write-Host "✓ Build completed in $([math]::Round($buildTime, 2)) seconds" -ForegroundColor Green

# Run the container
Write-Host ""
Write-Host "4. Starting container..." -ForegroundColor Yellow
docker run -d --name photogroup-test -p 8081:8081 photogroup-ai:test
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start container!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Container started" -ForegroundColor Green

# Wait for server to start
Write-Host ""
Write-Host "5. Waiting for server to start (10 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check if container is running
Write-Host ""
Write-Host "6. Checking container status..." -ForegroundColor Yellow
$containerStatus = docker ps --filter "name=photogroup-test" --format "{{.Status}}"
if ($containerStatus) {
    Write-Host "✓ Container is running: $containerStatus" -ForegroundColor Green
} else {
    Write-Host "ERROR: Container is not running!" -ForegroundColor Red
    Write-Host "Container logs:" -ForegroundColor Yellow
    docker logs photogroup-test
    exit 1
}

# Test HTTP endpoint
Write-Host ""
Write-Host "7. Testing HTTP endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8081" -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✓ Server is responding (HTTP $($response.StatusCode))" -ForegroundColor Green
    } else {
        Write-Host "WARNING: Server responded with status $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "WARNING: Could not connect to server: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Container logs:" -ForegroundColor Yellow
    docker logs photogroup-test
}

# Show container info
Write-Host ""
Write-Host "8. Container information:" -ForegroundColor Yellow
docker ps --filter "name=photogroup-test"
Write-Host ""
Write-Host "Container logs (last 20 lines):" -ForegroundColor Yellow
docker logs --tail 20 photogroup-test

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✓ Docker image built successfully" -ForegroundColor Green
Write-Host "✓ Container is running" -ForegroundColor Green
Write-Host ""
Write-Host "Access the application at: http://localhost:8081" -ForegroundColor Cyan
Write-Host ""
Write-Host "To stop the container:" -ForegroundColor Yellow
Write-Host "  docker stop photogroup-test" -ForegroundColor White
Write-Host ""
Write-Host "To remove the container:" -ForegroundColor Yellow
Write-Host "  docker rm photogroup-test" -ForegroundColor White
Write-Host ""
Write-Host "To view logs:" -ForegroundColor Yellow
Write-Host "  docker logs -f photogroup-test" -ForegroundColor White
Write-Host ""

