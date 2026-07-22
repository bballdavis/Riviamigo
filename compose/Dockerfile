# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM rust:1.97.1-slim@sha256:754a8924e308fb20a327febeda1a07053a2b0fd7474b5ac1cc460a6d33ab18f3 AS api-builder
ARG TARGETARCH
WORKDIR /build/apps/api
ENV SQLX_OFFLINE=true
RUN set -eux; \
    if [ "$TARGETARCH" = "arm64" ]; then \
        dpkg --add-architecture arm64; \
        apt-get update; \
        apt-get install -y --no-install-recommends \
            pkg-config libssl-dev libssl-dev:arm64 \
            gcc-aarch64-linux-gnu libc6-dev-arm64-cross; \
        rustup target add aarch64-unknown-linux-gnu; \
    else \
        apt-get update; \
        apt-get install -y --no-install-recommends pkg-config libssl-dev; \
    fi; \
    rm -rf /var/lib/apt/lists/*
COPY apps/api/Cargo.toml apps/api/Cargo.lock ./
RUN mkdir -p src/bin && printf 'fn main() {}\n' > src/main.rs \
    && printf 'fn main() {}\n' > src/bin/riviamigo-restore-agent.rs \
    && printf 'pub fn __riviamigo_dummy() {}\n' > src/lib.rs \
    && target_flag='' \
    && if [ "$TARGETARCH" = "arm64" ]; then \
        export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
            CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ \
            AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar \
            CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
            PKG_CONFIG_ALLOW_CROSS_aarch64_unknown_linux_gnu=1 \
            PKG_CONFIG_PATH_aarch64_unknown_linux_gnu=/usr/lib/aarch64-linux-gnu/pkgconfig \
            AARCH64_UNKNOWN_LINUX_GNU_OPENSSL_LIB_DIR=/usr/lib/aarch64-linux-gnu \
            AARCH64_UNKNOWN_LINUX_GNU_OPENSSL_INCLUDE_DIR=/usr/include; \
        target_flag='--target aarch64-unknown-linux-gnu'; \
    fi \
    && cargo build --release $target_flag \
    && rm -rf src
COPY apps/api/ ./
RUN touch src/lib.rs src/main.rs src/bin/riviamigo-restore-agent.rs migrations/0001_initial_schema.sql \
    && target_flag='' \
    && binary_path=target/release/riviamigo-api \
    && if [ "$TARGETARCH" = "arm64" ]; then \
        export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
            CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ \
            AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar \
            CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
            PKG_CONFIG_ALLOW_CROSS_aarch64_unknown_linux_gnu=1 \
            PKG_CONFIG_PATH_aarch64_unknown_linux_gnu=/usr/lib/aarch64-linux-gnu/pkgconfig \
            AARCH64_UNKNOWN_LINUX_GNU_OPENSSL_LIB_DIR=/usr/lib/aarch64-linux-gnu \
            AARCH64_UNKNOWN_LINUX_GNU_OPENSSL_INCLUDE_DIR=/usr/include; \
        target_flag='--target aarch64-unknown-linux-gnu'; \
        binary_path=target/aarch64-unknown-linux-gnu/release/riviamigo-api; \
    fi \
    && cargo build --release $target_flag \
    && cp "$binary_path" /build/apps/api/riviamigo-api \
    && restore_binary_path=target/release/riviamigo-restore-agent \
    && if [ "$TARGETARCH" = "arm64" ]; then restore_binary_path=target/aarch64-unknown-linux-gnu/release/riviamigo-restore-agent; fi \
    && cp "$restore_binary_path" /build/apps/api/riviamigo-restore-agent

FROM --platform=$BUILDPLATFORM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS web-builder
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
COPY apps/web/ apps/web/
COPY packages/config/ packages/config/
COPY packages/dashboards/ packages/dashboards/
COPY packages/hooks/ packages/hooks/
COPY packages/types/ packages/types/
COPY packages/ui/ packages/ui/
RUN pnpm --filter @riviamigo/web build

FROM postgres:18.4-trixie@sha256:3a82e1f56c8f0f5616a11103ac3d47e632c3938698946a7ad26da0df1334744a AS runtime
LABEL org.opencontainers.image.source="https://github.com/bballdavis/Riviamigo"
ENV XDG_CACHE_HOME=/data/cache

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libssl3 nginx tini util-linux \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled /usr/share/nginx/html \
        /usr/local/bin/gosu \
    && groupadd -r -g 1001 riviamigo \
    && useradd -r -u 1001 -g 1001 riviamigo \
    && mkdir -p /backups /data/cache \
    && chown -R 1001:1001 /backups /data/cache

WORKDIR /app
COPY --chown=1001:1001 --from=api-builder /build/apps/api/riviamigo-api ./riviamigo-api
COPY --chown=1001:1001 --from=api-builder /build/apps/api/riviamigo-restore-agent ./riviamigo-restore-agent
COPY --chown=1001:1001 --from=api-builder /build/apps/api/migrations ./migrations
COPY --chown=1001:1001 --from=web-builder /build/apps/web/dist ./dist
COPY compose/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --chown=1001:1001 compose/production-init.sh compose/production-services.sh compose/production-healthcheck.sh ./
RUN sed -i 's/\r$//' /app/production-init.sh /app/production-services.sh /app/production-healthcheck.sh \
    && chmod 0755 /app/production-init.sh /app/production-services.sh /app/production-healthcheck.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD /app/production-healthcheck.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/app/production-init.sh"]
