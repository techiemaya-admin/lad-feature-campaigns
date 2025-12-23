#!/bin/bash

###############################################################################
# Campaign Feature Sandbox Setup Script
# 
# Purpose: Creates a self-contained sandbox for testing the feature
# Usage: ./setup-sandbox.sh [LAD_ROOT]
# 
# Two modes:
# 1. Standalone mode: Creates sandbox with feature's backend & SDK
# 2. Full LAD mode: Pass LAD_ROOT to link with full LAD application
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
FEATURE_ROOT="$(cd "$(dirname "$0")" && pwd)"
LAD_ROOT="${1:-}"
SANDBOX_DIR="lad-sandbox"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Campaign Feature Sandbox Setup          ║${NC}"
echo -e "${BLUE}║   Feature: ${FEATURE_NAME}                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Determine mode
if [ -z "$LAD_ROOT" ]; then
    echo -e "${YELLOW}Running in STANDALONE mode (feature-only)${NC}"
    echo -e "${YELLOW}To link with full LAD, run: ./setup-sandbox.sh /path/to/LAD${NC}"
    echo ""
    MODE="standalone"
else
    echo -e "${GREEN}Running in FULL LAD mode${NC}"
    if [ ! -d "$LAD_ROOT" ]; then
        echo -e "${RED}✗ Error: LAD not found at: $LAD_ROOT${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Found LAD at: $LAD_ROOT${NC}"
    MODE="full"
fi

# Create sandbox directory
echo -e "\n${BLUE}Creating sandbox directory...${NC}"
if [ -d "$SANDBOX_DIR" ]; then
    echo -e "${YELLOW}⚠ Sandbox already exists. Removing old symlinks...${NC}"
    rm -rf "$SANDBOX_DIR"
fi

mkdir -p "$SANDBOX_DIR"
echo -e "${GREEN}✓ Created $SANDBOX_DIR/${NC}"

# Create symlinks
echo -e "\n${BLUE}Creating symlinks...${NC}"

if [ "$MODE" = "standalone" ]; then
    # Standalone mode - link to feature's own backend and SDK
    
    # Backend symlink
    if [ -d "$FEATURE_ROOT/backend" ]; then
        ln -s "$FEATURE_ROOT/backend" "$SANDBOX_DIR/backend"
        echo -e "${GREEN}✓ backend/ → ./backend (feature backend)${NC}"
    else
        echo -e "${RED}✗ Error: Feature backend not found${NC}"
        exit 1
    fi
    
    # SDK symlink
    if [ -d "$FEATURE_ROOT/sdk" ]; then
        ln -s "$FEATURE_ROOT/sdk" "$SANDBOX_DIR/sdk"
        echo -e "${GREEN}✓ sdk/ → ./sdk (feature SDK)${NC}"
    else
        echo -e "${YELLOW}⚠ Warning: Feature SDK not found${NC}"
    fi
    
    echo -e "${YELLOW}⚠ No web UI in standalone mode. For full testing, provide LAD_ROOT${NC}"
    
else
    # Full LAD mode - link to main LAD repository
    
    # Backend symlink
    if [ -d "$LAD_ROOT/backend" ]; then
        ln -s "$LAD_ROOT/backend" "$SANDBOX_DIR/backend"
        echo -e "${GREEN}✓ backend/ → $LAD_ROOT/backend${NC}"
    else
        echo -e "${RED}✗ Warning: LAD backend not found${NC}"
    fi
    
    # SDK symlink
    if [ -d "$LAD_ROOT/frontend/sdk" ]; then
        ln -s "$LAD_ROOT/frontend/sdk" "$SANDBOX_DIR/sdk"
        echo -e "${GREEN}✓ sdk/ → $LAD_ROOT/frontend/sdk${NC}"
    else
        echo -e "${RED}✗ Warning: LAD frontend/sdk not found${NC}"
    fi
    
    # Web symlink
    if [ -d "$LAD_ROOT/frontend/web" ]; then
        ln -s "$LAD_ROOT/frontend/web" "$SANDBOX_DIR/web"
        echo -e "${GREEN}✓ web/ → $LAD_ROOT/frontend/web${NC}"
    else
        echo -e "${RED}✗ Warning: LAD frontend/web not found${NC}"
    fi
fi

