#!/command/with-contenv bash
# BYOS Terminus data initialization and security setup

set -e

echo "[init] Initializing data directories..."

# Create required directories
mkdir -p /data/postgres
mkdir -p /data/valkey
mkdir -p /data/uploads
mkdir -p /data/logs

# Set ownership
chown -R postgres:postgres /data/postgres
chown -R root:root /data/valkey
chown -R 1000:1000 /data/uploads 2>/dev/null || true

# Create socket directories
mkdir -p /var/run/valkey
mkdir -p /var/run/postgresql
chown postgres:postgres /var/run/postgresql

# ============================================
# SECURITY: Generate secrets on first run
# ============================================

if [ ! -f /data/.initialized ]; then
    echo "[init] First-run setup detected..."

    # Generate APP_SECRET (64 character hex string for session crypto)
    if [ ! -f /data/.app_secret ]; then
        APP_SECRET=$(head -c 32 /dev/urandom | xxd -p)
        echo "$APP_SECRET" > /data/.app_secret
        chmod 600 /data/.app_secret
        echo "[init] Generated APP_SECRET"
    fi

    # Generate database password (not used since we use trust auth locally)
    if [ ! -f /data/.db_password ]; then
        DB_PASSWORD=$(head -c 16 /dev/urandom | xxd -p)
        echo "$DB_PASSWORD" > /data/.db_password
        chmod 600 /data/.db_password
    fi

    # ============================================
    # CRITICAL SECURITY: First-user registration token
    # ============================================
    # This token MUST be used for the first user registration
    # Without it, anyone on the network could register as admin
    # ============================================

    ADMIN_TOKEN=$(head -c 16 /dev/urandom | xxd -p)
    echo "$ADMIN_TOKEN" > /data/.admin_token
    chmod 600 /data/.admin_token

    echo ""
    echo "=========================================="
    echo "  FIRST-RUN SETUP - IMPORTANT!"
    echo "=========================================="
    echo ""
    echo "  Registration Token: $ADMIN_TOKEN"
    echo ""
    echo "  Use this token when registering your first user."
    echo "  The token will be required at:"
    echo ""
    echo "  http://[YOUR-HA-IP]:2300/register"
    echo ""
    echo "  This token expires after the first user is created."
    echo ""
    echo "=========================================="
    echo ""

    # Mark as initialized
    touch /data/.initialized
    echo "[init] First-run setup complete"
else
    echo "[init] Existing installation detected"

    # Display token if first user hasn't registered yet
    if [ -f /data/.admin_token ]; then
        ADMIN_TOKEN=$(cat /data/.admin_token)
        echo ""
        echo "=========================================="
        echo "  REGISTRATION TOKEN (first user pending)"
        echo "  Token: $ADMIN_TOKEN"
        echo "=========================================="
        echo ""
    fi
fi

# Load HA options if available
if [ -f /data/options.json ]; then
    # Set timezone if configured
    TZ=$(jq -r '.timezone // empty' /data/options.json 2>/dev/null)
    if [ -n "$TZ" ]; then
        export TZ
        echo "[init] Timezone set to: $TZ"
    fi

    # Set log level if configured
    LOG_LEVEL=$(jq -r '.log_level // "info"' /data/options.json 2>/dev/null)
    echo "[init] Log level: $LOG_LEVEL"
fi

echo "[init] Data initialization complete"
