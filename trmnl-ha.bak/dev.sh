#!/bin/bash

# TRMNL HA Development Script
# Usage: ./dev.sh [command]

set -e

IMAGE_NAME="trmnl-ha:dev"
CONTAINER_NAME="trmnl-ha-dev"

cd "$(dirname "$0")"

case "${1:-help}" in
  build)
    echo "Building Docker image..."
    # Use .dockerignore to exclude options-dev.json so mounted file takes precedence
    docker build -t "$IMAGE_NAME" .
    echo "Build complete!"
    ;;

  run)
    echo "Running container..."
    echo "Press Ctrl+C to stop"
    echo ""
    docker run -it --rm \
      --name "$CONTAINER_NAME" \
      --init \
      -p 10000:10000 \
      --add-host=host.docker.internal:host-gateway \
      -v "$(pwd)/ha-trmnl/options-dev.json:/data/options.json" \
      "$IMAGE_NAME"
    ;;

  shell)
    echo "Starting shell in container..."
    docker run -it --rm \
      --name "$CONTAINER_NAME" \
      -v "$(pwd)/ha-trmnl/options-dev.json:/data/options.json" \
      "$IMAGE_NAME" /bin/bash
    ;;

  test)
    echo "Running build and basic tests..."
    docker build -t "$IMAGE_NAME" .
    echo ""
    echo "Node version:"
    docker run --rm "$IMAGE_NAME" node --version
    echo ""
    echo "Installed packages:"
    docker run --rm "$IMAGE_NAME" npm ls --depth=0
    echo ""
    echo "All tests passed!"
    ;;

  logs)
    docker logs -f "$CONTAINER_NAME"
    ;;

  stop)
    docker stop "$CONTAINER_NAME" 2>/dev/null || echo "Container not running"
    ;;

  clean)
    echo "Removing image..."
    docker rmi "$IMAGE_NAME" 2>/dev/null || echo "Image not found"
    ;;

  *)
    echo "TRMNL HA Development Script"
    echo ""
    echo "Usage: ./dev.sh [command]"
    echo ""
    echo "Commands:"
    echo "  build   Build the Docker image"
    echo "  run     Run the container (requires options-dev.json)"
    echo "  shell   Start a bash shell in the container"
    echo "  test    Build and run basic tests"
    echo "  logs    Follow container logs"
    echo "  stop    Stop running container"
    echo "  clean   Remove the Docker image"
    ;;
esac