# Update .gitignore
echo -e "\n${BLUE}Updating .gitignore...${NC}"
GITIGNORE_FILE=".gitignore"

if [ ! -f "$GITIGNORE_FILE" ]; then
    echo -e "${YELLOW}⚠ .gitignore not found, creating...${NC}"
    touch "$GITIGNORE_FILE"
fi

if ! grep -q "lad-sandbox" "$GITIGNORE_FILE"; then
    cat >> "$GITIGNORE_FILE" << 'EOF'

# Local sandbox (never commit)
lad-sandbox/
lad-sandbox/**

# Local test files
**/test-pages/
**/*-test.tsx
**/*.local.*
EOF
    echo -e "${GREEN}✓ Added sandbox exclusions to .gitignore${NC}"
else
    echo -e "${GREEN}✓ .gitignore already configured${NC}"
fi

# Verify setup
echo -e "\n${BLUE}Verifying setup...${NC}"
cd "$SANDBOX_DIR"

if [ -L "backend" ] && [ -e "backend" ]; then
    echo -e "${GREEN}✓ Backend symlink working${NC}"
else
    echo -e "${RED}✗ Backend symlink broken${NC}"
fi

if [ -L "sdk" ] && [ -e "sdk" ]; then
    echo -e "${GREEN}✓ SDK symlink working${NC}"
else
    echo -e "${YELLOW}⚠ SDK symlink not found${NC}"
fi

if [ -L "web" ] && [ -e "web" ]; then
    echo -e "${GREEN}✓ Web symlink working${NC}"
else
    if [ "$MODE" = "standalone" ]; then
        echo -e "${YELLOW}⚠ Web not available in standalone mode${NC}"
    else
        echo -e "${RED}✗ Web symlink broken${NC}"
    fi
fi

cd ..

# Success message
echo -e "\n${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✓ Sandbox Setup Complete                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"

if [ "$MODE" = "standalone" ]; then
    echo -e "\n${BLUE}📁 Sandbox Structure (Standalone):${NC}"
    echo -e "   lad-sandbox/"
    echo -e "   ├── backend/  → Feature backend"
    echo -e "   └── sdk/      → Feature SDK"
    
    echo -e "\n${BLUE}🧪 Next Steps:${NC}"
    echo -e "   1. Test backend:  ${YELLOW}cd lad-sandbox/backend && npm test${NC}"
    echo -e "   2. Test SDK:      ${YELLOW}cd lad-sandbox/sdk && npm test${NC}"
    echo -e "   3. Run test server: ${YELLOW}cd backend && node test-server.js${NC}"
    
    echo -e "\n${YELLOW}💡 For full integration testing with LAD UI:${NC}"
    echo -e "   ${YELLOW}Run: ./setup-sandbox.sh /path/to/LAD${NC}"
else
    echo -e "\n${BLUE}📁 Sandbox Structure (Full LAD):${NC}"
    echo -e "   lad-sandbox/"
    echo -e "   ├── backend/  → LAD backend"
    echo -e "   ├── sdk/      → LAD frontend SDK"
    echo -e "   └── web/      → LAD frontend web"
    
    echo -e "\n${BLUE}🧪 Next Steps:${NC}"
    echo -e "   1. Test backend:  ${YELLOW}cd lad-sandbox/backend && npm start${NC}"
    echo -e "   2. Test SDK:      ${YELLOW}cd lad-sandbox/sdk && npm test${NC}"
    echo -e "   3. Test web:      ${YELLOW}cd lad-sandbox/web && npm run dev${NC}"
fi

echo -e "\n${BLUE}📚 Documentation:${NC}"
echo -e "   Read: ${YELLOW}SANDBOX_SETUP.md${NC} for detailed instructions"

echo -e "\n${RED}⚠️  IMPORTANT REMINDERS:${NC}"
echo -e "   ${RED}• Sandbox is LOCAL ONLY${NC}"
echo -e "   ${RED}• NEVER commit lad-sandbox/ to git${NC}"
if [ "$MODE" = "full" ]; then
    echo -e "   ${RED}• Web code in sandbox is disposable${NC}"
    echo -e "   ${RED}• Only merge backend/features and sdk/features to LAD${NC}"
fi

echo -e "\n${GREEN}Happy testing! 🚀${NC}\n"
