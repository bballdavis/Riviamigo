# syntax=docker/dockerfile:1

FROM rust:1.88-slim AS api-builder
WORKDIR /build/apps/api
ENV SQLX_OFFLINE=true
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY apps/api/Cargo.toml apps/api/Cargo.lock ./
RUN mkdir src && printf 'fn main() {}\n' > src/main.rs \
    && printf 'pub fn __riviamigo_dummy() {}\n' > src/lib.rs \
    && cargo build --release \
    && rm -rf src
COPY apps/api/ ./
RUN touch src/lib.rs src/main.rs migrations/0001_initial_schema.sql \
    && cargo build --release

FROM node:22-alpine AS web-builder
RUN corepack enable
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/dashboards/package.json packages/dashboards/
COPY packages/hooks/package.json packages/hooks/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @riviamigo/web build

FROM postgres:16-bookworm AS runtime
LABEL org.opencontainers.image.source="https://github.com/bballdavis/Riviamigo"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libssl3 nginx tini util-linux \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled /usr/share/nginx/html \
    && groupadd -r -g 1001 riviamigo \
    && useradd -r -u 1001 -g 1001 riviamigo

WORKDIR /app
COPY --from=api-builder /build/apps/api/target/release/riviamigo-api ./riviamigo-api
COPY --from=api-builder /build/apps/api/migrations ./migrations
COPY --from=web-builder /build/apps/web/dist ./dist
COPY compose/nginx/nginx.conf /etc/nginx/nginx.conf
COPY compose/production-init.sh compose/production-services.sh ./
RUN chmod 0755 /app/production-init.sh /app/production-services.sh \
    && mkdir -p /backups /cache /tmp/nginx \
    && chown -R 1001:1001 /app /backups /cache /tmp/nginx

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/app/production-init.sh"]
