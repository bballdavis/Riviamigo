#!/bin/bash
set -e

echo "🔨 Building Riviamigo for production..."
echo ""

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
  echo "❌ pnpm is not installed. Install it with:"
  echo "   brew install pnpm"
  echo "   or visit https://pnpm.io/installation"
  exit 1
fi

echo "📦 Building all packages (TypeScript → JavaScript)..."
# Build all packages using turbo
pnpm turbo build

echo ""
echo "✅ Build complete!"
echo ""
echo "📁 Build outputs:"
echo "   • Web app: apps/web/dist/"
echo "   • UI components: packages/ui/dist/"
echo ""
echo "💡 Use ./scripts/start.sh to run the production server"
