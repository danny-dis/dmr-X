# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for all workspaces
COPY package.json turbo.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/utils/package.json packages/utils/
COPY packages/cli/package.json packages/cli/
COPY services/router/package.json services/router/
COPY services/adapters/package.json services/adapters/
COPY services/registry/package.json services/registry/
COPY services/quota/package.json services/quota/
COPY services/policy/package.json services/policy/
COPY services/billing/package.json services/billing/
COPY services/benchmark/package.json services/benchmark/
COPY services/telemetry/package.json services/telemetry/
COPY services/mcp-client/package.json services/mcp-client/
COPY services/mcp-server/package.json services/mcp-server/
COPY apps/gateway/package.json apps/gateway/
COPY apps/ui/package.json apps/ui/

# Install dependencies
RUN npm install

# Copy source code
COPY tsconfig.json ./
COPY packages/ packages/
COPY services/ services/
COPY apps/gateway/ apps/gateway/
COPY apps/ui/ apps/ui/

# Build all workspace packages (turbo resolves dependency order via ^build)
RUN npm run build

# ─── Production Stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

# Copy built artifacts and node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services ./services
COPY --from=builder /app/apps/gateway ./apps/gateway
COPY --from=builder /app/package.json ./

# Copy UI build from builder (built by turbo as part of @dmr-x/ui)
COPY --from=builder /app/apps/gateway/public ./apps/gateway/public

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user and ensure data directory is writable
RUN addgroup -g 1001 -S dmrx && adduser -S dmrx -u 1001 -G dmrx \
    && mkdir -p /home/dmrx/.dmr-x && chown -R dmrx:dmrx /home/dmrx/.dmr-x

EXPOSE 3000

USER dmrx

CMD ["node", "apps/gateway/dist/main.js"]
