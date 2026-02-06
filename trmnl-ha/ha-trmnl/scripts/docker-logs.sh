#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

CONTAINER_NAME="trmnl-ha-live"

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${RED}❌ Error: Container '${CONTAINER_NAME}' is not running${NC}"
  echo ""
  echo "Start the container first:"
  echo "  ./scripts/docker-run.sh"
  exit 1
fi

echo -e "${BLUE}📋 Viewing application logs (Ctrl+C to exit)...${NC}"
echo ""
docker logs -f "${CONTAINER_NAME}"
