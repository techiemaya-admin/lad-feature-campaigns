#!/bin/bash

###############################################################################
# LAD Feature Sandbox Setup Script
# 
# Purpose: Creates a local sandbox with symlinks to feature backend/sdk
# Usage: ./setup-sandbox.sh
# 
# IMPORTANT: This sandbox is LOCAL ONLY and should NEVER be committed
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
FEATURE_NAME="campaigns"
SANDBOX_DIR="lad-sandbox"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   LAD Feature Sandbox Setup               ║${NC}"
echo -e "${BLUE}║   Feature: ${FEATURE_NAME}                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Check if backend and sdk directories exist
if [ ! -d "backend" ]; then
    echo -e "${RED}✗ Backend directory not found${NC}"
    echo -e "${YELLOW}  This script must be run from feature repository root${NC}"
    exit 1
fi

if [ ! -d "sdk" ]; then
    echo -e "${RED}✗ SDK directory not found${NC}"
    echo -e "${YELLOW}  This script must be run from feature repository root${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Found backend and SDK directories${NC}"
echo ""

# Create sandbox directory
echo -e "${BLUE}Creating sandbox directory...${NC}"
if [ -d "$SANDBOX_DIR" ]; then
    echo -e "${YELLOW}⚠ Sandbox already exists. Removing old symlinks...${NC}"
    rm -rf "$SANDBOX_DIR"
fi
mkdir -p "$SANDBOX_DIR"
echo -e "${GREEN}✓ Created $SANDBOX_DIR/${NC}"
echo ""

# Create symlinks
echo -e "${BLUE}Creating symlinks...${NC}"
cd "$SANDBOX_DIR"

# Create relative symlinks
ln -s ../backend backend
echo -e "${GREEN}✓ backend/ → ../backend${NC}"

ln -s ../sdk sdk
echo -e "${GREEN}✓ sdk/ → ../sdk${NC}"

ln -s ../web web
echo -e "${GREEN}✓ web/ → ../web${NC}"

cd ..
echo ""

# Update .gitignore
echo -e "${BLUE}Updating .gitignore...${NC}"
if [ -f ".gitignore" ]; then
    if grep -q "lad-sandbox" .gitignore; then
        echo -e "${GREEN}✓ .gitignore already configured${NC}"
    else
        echo "" >> .gitignore
        echo "# Sandbox (LOCAL ONLY - never commit)" >> .gitignore
        echo "lad-sandbox/" >> .gitignore
        echo -e "${GREEN}✓ Added lad-sandbox/ to .gitignore${NC}"
    fi
else
    echo "lad-sandbox/" > .gitignore
    echo -e "${GREEN}✓ Created .gitignore with lad-sandbox/${NC}"
fi
echo ""

# Verify setup
echo -e "${BLUE}Verifying setup...${NC}"
if [ -L "$SANDBOX_DIR/backend" ] && [ -d "$SANDBOX_DIR/backend" ]; then
    echo -e "${GREEN}✓ Backend symlink working${NC}"
else
    echo -e "${RED}✗ Backend symlink failed${NC}"
    exit 1
fi

if [ -L "$SANDBOX_DIR/sdk" ] && [ -d "$SANDBOX_DIR/sdk" ]; then
    echo -e "${GREEN}✓ SDK symlink working${NC}"
else
    echo -e "${RED}✗ SDK symlink failed${NC}"
    exit 1
fi

if [ -L "$SANDBOX_DIR/web" ] && [ -d "$SANDBOX_DIR/web" ]; then
    echo -e "${GREEN}✓ Web symlink working${NC}"
else
    echo -e "${RED}✗ Web symlink failed${NC}"
    exit 1
fi
echo ""

# Success message
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✓ Sandbox Setup Complete                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}📁 Sandbox Structure:${NC}"
echo -e "   lad-sandbox/"
echo -e "   ├── backend/  → Feature backend"
echo -e "   ├── sdk/      → Feature SDK"
echo -e "   └── web/      → Feature test UI"
echo ""

echo -e "${BLUE}🧪 Next Steps:${NC}"
echo -e "   1. Test backend:  ${YELLOW}cd backend && npm start${NC}"
echo -e "   2. Test web UI:   ${YELLOW}cd web && npm install && npm run dev${NC}"
echo -e "   3. Test SDK:      ${YELLOW}cd sdk && npm test${NC}"
echo ""

echo -e "${BLUE}📚 Documentation:${NC}"
echo -e "   Read: ${YELLOW}SANDBOX_SETUP.md${NC} for detailed instructions"
echo ""

echo -e "${RED}⚠️  IMPORTANT REMINDERS:${NC}"
echo -e "   ${RED}• Sandbox is LOCAL ONLY${NC}"
echo -e "   ${RED}• NEVER commit lad-sandbox/ to git${NC}"
echo -e "   ${RED}• Only commit backend/ and sdk/ directories${NC}"
echo -e "   ${RED}• Sandbox links to your local feature code${NC}"
echo ""

echo -e "${GREEN}Happy developing! 🚀${NC}\n"
