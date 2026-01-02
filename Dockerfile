# Multi-stage build for PhotoGroup AI
# Stage 1: Build UI
FROM node:24-alpine AS ui-builder

WORKDIR /app/ui

# Copy UI package files
COPY ui/package*.json ./

# Install UI dependencies
RUN npm ci --legacy-peer-deps

# Copy UI source code
COPY ui/ ./

# Build UI
RUN npm run build

# Stage 2: Build server and copy UI
FROM node:24-alpine AS server-builder

WORKDIR /app

# Install build tools for native modules (wrtc, bittorrent-dht)
RUN apk add --no-cache python3 make g++

# Copy server package files
COPY server/package*.json ./

# Install server dependencies
RUN npm ci

# Copy server source code
COPY server/ ./

# Copy built UI from previous stage
COPY --from=ui-builder /app/ui/build ./ui

# Stage 3: Production runtime
FROM node:24-alpine

WORKDIR /app

# Install dumb-init and wget for proper signal handling and health checks
RUN apk add --no-cache dumb-init wget

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install build tools for native modules (needed for npm install)
RUN apk add --no-cache python3 make g++

# Copy server package files
COPY server/package*.json ./

# Install production dependencies only
# Native modules (wrtc, bittorrent-dht) will be built during install
RUN npm ci --omit=dev && \
    npm cache clean --force && \
    # Remove build tools to reduce image size (native modules are already built)
    apk del python3 make g++

# Copy server source code
COPY server/ ./

# Copy built UI from builder stage
COPY --from=server-builder /app/ui ./ui

# Create secret directory if it doesn't exist (for optional SSL validation file)
RUN mkdir -p secret

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8081

# Health check - check if server is responding
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8081/ || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["node", "app.js"]

