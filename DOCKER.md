# Docker Setup for PhotoGroup AI

This document explains how to build and run PhotoGroup AI using Docker.

## Prerequisites

- Docker (version 20.10 or later)
- Docker Compose (version 2.0 or later)

## Quick Start

### Production Build

Build and run the production container:

```bash
# Build the image
docker build -t photogroup-ai .

# Run the container
docker run -d -p 8081:8081 --name photogroup-app photogroup-ai
```

Or use Docker Compose:

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Development Mode

For development with hot-reloading:

```bash
# Build and start development container
docker-compose -f docker-compose.dev.yml up

# Or in detached mode
docker-compose -f docker-compose.dev.yml up -d
```

The development setup:
- Mounts source code for hot-reloading
- Exposes both server (8081) and UI dev server (3000)
- Runs both server and UI in development mode

## Configuration

### Environment Variables

You can configure the application using environment variables:

- `PORT`: Server port (default: 8081)
- `NODE_ENV`: Environment mode (production/development)

Example:

```bash
docker run -d -p 8081:8081 \
  -e PORT=8081 \
  -e NODE_ENV=production \
  --name photogroup-app \
  photogroup-ai
```

Or in `docker-compose.yml`:

```yaml
environment:
  - PORT=8081
  - NODE_ENV=production
```

### Ports

- **8081**: Main server port (production)
- **3000**: Vite dev server (development only)

## Docker Images

### Production Image (`Dockerfile`)

Multi-stage build that:
1. Builds the UI React application
2. Installs server dependencies
3. Copies built UI to server
4. Creates optimized production image

**Image size**: ~200-300MB (alpine-based)

### Development Image (`Dockerfile.dev`)

Single-stage build for development:
- Includes all dependencies
- Supports hot-reloading via volume mounts
- Larger image size but faster iteration

## Building

### Build Production Image

```bash
docker build -t photogroup-ai:latest .
```

### Build with Tag

```bash
docker build -t photogroup-ai:v1.0.0 .
```

### Build Development Image

```bash
docker build -f Dockerfile.dev -t photogroup-ai:dev .
```

## Running

### Production

```bash
# Run container
docker run -d \
  --name photogroup-app \
  -p 8081:8081 \
  photogroup-ai

# View logs
docker logs -f photogroup-app

# Stop container
docker stop photogroup-app

# Remove container
docker rm photogroup-app
```

### Development

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up

# Access:
# - Server: http://localhost:8081
# - UI Dev Server: http://localhost:3000
```

## Docker Compose

### Production

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Rebuild and start
docker-compose up -d --build

# View logs
docker-compose logs -f
```

### Development

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up

# Stop
docker-compose -f docker-compose.dev.yml down
```

## Troubleshooting

### Container won't start

Check logs:

```bash
docker logs photogroup-app
```

### Port already in use

Change the port mapping:

```bash
docker run -d -p 8082:8081 --name photogroup-app photogroup-ai
```

### Permission issues

The container runs as non-root user (`nodejs`). If you need to debug:

```bash
# Run as root (not recommended for production)
docker run -d -p 8081:8081 --user root --name photogroup-app photogroup-ai
```

### Clear Docker cache

If you encounter build issues:

```bash
# Remove all build cache
docker builder prune -a

# Rebuild without cache
docker build --no-cache -t photogroup-ai .
```

## Health Checks

The production container includes a health check that verifies the server is responding. Check health status:

```bash
docker ps
# Look for "healthy" status

# Or inspect health
docker inspect --format='{{.State.Health.Status}}' photogroup-app
```

## Security

- Container runs as non-root user (`nodejs`)
- Uses Alpine Linux for smaller attack surface
- Only production dependencies in final image
- No development tools in production image

## Volumes

For development, the following volumes are mounted:
- `./server:/app/server` - Server source code
- `./ui:/app/ui` - UI source code
- `./package.json:/app/package.json` - Root package.json

Node modules are excluded from volume mounts to use container's installed dependencies.

## Networking

The application uses a Docker network (`photogroup-network`) for service isolation. Services can communicate using service names.

## Production Deployment

### GCP VM Deployment

The Dockerized app is fully compatible with the GCP VM setup. Use the deployment script:

```bash
# Set Twilio credentials (optional)
export TWILIO_ACCOUNT_SID="your_account_sid"
export TWILIO_AUTH_TOKEN="your_auth_token"

# Deploy to GCP VM
./deploy-docker.sh
```

The container will:
- Bind to `127.0.0.1:8081` and `127.0.0.1:9000` (localhost only, for nginx)
- Work with the existing nginx configuration
- Automatically restart on failure

**Note**: The VM must have Docker installed (done automatically by `create-vm.sh`).

### Other Platforms

For other hosting platforms:

1. Build the image:
   ```bash
   docker build -t photogroup-ai:latest .
   ```

2. Tag for registry:
   ```bash
   docker tag photogroup-ai:latest your-registry/photogroup-ai:latest
   ```

3. Push to registry:
   ```bash
   docker push your-registry/photogroup-ai:latest
   ```

4. Deploy to your hosting platform (AWS ECS, Google Cloud Run, etc.)

**Important**: Ensure both ports 8081 (HTTP) and 9000 (WebSocket) are exposed and accessible.

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

