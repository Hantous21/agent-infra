# ──────────────────────────────────────────────
# Build stage
# ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace config
COPY package.json tsconfig.base.json ./

# Copy all packages
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src/ packages/shared/src/

COPY packages/stripe-mcp/package.json packages/stripe-mcp/
COPY packages/stripe-mcp/src/ packages/stripe-mcp/src/

COPY gateway/package.json gateway/
COPY gateway/src/ gateway/src/

COPY dashboard/ dashboard/

# Install dependencies for all workspaces
RUN npm install

# Build all packages
RUN npm run build -w packages/shared && \
    npm run build -w packages/stripe-mcp && \
    npm run build -w gateway

# ──────────────────────────────────────────────
# Runtime stage
# ──────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy built artifacts and node_modules from builder
COPY --from=builder /app/package.json /app/tsconfig.base.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/gateway ./gateway
COPY --from=builder /app/dashboard ./dashboard

# Expose the port the gateway runs on
EXPOSE 8080

# Run the gateway (which also serves the dashboard)
ENV PORT=8080
CMD ["node", "gateway/dist/index.js"]