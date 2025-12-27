#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CONTAINER_NAME="trmnl-ha-live"
IMAGE_NAME="trmnl-ha"
VOLUME_DIR="/tmp/trmnl-data"
PORT="10000"

echo -e "${BLUE}🚀 Starting TRMNL HA container...${NC}"
echo ""

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${YELLOW}⚠️  Container '${CONTAINER_NAME}' already exists${NC}"
  echo "Stopping and removing existing container..."
  docker stop "${CONTAINER_NAME}" 2>/dev/null || true
  docker rm "${CONTAINER_NAME}" 2>/dev/null || true
  echo ""
fi

# Create volume directory if it doesn't exist
if [ ! -d "$VOLUME_DIR" ]; then
  echo "Creating volume directory: $VOLUME_DIR"
  mkdir -p "$VOLUME_DIR"
  echo ""
fi

# Run the container with resilience configuration
echo "Starting container with resilience features..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --memory 1g \
  --memory-swap 1g \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  -p "${PORT}:${PORT}" \
  -v "${VOLUME_DIR}:/data" \
  "${IMAGE_NAME}"

echo ""
echo -e "${GREEN}✅ Container started successfully!${NC}"
echo ""
echo "Container: ${CONTAINER_NAME}"
echo "Port:      ${PORT}"
echo "Volume:    ${VOLUME_DIR} → /data"
echo ""
echo "Next steps:"
echo "  ./scripts/docker-health.sh    - Check health status"
echo "  ./scripts/docker-logs.sh      - View application logs"
echo ""
echo "Access UI: http://localhost:${PORT}/"
