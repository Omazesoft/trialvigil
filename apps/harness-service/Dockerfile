# TrialVigil harness service — local / Cloud Run image.
# SPDX-License-Identifier: Apache-2.0
#
# Build from the repo root (this is what infra/docker-compose.yml does):
#   docker build -f apps/harness-service/Dockerfile .
#
# Notes:
# - The service binds HOST (default 127.0.0.1 in code). Inside a container it
#   must listen on 0.0.0.0, or Docker's port mapping cannot reach it — hence
#   the ENV below. Do not "fix" this by editing the default in index.ts;
#   local runs still want loopback.
# - The file store resolves data/ relative to the working directory
#   (apps/harness-service/src/store.ts), so the data volume must be mounted
#   at /app/data, not /data. data/seed is copied in so demo samples exist.
# - No secrets are baked in: the NVIDIA/OpenAI key, if used, comes from the
#   environment at run time (see infra/.env.example). Never COPY infra/.env.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/harness-service ./apps/harness-service
COPY packages ./packages
COPY data ./data
RUN npm ci --ignore-scripts && npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/harness-service/dist ./apps/harness-service/dist
COPY --from=build /app/packages ./packages
COPY --from=build /app/data/seed ./data/seed
RUN mkdir -p /app/data /app/.openworker-state && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "apps/harness-service/dist/index.js"]
