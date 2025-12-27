#!/bin/bash
# Docker Entrypoint Script for TRMNL HA
# Sets up directories before starting the app with Bun

set -e

echo "🚀 TRMNL HA Starting with Bun..."
echo "🥖 Runtime: Bun $(bun --version)"

# =============================================================================
# CREATE NECESSARY DIRECTORIES
# =============================================================================

mkdir -p logs output data

echo "✅ Directories created"
echo "📁 logs/   - Application logs with built-in rotation"
echo "📁 output/ - Screenshot output files"
echo "📁 data/   - Persistent data (schedules, config)"

# =============================================================================
# START APPLICATION
# =============================================================================

echo "🎯 Starting TRMNL HA..."

# Execute the original command (from Dockerfile CMD)
exec "$@"
