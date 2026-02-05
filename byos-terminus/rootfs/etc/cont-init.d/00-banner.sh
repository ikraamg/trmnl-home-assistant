#!/command/with-contenv bash
# BYOS Terminus startup banner

VERSION="0.1.0"

echo ""
echo "=============================================="
echo "  BYOS Terminus - Home Assistant Add-on"
echo "  Version: ${VERSION}"
echo "=============================================="
echo ""
echo "  Self-hosted TRMNL device management platform"
echo ""
echo "  Services:"
echo "    - PostgreSQL 16 (database)"
echo "    - Valkey (job queue)"
echo "    - Puma (web server)"
echo "    - Sidekiq (background jobs)"
echo ""
