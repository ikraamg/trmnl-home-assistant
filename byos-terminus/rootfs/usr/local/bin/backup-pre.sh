#!/bin/bash
# Pre-backup hook for BYOS Terminus
# Prepares PostgreSQL and Valkey for hot backup

# Redirect output to container stdout
exec &> /proc/1/fd/1

echo "[backup] Starting hot backup preparation..."

# =============================================================================
# PostgreSQL: Start backup mode
# =============================================================================
# Using pg_backup_start (PostgreSQL 15+) for consistent backup
# This creates a backup label and ensures WAL is archived properly
echo "[backup] Starting PostgreSQL backup mode..."
if ! psql -U postgres -c "SELECT pg_backup_start('ha_backup', fast => true)" 2>/dev/null; then
    # Fallback to pg_start_backup for older PostgreSQL
    psql -U postgres -c "SELECT pg_start_backup('ha_backup', true, false)" 2>/dev/null || \
        echo "[backup] Warning: Could not start PostgreSQL backup mode"
fi

# =============================================================================
# Valkey: Trigger BGSAVE and wait for completion
# =============================================================================
VALKEY_SOCK="/var/run/valkey/valkey.sock"

if [ -S "$VALKEY_SOCK" ]; then
    echo "[backup] Triggering Valkey BGSAVE..."

    # Get last save timestamp
    LAST_SAVE=$(valkey-cli -s "$VALKEY_SOCK" LASTSAVE 2>/dev/null)

    # Trigger background save
    valkey-cli -s "$VALKEY_SOCK" BGSAVE 2>/dev/null

    # Wait for save to complete (max 30 seconds)
    TIMEOUT=30
    while [ $TIMEOUT -gt 0 ]; do
        CURRENT_SAVE=$(valkey-cli -s "$VALKEY_SOCK" LASTSAVE 2>/dev/null)
        if [ "$CURRENT_SAVE" != "$LAST_SAVE" ]; then
            echo "[backup] Valkey BGSAVE complete"
            break
        fi
        sleep 1
        TIMEOUT=$((TIMEOUT - 1))
    done

    if [ $TIMEOUT -eq 0 ]; then
        echo "[backup] Warning: Valkey BGSAVE timed out"
    fi
else
    echo "[backup] Warning: Valkey socket not found, skipping"
fi

echo "[backup] Backup preparation complete"
