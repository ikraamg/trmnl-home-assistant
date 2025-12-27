#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CONTAINER_NAME="trmnl-ha-live"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}🔄 Clean rebuild: stop → remove → build → run${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Stop container
echo "Step 1/4: Stopping container..."
"${SCRIPT_DIR}/docker-stop.sh"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 2: Remove container
echo "Step 2/4: Removing container..."
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker rm "${CONTAINER_NAME}"
  echo "Container removed"
else
  echo "No container to remove"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 3: Build image
echo "Step 3/4: Building image..."
"${SCRIPT_DIR}/docker-build.sh"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 4: Run container
echo "Step 4/4: Running container..."
"${SCRIPT_DIR}/docker-run.sh"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}✅ Clean rebuild complete!${NC}"
echo ""
echo "Verify with:"
echo "  ./scripts/docker-health.sh    - Check health status"
echo "  ./scripts/docker-logs.sh      - View logs"
