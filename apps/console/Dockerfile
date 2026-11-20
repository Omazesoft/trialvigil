# TrialVigil console — local / Cloud Run image.
# SPDX-License-Identifier: Apache-2.0
#
# Build from the repo root (this is what infra/docker-compose.yml does):
#   docker build -f apps/console/Dockerfile .
#
# The Vite dev server proxies /api and /health to the harness, but
# `vite preview` does not, so the runtime image serves the built UI with
# apps/console/server.mjs instead — it serves dist/ and proxies /api and
# /health to HARNESS_URL at run time.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/console ./apps/console
COPY packages ./packages
RUN npm ci --ignore-scripts && npm --workspace=@trialvigil/console run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HARNESS_URL=http://harness:3001
COPY --from=build /app/apps/console/dist ./dist
COPY --from=build /app/apps/console/server.mjs ./server.mjs
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
