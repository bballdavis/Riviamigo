# ── Build stage ─────────────────────────────────────────────────────────────
FROM rust:1.88-slim AS builder

WORKDIR /app
ENV SQLX_OFFLINE=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
# Cache dependency compilation
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && echo 'pub fn __riviamigo_dummy() {}' > src/lib.rs \
    && cargo build --release \
    && rm -rf src

COPY . .
# Force rebuild of the actual crate after the dependency cache layer.
RUN touch src/lib.rs src/main.rs migrations/0001_schema_init.sql && cargo build --release

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 curl && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -r -u 1001 -g root riviamigo
USER 1001

WORKDIR /app
COPY --from=builder /app/target/release/riviamigo-api ./riviamigo-api
COPY --from=builder /app/migrations ./migrations

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["./riviamigo-api"]
