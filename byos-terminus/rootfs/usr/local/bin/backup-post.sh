#!/bin/bash
# Post-backup hook for BYOS Terminus
# Completes PostgreSQL backup mode

# Redirect output to container stdout
exec &> /proc/1/fd/1

echo "[backup] Completing hot backup..."

# =============================================================================
# PostgreSQL: Stop backup mode
# =============================================================================
# CRITICAL: Must call this or WAL files accumulate forever
echo "[backup] Stopping PostgreSQL backup mode..."
if ! psql -U postgres -c "SELECT pg_backup_stop()" 2>/dev/null; then
    # Fallback to pg_stop_backup for older PostgreSQL
    psql -U postgres -c "SELECT pg_stop_backup()" 2>/dev/null || \
        echo "[backup] Warning: Could not stop PostgreSQL backup mode"
fi

echo "[backup] Backup complete"
