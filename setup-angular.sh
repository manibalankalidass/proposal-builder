#!/bin/bash

# ============================================================
# Angular Project Quick Setup Script
# ============================================================
# Usage: bash ./setup-angular.sh
# Purpose: Automates npm package installation for Angular projects
# ============================================================

set -e  # Exit on any error

echo "🚀 Starting Angular Project Setup..."
echo ""

# Step 1: Check Node.js
echo "✓ Checking Node.js version..."
NODE_VERSION=$(node -v)
echo "  Node.js: $NODE_VERSION"

# Step 2: Check npm
echo "✓ Checking npm version..."
NPM_VERSION=$(npm -v)
echo "  npm: $NPM_VERSION"
echo ""

# Step 3: Install core Angular packages
echo "📦 Installing Core Angular Packages..."
npm install \
  @angular/common@^21.2.0 \
  @angular/compiler@^21.2.0 \
  @angular/core@^21.2.0 \
  @angular/forms@^21.2.0 \
  @angular/platform-browser@^21.2.0 \
  @angular/platform-server@^21.2.0 \
  @angular/router@^21.2.0 \
  @angular/ssr@^21.2.5 \
  rxjs@~7.8.0 \
  tslib@^2.3.0

echo "✅ Core Angular packages installed"
echo ""

# Step 4: Install build tools
echo "📦 Installing Build Tools..."
npm install --save-dev \
  @angular/build@^21.2.5 \
  @angular/cli@^21.2.5 \
  @angular/compiler-cli@^21.2.0 \
  typescript@~5.9.2

echo "✅ Build tools installed"
echo ""

# Step 5: Install editor packages
echo "📦 Installing Code Editor Packages..."
npm install \
  @codemirror/autocomplete@^6.20.3 \
  @codemirror/commands@^6.10.3 \
  @codemirror/state@^6.6.0 \
  @codemirror/view@^6.43.0 \
  express@^5.1.0

echo "✅ Editor packages installed"
echo ""

# Step 6: Install development tools
echo "📦 Installing Development Tools..."
npm install --save-dev \
  @types/express@^5.0.1 \
  @types/node@^20.17.19 \
  jsdom@^28.0.0 \
  prettier@^3.8.1 \
  puppeteer@^24.43.1 \
  vitest@^4.0.8

echo "✅ Development tools installed"
echo ""

# Step 7: Verify installation
echo "✓ Verifying installation..."
npm list @angular/core

echo ""
echo "============================================================"
echo "🎉 Setup Complete!"
echo "============================================================"
echo ""
echo "Available commands:"
echo "  npm start              - Start development server (port 4200)"
echo "  npm run build          - Create production build"
echo "  npm test               - Run tests"
echo "  npm run watch          - Build in watch mode"
echo ""
echo "Next steps:"
echo "  1. Run: npm start"
echo "  2. Open: http://localhost:4200"
echo ""
echo "For detailed setup info, see: SETUP_PLAN.md"
echo "============================================================"
