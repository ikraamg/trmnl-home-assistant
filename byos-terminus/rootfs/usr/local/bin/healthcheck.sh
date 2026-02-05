#!/bin/bash
# Combined health check for BYOS Terminus
# Checks PostgreSQL, Valkey, and Puma

set -e

# Check PostgreSQL
if ! /usr/lib/postgresql/16/bin/pg_isready -U postgres -q; then
    echo "PostgreSQL not ready"
    exit 1
fi

# Check Valkey
VALKEY_SOCK="/var/run/valkey/valkey.sock"
if [ -S "$VALKEY_SOCK" ]; then
    if ! valkey-cli -s "$VALKEY_SOCK" ping 2>/dev/null | grep -q PONG; then
        echo "Valkey not responding"
        exit 1
    fi
else
    echo "Valkey socket not found"
    exit 1
fi

# Check Puma via /up endpoint (uses configurable port)
HANAMI_PORT="${HANAMI_PORT:-2300}"
if ! curl -sf "http://localhost:${HANAMI_PORT}/up" > /dev/null 2>&1; then
    echo "Puma not responding"
    exit 1
fi

exit 0
