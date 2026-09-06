# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM oven/bun:1.2.22 AS web-builder
ARG TAN_STUDIO_VERSION=development
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,id=tan-studio-bun,target=/root/.bun/install/cache \
  bun install --frozen-lockfile
RUN bun run --filter @tan-studio/web build
RUN mkdir -p /release/web \
  && cp -R apps/web/dist/. /release/web/ \
  && printf '%s\n' "$TAN_STUDIO_VERSION" > /release/VERSION

FROM --platform=$BUILDPLATFORM rust:1.97-bookworm AS service-builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    gcc-x86-64-linux-gnu libc6-dev-amd64-cross \
  && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-unknown-linux-gnu
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
  CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc \
  AR_x86_64_unknown_linux_gnu=x86_64-linux-gnu-ar
WORKDIR /workspace
COPY apps/service ./apps/service
COPY apps/companion/migrations ./apps/companion/migrations
RUN --mount=type=cache,id=tan-studio-cargo-registry,target=/usr/local/cargo/registry \
  --mount=type=cache,id=tan-studio-service-amd64,target=/workspace/apps/service/target \
  cargo build --locked --release --target x86_64-unknown-linux-gnu \
    --manifest-path apps/service/Cargo.toml --bin tan-studio-service \
  && mkdir -p /release/bin \
  && cp apps/service/target/x86_64-unknown-linux-gnu/release/tan-studio-service \
    /release/bin/tan-studio-service \
  && x86_64-linux-gnu-readelf -h /release/bin/tan-studio-service \
    | grep -q 'Machine:.*Advanced Micro Devices X86-64'

FROM scratch AS release
COPY --from=web-builder /release /
COPY --from=service-builder /release/bin/tan-studio-service /bin/tan-studio-service
COPY deploy/hosted/install.sh /install.sh
COPY deploy/hosted/tan-studio.service /system/tan-studio.service
COPY deploy/hosted/Caddyfile /system/Caddyfile
