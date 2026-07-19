# syntax=docker/dockerfile:1.7

FROM oven/bun:1.2.22 AS application-builder
ARG TAN_STUDIO_VERSION=development
WORKDIR /workspace
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @tan-studio/web build
RUN mkdir -p /release/bin /release/web \
  && bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
    --target=bun-linux-arm64 apps/companion/src/headless.ts \
    --outfile=/release/bin/tan-studio-server \
  && cp -R apps/web/dist/. /release/web/ \
  && printf '%s\n' "$TAN_STUDIO_VERSION" > /release/VERSION

FROM rust:1.85-bookworm AS serial-builder
WORKDIR /source
COPY apps/serial-bridge/Cargo.toml apps/serial-bridge/Cargo.lock ./
COPY apps/serial-bridge/src ./src
RUN cargo build --locked --release

FROM scratch AS release
COPY --from=application-builder /release /
COPY --from=serial-builder /source/target/release/tan-studio-serial-bridge /bin/tan-studio-serial-bridge
COPY deploy/raspberry-pi/install.sh /install.sh
COPY deploy/raspberry-pi/tan-studio.service /system/tan-studio.service
COPY deploy/raspberry-pi/99-tan-studio-kaffelogic.rules /system/99-tan-studio-kaffelogic.rules
