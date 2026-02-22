# Causantic Docker Image
# Multi-stage build for optimal size

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Install native module build dependencies (better-sqlite3)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY src/dashboard/client/package*.json ./src/dashboard/client/

# Install Node dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY config.schema.json ./
COPY src ./src

# Build TypeScript + dashboard client
RUN npm run build

# Stage 2: Production
FROM node:20-slim

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy config schema
COPY config.schema.json ./

# Create data directory
RUN mkdir -p /data/causantic

# Set environment variables
ENV CAUSANTIC_STORAGE_DB_PATH=/data/causantic/memory.db
ENV CAUSANTIC_STORAGE_VECTOR_PATH=/data/causantic/vectors
ENV CAUSANTIC_LLM_ENABLE_LABELLING=false
ENV NODE_ENV=production

# Expose ports: MCP stdio (default), dashboard HTTP
EXPOSE 3000 3333

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "import('./dist/storage/db.js').then(m => m.getDb().prepare('SELECT 1').get())" || exit 1

# Default command: start MCP server
CMD ["node", "dist/cli/index.js", "serve"]
