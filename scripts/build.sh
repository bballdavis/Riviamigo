#!/bin/bash
set -e

echo "🔨 Building Riviamigo..."

# Build all packages using turbo
turbo build

echo "✅ Build complete!"
