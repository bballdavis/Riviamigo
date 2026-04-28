FROM rust:1.78-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
# Cache dependency compilation
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src

COPY . .
# Force rebuild of the actual binary
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/riviamigo-api /usr/local/bin/riviamigo-api
EXPOSE 3001
CMD ["riviamigo-api"]
