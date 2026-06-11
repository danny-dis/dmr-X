# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM oven/bun:1.2.0-alpine AS builder

WORKDIR /app

# Copy package files for all workspaces
COPY package.json turbo.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/utils/package.json packages/utils/
COPY packages/cli/package.json packages/cli/
COPY packages/plugin-loader/package.json packages/plugin-loader/
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
COPY services/workers/package.json services/workers/
COPY services/sandbox/package.json services/sandbox/
COPY services/memory/package.json services/memory/
COPY services/federation/package.json services/federation/
COPY services/oauth/package.json services/oauth/
COPY services/plugin-loader-bootstrap/package.json services/plugin-loader-bootstrap/
COPY apps/gateway/package.json apps/gateway/
COPY apps/ui/package.json apps/ui/

# Copy lockfile for reproducible installs
COPY bun.lock ./

# Install all dependencies (frozen lockfile for reproducible builds)
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY packages/ packages/
COPY services/ services/
COPY apps/gateway/ apps/gateway/
COPY apps/ui/ apps/ui/

# Build all workspace packages (turbo resolves dependency order via ^build)
RUN bun run build

# ─── Production Stage ────────────────────────────────────────────────────────
FROM oven/bun:1.2.0-alpine AS production

WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

# Copy package manifests for production install
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/utils/package.json packages/utils/
COPY packages/cli/package.json packages/cli/
COPY packages/plugin-loader/package.json packages/plugin-loader/
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
COPY services/workers/package.json services/workers/
COPY services/sandbox/package.json services/sandbox/
COPY services/memory/package.json services/memory/
COPY services/federation/package.json services/federation/
COPY services/oauth/package.json services/oauth/
COPY services/plugin-loader-bootstrap/package.json services/plugin-loader-bootstrap/
COPY apps/gateway/package.json apps/gateway/
COPY apps/ui/package.json apps/ui/

COPY bun.lock ./

# Install production dependencies only (prunes devDependencies)
RUN bun install --frozen-lockfile --production

# Copy built artifacts from builder
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services ./services
COPY --from=builder /app/apps/gateway ./apps/gateway

# Copy UI build from builder (built by turbo as part of @dmr-x/ui)
COPY --from=builder /app/apps/gateway/public ./apps/gateway/public

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user and ensure data directory is writable
RUN addgroup -g 1001 -S dmrx && adduser -S dmrx -u 1001 -G dmrx \
    && mkdir -p /home/dmrx/.dmr-x && chown -R dmrx:dmrx /home/dmrx/.dmr-x

EXPOSE 3000

USER dmrx

CMD ["bun", "apps/gateway/dist/main.js"]
