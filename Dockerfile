# ──────────────────────────────────────────────
# Build stage
# ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace config files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy all package.json files first (better Docker layer caching)
COPY packages/shared/package.json packages/shared/
COPY packages/stripe-mcp/package.json packages/stripe-mcp/
COPY gateway/package.json gateway/
COPY dashboard/package.json dashboard/

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci

# Copy source code
COPY packages/shared/src/ packages/shared/src/
COPY packages/stripe-mcp/src/ packages/stripe-mcp/src/
COPY gateway/src/ gateway/src/
COPY dashboard/ dashboard/

# Build all packages in dependency order
RUN npx tsc -p packages/shared/tsconfig.json
RUN npx tsc -p packages/stripe-mcp/tsconfig.json
RUN npx tsc -p gateway/tsconfig.json

# ──────────────────────────────────────────────
# Runtime stage — minimal image
# ──────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /app/package.json ./

# Copy node_modules (keep only production deps to save space)
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/gateway /app/gateway
COPY --from=builder /app/dashboard /app/dashboard

# Expose the port Railway will route traffic to
EXPOSE 8080

# Run the gateway (serves MCP API + dashboard statics)
ENV PORT=8080
CMD ["node", "gateway/dist/index.js"]