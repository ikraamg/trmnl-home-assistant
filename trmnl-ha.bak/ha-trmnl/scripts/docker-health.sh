#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

CONTAINER_NAME="trmnl-ha-live"
PORT="10000"
HEALTH_URL="http://localhost:${PORT}/health"

echo -e "${BLUE}🏥 Checking TRMNL HA health...${NC}"
echo ""

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${RED}❌ Container '${CONTAINER_NAME}' is not running${NC}"
  echo ""
  echo "Start the container first:"
  echo "  ./scripts/docker-run.sh"
  exit 1
fi

# Check health endpoint
echo "Fetching health status from ${HEALTH_URL}..."
echo ""

# Try with jq for pretty output, fall back to plain curl
if command -v jq &> /dev/null; then
  RESPONSE=$(curl -s "${HEALTH_URL}")
  echo "$RESPONSE" | jq .
  echo ""

  # Interpret the response
  STATUS=$(echo "$RESPONSE" | jq -r '.status // "unknown"')
  BROWSER_HEALTHY=$(echo "$RESPONSE" | jq -r '.browser.healthy // false')

  if [ "$STATUS" = "ok" ] && [ "$BROWSER_HEALTHY" = "true" ]; then
    echo -e "${GREEN}✅ System is healthy!${NC}"
  elif [ "$STATUS" = "degraded" ]; then
    echo -e "${YELLOW}⚠️  System is degraded (browser recovering)${NC}"
    echo ""
    echo "This is temporary. The browser will recover automatically."
  else
    echo -e "${RED}❌ System is unhealthy${NC}"
    echo ""
    echo "Check logs for details:"
    echo "  ./scripts/docker-logs.sh"
  fi
else
  # No jq available, just show raw response
  curl -s "${HEALTH_URL}"
  echo ""
  echo ""
  echo -e "${YELLOW}💡 Install 'jq' for better formatting: brew install jq${NC}"
fi

echo ""
echo "Container info:"
echo "  Name: ${CONTAINER_NAME}"
echo "  Port: ${PORT}"
echo "  UI:   http://localhost:${PORT}/"
