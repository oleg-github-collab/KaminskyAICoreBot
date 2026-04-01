# ==== Stage 1: Build ====
# FORCE REBUILD: 2026-04-01-comments-migration-fix
FROM ubuntu:22.04 AS builder

ARG ZIG_VERSION=0.14.0
ARG SQLITE_YEAR=2024
ARG SQLITE_VERSION=3460100

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl xz-utils ca-certificates git unzip libhiredis-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Zig
RUN curl -L "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz" \
    | tar -xJ -C /usr/local && \
    ln -s /usr/local/zig-linux-x86_64-${ZIG_VERSION}/zig /usr/local/bin/zig

WORKDIR /build

# Download SQLite amalgamation
RUN curl -L "https://www.sqlite.org/${SQLITE_YEAR}/sqlite-amalgamation-${SQLITE_VERSION}.zip" -o sqlite.zip && \
    unzip sqlite.zip && \
    mkdir -p libs && \
    cp sqlite-amalgamation-${SQLITE_VERSION}/sqlite3.c libs/ && \
    cp sqlite-amalgamation-${SQLITE_VERSION}/sqlite3.h libs/ && \
    rm -rf sqlite.zip sqlite-amalgamation-*

# Clone httpz dependency
RUN git clone --depth 1 --branch zig-0.14 https://github.com/karlseguin/http.zig.git libs/httpz || \
    git clone --depth 1 https://github.com/karlseguin/http.zig.git libs/httpz

# Copy build files first (Docker layer caching)
COPY build.zig build.zig.zon ./

# Copy source code (web/ is inside src/web/, used via @embedFile)
COPY src/ src/
COPY sql/ sql/

# Build release binary
RUN zig build -Doptimize=ReleaseSafe 2>&1 || \
    (echo "Build failed, trying ReleaseFast..." && zig build -Doptimize=ReleaseFast)

# ==== Stage 2: Runtime ====
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libhiredis0.14 libhiredis-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/zig-out/bin/kaminsky-bot .

# Create data directories (Railway Volume will be mounted at /data)
RUN mkdir -p /data/db /data/files /data/batch /data/backups

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8080/health || exit 1

CMD ["./kaminsky-bot"]
