#!/bin/bash

# LLM Throttle Demo Deployment Script
# This script builds the library and demo, then deploys to GitHub Pages

set -e

echo "🚀 Starting deployment process..."

# Build the library first
echo "📦 Building library..."
npm run build

# Build the demo
echo "🎨 Building demo..."
npm run demo:build

# Check if demo-dist directory exists
if [ ! -d "demo-dist" ]; then
  echo "❌ Demo build failed - demo-dist directory not found"
  exit 1
fi

echo "✅ Build completed successfully!"

# Deploy to GitHub Pages (requires gh-pages to be installed)
if command -v gh-pages &> /dev/null; then
  echo "📤 Deploying to GitHub Pages..."
  npx gh-pages -d demo-dist
  echo "🎉 Deployment completed!"
else
  echo "⚠️  gh-pages not found. To deploy, run:"
  echo "   npm install -g gh-pages"
  echo "   gh-pages -d demo-dist"
fi

echo "🔗 Demo will be available at: https://aid-on.github.io/llm-throttle/"