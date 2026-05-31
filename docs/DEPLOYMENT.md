# Deployment

## Build

```bash
npm install
npm run build
```

The UI builds into `apps/gateway/public`. The gateway runs from `apps/gateway/dist/main.js`. The primary runtime is [Bun](https://bun.sh).

## Start

```bash
NODE_ENV=production npm run start
```

Set provider keys and admin credentials through the production secret manager. Do not bake `.env` into container images.

## Docker

The root `Dockerfile` and `docker-compose.yml` provide container-oriented entry points. Review environment values before production use.

## Verification

```bash
npm run test
npm run build
```

After deployment, check:

- `GET /health`
- `GET /healthz`
- `GET /ready`
- `GET /v1/models`
