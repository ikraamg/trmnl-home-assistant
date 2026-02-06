#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CONTAINER_NAME="trmnl-ha-live"

echo -e "${BLUE}🛑 Stopping TRMNL HA container...${NC}"
echo ""

# Check if container exists and is running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker stop "${CONTAINER_NAME}"
  echo ""
  echo -e "${GREEN}✅ Container stopped successfully!${NC}"
elif docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${YELLOW}ℹ️  Container '${CONTAINER_NAME}' is already stopped${NC}"
else
  echo -e "${YELLOW}ℹ️  Container '${CONTAINER_NAME}' does not exist${NC}"
fi

echo ""
echo "Next steps:"
echo "  docker start ${CONTAINER_NAME}   - Start the existing container"
echo "  ./scripts/docker-run.sh          - Create and run a new container"
echo "  docker rm ${CONTAINER_NAME}      - Remove the stopped container"
