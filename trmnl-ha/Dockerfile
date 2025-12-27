# TRMNL HA Add-on Dockerfile
# Multi-stage build for optimized image size while maintaining compatibility
# Uses Debian Bookworm for updated packages and better security

# =============================================================================
# STAGE 1: DEPENDENCY BUILDER
# =============================================================================
FROM debian:bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install Bun and prepare dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    ca-certificates \
    && curl -fsSL https://bun.sh/install | bash \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Add Bun to PATH for this stage
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

WORKDIR /build

# Copy package files for dependency installation
COPY ha-trmnl/package.json ha-trmnl/bunfig.toml ha-trmnl/bun.lock ./

# Install dependencies
# Skip Puppeteer's bundled Chrome - we'll use system Chromium in runtime stage
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN bun install --frozen-lockfile --production

# =============================================================================
# STAGE 2: RUNTIME
# =============================================================================
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install only runtime dependencies
# NOTE: Grouped by purpose for clarity and maintainability
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Browser runtime for Puppeteer
    chromium \
    chromium-sandbox \
    # Minimal utilities for health checks and runtime
    curl \
    ca-certificates \
    # CJK font support for international dashboards
    fonts-noto-cjk \
    # Image processing for dithering algorithms
    graphicsmagick \
    # Cleanup aggressively to minimize image size
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /var/cache/apt/*

# Copy Bun runtime from builder stage
COPY --from=builder /root/.bun /root/.bun

# Add Bun to PATH
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Verify Bun is available
RUN bun --version

WORKDIR /app

# Copy node_modules from builder stage (production dependencies only)
COPY --from=builder /build/node_modules ./node_modules

# Copy package.json for metadata
COPY ha-trmnl/package.json ./

# Copy application code
# AI: The .dockerignore file excludes tests and dev files automatically
COPY ha-trmnl/ .

# =============================================================================
# RUNTIME CONFIGURATION
# =============================================================================

# Copy and set up entrypoint script
COPY ha-trmnl/scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Health check to verify server is running
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:10000/health || exit 1

# Use entrypoint for setup
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "main.js"]
