# syntax=docker/dockerfile:1.4
# BYOS Terminus - Home Assistant Add-on
# Packages the full Terminus platform with embedded PostgreSQL + Valkey

# NOTE: Upstream terminus image already contains Ruby, gems, Chromium, and the app
# We add s6-overlay for process management and bundle PostgreSQL + Valkey

ARG BUILD_FROM=ghcr.io/usetrmnl/terminus:latest
ARG S6_OVERLAY_VERSION=3.2.0.2

# ============================================================================
# Stage 1: s6-overlay installer
# ============================================================================
FROM alpine:3.21 AS s6-installer

ARG S6_OVERLAY_VERSION
ARG TARGETARCH

# Download s6-overlay for the target architecture
# hadolint ignore=DL3018
RUN apk add --no-cache curl tar xz && \
    # Map Docker arch to s6-overlay arch
    case "${TARGETARCH}" in \
        "amd64") S6_ARCH="x86_64" ;; \
        "arm64") S6_ARCH="aarch64" ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    # Download and extract s6-overlay
    curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" -o /tmp/s6-overlay-noarch.tar.xz && \
    curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" -o /tmp/s6-overlay-arch.tar.xz && \
    mkdir -p /s6-root && \
    tar -C /s6-root -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C /s6-root -Jxpf /tmp/s6-overlay-arch.tar.xz

# ============================================================================
# Stage 2: Final runtime image
# ============================================================================
# hadolint ignore=DL3006
FROM ${BUILD_FROM}

# Set shell for pipefail support
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Switch to root for installation (required for s6-overlay process management)
# hadolint ignore=DL3002
USER root

# Environment for s6-overlay
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME=120000
ENV S6_SERVICES_GRACETIME=30000

# Environment for HA add-on
ENV HANAMI_ENV=production
ENV RACK_ENV=production
# Puma listens on 3000, nginx proxies from 2300
ENV HANAMI_PORT=3000

# Labels for Home Assistant
LABEL \
    io.hass.name="BYOS Terminus" \
    io.hass.description="Self-hosted TRMNL device management platform" \
    io.hass.type="addon" \
    io.hass.version="0.2.0"

# Install PostgreSQL 16, Valkey, nginx, bashio, and dependencies
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
        # PostgreSQL 16 (use existing pgdg repo from base image)
        postgresql-16 \
        # Valkey (Redis-compatible)
        valkey-server \
        valkey-tools \
        # Nginx for ingress proxy
        nginx \
        # Utilities
        jq \
        curl \
        xxd \
        procps \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives

# Install bashio for HA integration
RUN curl -fsSL "https://github.com/hassio-addons/bashio/archive/refs/tags/v0.16.2.tar.gz" | tar -xz -C /tmp && \
    mv /tmp/bashio-0.16.2/lib /usr/lib/bashio && \
    ln -s /usr/lib/bashio/bashio /usr/bin/bashio && \
    rm -rf /tmp/bashio-*

# Copy s6-overlay from installer stage
COPY --from=s6-installer /s6-root /

# Create data directories
RUN mkdir -p /data/postgres /data/valkey /data/uploads /data/logs && \
    mkdir -p /var/run/valkey /var/run/postgresql && \
    mkdir -p /run/s6-rc

# Create terminus user and postgres user with fixed UIDs
RUN groupadd -g 999 postgres 2>/dev/null || true && \
    useradd -u 999 -g 999 -d /var/lib/postgresql -s /bin/bash postgres 2>/dev/null || true && \
    mkdir -p /var/lib/postgresql && \
    chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql /data/postgres

# Set up Valkey permissions
RUN chown -R root:root /var/run/valkey /data/valkey

# Copy rootfs overlay (s6-rc services, configs, scripts)
COPY rootfs /

# Make scripts executable
# hadolint ignore=SC2015
RUN chmod +x /etc/cont-init.d/* && \
    chmod +x /usr/local/bin/* && \
    chmod +x /etc/s6-overlay/s6-rc.d/*/run 2>/dev/null || true && \
    chmod +x /etc/s6-overlay/s6-rc.d/*/finish 2>/dev/null || true && \
    chmod +x /etc/s6-overlay/s6-rc.d/*/data/check 2>/dev/null || true

# Fix app directory permissions for uploads
# hadolint ignore=SC2015
RUN chown -R app:app /app/public/uploads 2>/dev/null || true && \
    ln -sf /data/uploads /app/public/uploads 2>/dev/null || true

# Expose port for TRMNL devices and ingress
EXPOSE 2300

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

# Use SIGINT for graceful PostgreSQL shutdown
STOPSIGNAL SIGINT

# s6-overlay entrypoint
ENTRYPOINT ["/init"]
