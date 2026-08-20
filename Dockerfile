# syntax=docker/dockerfile:1.7
# ─── Build Stage ─────────────────────────────────────────────────────────────
# Multi-stage build for the DMR-X gateway. The runtime image is built
# from the compiled JS in dist/ — no TypeScript, no devDependencies,
# no source maps in production.
#
# Build:
#   docker build -t dmr-x:local .
#
# Build a single-arch binary (no Node/Bun runtime needed in image):
#   docker build -t dmr-x:local --build-arg BUILD_MODE=binary .
#
# Build multi-arch and push:
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/danny-dis/dmr-x:0.5.7 --push .
#
# Image layers (in order of size, smallest at the top):
#   1. Bun runtime (~80 MB)
#   2. Production node_modules (~150 MB)
#   3. Compiled JS (~5 MB)
#   4. UI static files (~3 MB)

ARG BUN_VERSION=1.3.14
ARG BUILD_MODE=node  # node | binary

FROM oven/bun:${BUN_VERSION}-alpine AS builder

WORKDIR /app

# Copy lockfile + manifests first so this layer caches when only source changes.
COPY package.json turbo.json bun.lock ./
COPY packages/ packages/
COPY services/ services/
COPY apps/ apps/
COPY scripts/ scripts/
COPY tsconfig.json ./

# Install all dependencies (frozen lockfile for reproducible builds)
RUN bun install --frozen-lockfile

# Build all workspace packages. Turbo picks up the dependency order from
# the workspace's `turbo.json` and only rebuilds what changed.
RUN bun run build

# Build the UI separately — it's slow and benefits from its own cache layer
# when only the gateway code changes.
RUN bun run build:ui

# For binary mode, compile the gateway into a single executable so the
# runtime image doesn't need a Bun runtime at all.
FROM builder AS binary-builder
ARG TARGETARCH=amd64
WORKDIR /app/apps/gateway
RUN bun build --compile \
      --target=bun-${TARGETARCH}-linux \
      --outfile=/out/dmrx \
      src/main.ts
# Bundle the UI next to the binary so fastifyStatic can find it
RUN mkdir -p /out/public && cp -r public/* /out/public/ 2>/dev/null || true

# ─── Production Stage (Node mode) ──────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-alpine AS production-node

# OCI labels — picked up by `docker inspect`, GitHub container registry,
# and SBOM generators.
LABEL org.opencontainers.image.title="DMR-X Gateway" \
      org.opencontainers.image.description="Universal AI routing and orchestration platform" \
      org.opencontainers.image.source="https://github.com/danny-dis/dmr-X" \
      org.opencontainers.image.licenses="GPL-2.0" \
      org.opencontainers.image.vendor="DMR-X"

# Install wget for HEALTHCHECK (Alpine ships curl too but wget has nicer
# exit codes when the server is overloaded)
RUN apk add --no-cache wget tini

# Create a non-root user with a fixed UID so it can be mapped to a
# host user in docker-compose / k8s without surprises.
RUN addgroup -g 1001 -S dmrx \
 && adduser -S dmrx -u 1001 -G dmrx \
 && mkdir -p /home/dmrx/.dmr-x /app/data \
 && chown -R dmrx:dmrx /home/dmrx /app

WORKDIR /app

# Copy package manifests for production install
COPY package.json bun.lock ./
COPY packages/ packages/
COPY services/ services/
COPY apps/ apps/

# Install production dependencies only. Prunes devDependencies so the
# final image doesn't carry test frameworks, type definitions, etc.
RUN bun install --frozen-lockfile --production

# Copy built artifacts from the builder stage
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services ./services
COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder /app/apps/gateway/public ./apps/gateway/public

ENV NODE_ENV=production \
    PORT=3000 \
    DMRX_DATA_DIR=/app/data \
    DMRX_UI_DIR=/app/apps/gateway/public

# Drop privileges. tini reaps zombie processes (PID 1 must wait on
# children, and Bun's process model doesn't do that itself).
USER dmrx

EXPOSE 3000

# tini (PID 1) → bun → gateway. The Tini wrapper forwards signals
# (SIGTERM, SIGINT) so `docker stop` triggers the gateway's graceful
# 30s shutdown instead of a hard kill.
ENTRYPOINT ["/sbin/tini", "--"]

# /healthz is a deep check that returns 503 if SQLite or candidates
# are unhealthy. Interval=30s, timeout=5s, start_period=15s (DB init).
# retries=3 means we only mark unhealthy after 3 consecutive failures.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/healthz || exit 1

CMD ["bun", "apps/gateway/dist/main.js"]

# ─── Production Stage (Binary mode) ─────────────────────────────────────────
# A single static executable plus the UI assets. Smaller than node mode
# (no Bun runtime, no node_modules) but slower to build.
# Binary is compiled on Alpine (musl), so the runtime must be musl too.
# distroless/static-debian12 is glibc and lacks the musl loader, so the
# binary fails with ENOENT. Alpine provides /lib/ld-musl-x86_64.so.1.
FROM alpine:3.20 AS production-binary

# The bun-compiled binary needs the C++ runtime (libstdc++ + libgcc_s) at
# runtime even on musl; bare alpine lacks them, causing "Error relocating
# ... symbol not found" on exec.
RUN apk add --no-cache libgcc libstdc++

RUN addgroup -g 65532 -S nonroot && adduser -S nonroot -u 65532 -G nonroot

LABEL org.opencontainers.image.title="DMR-X Gateway (binary)" \
      org.opencontainers.image.description="Universal AI routing and orchestration platform — single static binary" \
      org.opencontainers.image.source="https://github.com/danny-dis/dmr-X" \
      org.opencontainers.image.licenses="GPL-2.0" \
      org.opencontainers.image.vendor="DMR-X"

WORKDIR /app
COPY --from=binary-builder --chown=nonroot:nonroot /out/dmrx /usr/local/bin/dmrx
COPY --from=binary-builder --chown=nonroot:nonroot /out/public /app/public
# bun-compiled binary resolves runtime assets (e.g. sql.js wasm) from
# /app/node_modules/.bun/..., so the install cache must ship with it.
# Copy only the sql.js package the binary actually asked for — not the
# whole node_modules or .bun cache (both wedge the build under low RAM).
COPY --from=builder --chown=nonroot:nonroot /app/node_modules/.bun/sql.js@1.14.1 /app/node_modules/.bun/sql.js@1.14.1

ENV NODE_ENV=production \
    PORT=3000 \
    DMRX_DATA_DIR=/app/data \
    DMRX_UI_DIR=/app/public

EXPOSE 3000

USER nonroot

CMD ["/usr/local/bin/dmrx"]
