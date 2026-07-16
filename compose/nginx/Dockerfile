# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Multi-stage nginx image that bakes the compiled web app into the image so
# the container has no host bind-mounts and the image is fully self-contained.
#
# Build args:
#   NODE_VERSION   (default: 22-alpine)  — base for the build stage
#   NGINX_VERSION  (default: 1.27-alpine) — base for the final stage
#
# Usage (from repo root):
#   docker build -f compose/nginx/Dockerfile -t riviamigo-web:latest .
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder

# Enable pnpm via corepack (matches the workspace's package manager requirement)
RUN corepack enable

WORKDIR /build

# Copy manifests first so layer caching works when only source code changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json        apps/web/
COPY packages/config/package.json packages/config/
COPY packages/dashboards/package.json packages/dashboards/
COPY packages/hooks/package.json  packages/hooks/
COPY packages/types/package.json  packages/types/
COPY packages/ui/package.json     packages/ui/

RUN pnpm install --frozen-lockfile

# Copy full source and build
COPY . .
RUN pnpm --filter @riviamigo/web build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM nginx:${NGINX_VERSION} AS runtime

LABEL org.opencontainers.image.source="https://github.com/bballdavis/Riviamigo"

# Remove default nginx site — we supply our own config
RUN rm -rf /etc/nginx/conf.d /usr/share/nginx/html

# Bake the compiled SPA into the image
COPY --from=builder /build/apps/web/dist /app/dist

# Install the production nginx config
COPY compose/nginx/nginx.conf /etc/nginx/nginx.conf

# Nginx writes pid + temp files here; a writable tmpfs is mounted in compose
# for read-only rootfs setups.  Only /tmp and /var/run need to be writable.
EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
