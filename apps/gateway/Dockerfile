FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY apps/gateway/package.json ./apps/gateway/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/utils/package.json ./packages/utils/
COPY services/router/package.json ./services/router/
COPY services/adapters/package.json ./services/adapters/
COPY services/registry/package.json ./services/registry/

RUN npm install --workspace=@dmr-x/gateway

# Copy source
COPY . .

# Build
RUN npm run build --workspace=@dmr-x/gateway

# Production
FROM node:20-alpine AS production
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=base /app/packages/core/dist ./packages/core/dist
COPY --from=base /app/packages/db/dist ./packages/db/dist
COPY --from=base /app/packages/utils/dist ./packages/utils/dist
COPY --from=base /app/services/router/dist ./services/router/dist
COPY --from=base /app/services/adapters/dist ./services/adapters/dist
COPY --from=base /app/services/registry/dist ./services/registry/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "apps/gateway/dist/main.js"]
