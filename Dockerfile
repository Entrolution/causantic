# Entropic Causal Memory Docker Image
# Multi-stage build for optimal size

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip3 install --break-system-packages hdbscan numpy

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Python HDBSCAN (minimal install)
RUN pip3 install --break-system-packages hdbscan numpy

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy config schema
COPY config.schema.json ./

# Create data directory
RUN mkdir -p /data/ecm

# Set environment variables
ENV ECM_STORAGE_DB_PATH=/data/ecm/memory.db
ENV ECM_STORAGE_VECTOR_PATH=/data/ecm/vectors
ENV NODE_ENV=production

# Expose MCP server port (if using HTTP mode)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('./dist/storage/db.js').getDatabase().prepare('SELECT 1').get()" || exit 1

# Default command: start MCP server
CMD ["node", "dist/cli/index.js", "serve"]
