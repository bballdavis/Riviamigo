FROM rust:1.88-slim AS builder
WORKDIR /app
ENV SQLX_OFFLINE=true

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml ./
# Cache dependency compilation
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && echo 'pub fn __riviamigo_dummy() {}' > src/lib.rs \
    && cargo build --release \
    && rm -rf src

COPY . .
# Force rebuild of the actual crate after the dependency cache layer.
RUN touch src/lib.rs src/main.rs migrations/0001_schema_init.sql && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/riviamigo-api /usr/local/bin/riviamigo-api
EXPOSE 3001
CMD ["riviamigo-api"]
