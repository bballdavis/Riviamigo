# ── Build stage ─────────────────────────────────────────────────────────────
FROM rust:1.97.1-slim@sha256:754a8924e308fb20a327febeda1a07053a2b0fd7474b5ac1cc460a6d33ab18f3 AS builder

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
RUN touch src/lib.rs src/main.rs migrations/0001_initial_schema.sql && cargo build --release

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM postgres:18.4-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296 AS runtime

LABEL org.opencontainers.image.source="https://github.com/bballdavis/Riviamigo"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 curl && rm -rf /var/lib/apt/lists/*

# Non-root user with a dedicated group so the process does not run with GID 0.
RUN groupadd -r -g 1001 riviamigo && useradd -r -u 1001 -g 1001 riviamigo
USER 1001

WORKDIR /app
COPY --from=builder /app/target/release/riviamigo-api ./riviamigo-api
COPY --from=builder /app/migrations ./migrations

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["./riviamigo-api"]
