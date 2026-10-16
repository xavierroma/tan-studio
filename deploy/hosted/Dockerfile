# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM oven/bun:1.4.2 AS web-builder
ARG TAN_STUDIO_VERSION=development
WORKDIR /workspace
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @tan-studio/web build
RUN bun run --cwd plugins/tan-studio build
RUN mkdir -p /release/web \
  && cp -R apps/web/dist/. /release/web/ \
  && printf '%s\n' "$TAN_STUDIO_VERSION" > /release/VERSION

# Compile natively even on Apple Silicon; x86 QEMU cannot reliably run rustc/Bun.
FROM --platform=$BUILDPLATFORM rust:1.97-bookworm AS service-builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc-x86-64-linux-gnu libc6-dev-amd64-cross \
  && rm -rf /var/lib/apt/lists/* \
  && rustup target add x86_64-unknown-linux-gnu
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc
ENV CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc
WORKDIR /workspace
COPY apps/service ./apps/service
COPY apps/companion/migrations ./apps/companion/migrations
RUN cargo build --locked --release --manifest-path apps/service/Cargo.toml \
  --bin tan-studio-service --target x86_64-unknown-linux-gnu

FROM --platform=linux/amd64 oven/bun:1.4.2 AS bun-runtime

FROM scratch AS release
COPY --from=bun-runtime /usr/local/bin/bun /bin/bun
COPY --from=web-builder /workspace/plugins/tan-studio/dist/http-server.js /mcp/http-server.js
COPY --from=web-builder /release /
COPY --from=service-builder /workspace/apps/service/target/x86_64-unknown-linux-gnu/release/tan-studio-service /bin/tan-studio-service
COPY deploy/hosted/install.sh /install.sh
COPY deploy/hosted/tan-studio.service /system/tan-studio.service
COPY deploy/hosted/Caddyfile /system/Caddyfile

COPY deploy/hosted/tan-studio-mcp.service /system/tan-studio-mcp.service
COPY deploy/hosted/mcp.caddy /system/mcp.caddy
COPY deploy/hosted/enable_mcp.sh /enable_mcp.sh
COPY deploy/hosted/disable_mcp.sh /disable_mcp.sh
