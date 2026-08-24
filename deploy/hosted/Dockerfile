# syntax=docker/dockerfile:1.7

FROM --platform=linux/amd64 oven/bun:1.2.22 AS web-builder
ARG TAN_STUDIO_VERSION=development
WORKDIR /workspace
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @tan-studio/web build
RUN mkdir -p /release/web \
  && cp -R apps/web/dist/. /release/web/ \
  && printf '%s\n' "$TAN_STUDIO_VERSION" > /release/VERSION

FROM --platform=linux/amd64 rust:1.97-bookworm AS service-builder
WORKDIR /workspace
COPY apps/service ./apps/service
COPY apps/companion/migrations ./apps/companion/migrations
RUN cargo build --locked --release --manifest-path apps/service/Cargo.toml \
  --bin tan-studio-service

FROM scratch AS release
COPY --from=web-builder /release /
COPY --from=service-builder /workspace/apps/service/target/release/tan-studio-service /bin/tan-studio-service
COPY deploy/hosted/install.sh /install.sh
COPY deploy/hosted/tan-studio.service /system/tan-studio.service
COPY deploy/hosted/Caddyfile /system/Caddyfile
