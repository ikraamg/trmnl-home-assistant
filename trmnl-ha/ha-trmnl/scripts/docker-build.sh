#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${BLUE}🔨 Building TRMNL HA Docker image...${NC}"
echo ""

cd "$PROJECT_ROOT"

# Build the image
docker build -t trmnl-ha .

echo ""
echo -e "${GREEN}✅ Build complete!${NC}"
echo ""
echo "Next steps:"
echo "  ./scripts/docker-run.sh       - Run the container"
echo "  ./scripts/docker-rebuild.sh   - Clean rebuild (stop, remove, build, run)"
