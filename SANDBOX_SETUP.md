# Local Sandbox Setup for Feature Development

## 🎯 Purpose

The sandbox allows you to test your feature in two modes:
1. **Standalone**: Test feature backend and SDK independently
2. **Full LAD Integration**: Test with complete LAD stack including web UI

## 🚨 Critical Rules

- ✅ Sandbox is LOCAL ONLY
- ✅ Sandbox is GITIGNORED
- ✅ Web code in sandbox is DISPOSABLE
- ❌ NEVER commit sandbox to feature repo
- ❌ NEVER merge sandbox to LAD main

## 📁 Sandbox Structure

### Standalone Mode (Default)
```
lad-feature-campaigns/
├── backend/                         ✅ Feature backend (committed)
├── sdk/                             ✅ Feature SDK (committed)
├── lad-sandbox/                     ❌ NEVER COMMIT (local only)
│   ├── backend/   → symlink to ./backend
│   └── sdk/       → symlink to ./sdk
├── .gitignore                       ✅ Updated to exclude lad-sandbox/
└── SANDBOX_SETUP.md                 ✅ This file
```

### Full LAD Mode (Optional)
```
lad-feature-campaigns/
├── backend/                         ✅ Feature backend (committed)
├── sdk/                             ✅ Feature SDK (committed)
├── lad-sandbox/                     ❌ NEVER COMMIT (local only)
│   ├── backend/   → symlink to LAD/backend
│   ├── sdk/       → symlink to LAD/frontend/sdk
│   └── web/       → symlink to LAD/frontend/web
└── ...
```

## 🛠️ Setup Instructions

### Quick Start (Standalone Mode)

```bash
# From feature repository root
./setup-sandbox.sh

# This creates:
# - lad-sandbox/backend -> ./backend
# - lad-sandbox/sdk -> ./sdk
```

### Full LAD Integration Mode

```bash
# Provide path to LAD repository
./setup-sandbox.sh /path/to/LAD

# Or on Windows/WSL:
./setup-sandbox.sh /mnt/d/techiemaya/LAD
```

### Manual Setup

# Link to LAD frontend SDK
ln -s /path/to/LAD/frontend/sdk sdk

# Link to LAD frontend web
ln -s /path/to/LAD/frontend/web web
```

### 3. Update LAD Paths (if needed)

Edit `setup-sandbox.sh` to point to your LAD installation:

```bash
LAD_ROOT="/Users/naveenreddy/Desktop/AI-Maya/LAD"
```

### 4. Verify Setup

```bash
# Check symlinks are created
ls -la lad-sandbox/

# Should see:
# backend -> /path/to/LAD/backend
# sdk -> /path/to/LAD/frontend/sdk
# web -> /path/to/LAD/frontend/web
```

## 🧪 Testing Your Feature

### Backend Testing

```bash
# Navigate to LAD backend
cd lad-sandbox/backend

# Your feature is available at:
# backend/features/campaigns/

# Run backend server
npm start

# Test your endpoints
curl http://localhost:5001/campaigns
```

### SDK Testing

```bash
# Navigate to SDK
cd lad-sandbox/sdk

# Your feature SDK is at:
# sdk/features/campaigns/

# Run SDK tests
npm test

# Or test specific feature
npm run test:sdk:campaigns
```

### Frontend Testing (Optional)

If you need to test UI integration:

```bash
# Navigate to web
cd lad-sandbox/web

# Import your SDK
import { useCampaigns } from '@/sdk/features/campaigns';

# Create test pages in:
# web/src/app/(features)/campaigns-test/page.tsx

# Run dev server
npm run dev
```

**IMPORTANT:** Any web code you create in the sandbox is **disposable**. Real web implementation should be done in the LAD repository.

## 📦 What Gets Merged to LAD

When your feature is ready, **ONLY** these folders are merged:

```bash
✅ backend/features/campaigns/
✅ frontend/sdk/features/campaigns/
```

**NEVER merge:**
```bash
❌ lad-sandbox/
❌ frontend/web/ (if created in sandbox)
```

## 🔄 Workflow

### 1. Development
```bash
# Develop in feature repo
├── backend/features/campaigns/     ← Edit here
└── frontend/sdk/features/campaigns/ ← Edit here
```

### 2. Local Testing
```bash
# Test via sandbox symlinks
lad-sandbox/
├── backend/ → sees your feature changes
├── sdk/ → sees your SDK changes
└── web/ → use for disposable UI tests
```

### 3. Merge to LAD
```bash
# Copy to LAD (only feature folders)
cp -r backend/features/campaigns/ /path/to/LAD/backend/features/
cp -r frontend/sdk/features/campaigns/ /path/to/LAD/frontend/sdk/features/
```

## 🚧 Common Issues

### Issue: Symlinks not working
**Solution:** Use absolute paths, not relative:
```bash
ln -s /Users/you/Desktop/LAD/backend backend  # ✅ Good
ln -s ../../LAD/backend backend               # ❌ Might break
```

### Issue: Changes not reflected in sandbox
**Solution:** Check if you're editing the feature files, not the LAD files:
```bash
# Edit these (feature repo):
backend/features/campaigns/
frontend/sdk/features/campaigns/

# NOT these (LAD repo):
LAD/backend/features/campaigns/
LAD/frontend/sdk/features/campaigns/
```

### Issue: Web code getting committed
**Solution:** Ensure `.gitignore` includes:
```gitignore
# Sandbox (never commit)
lad-sandbox/
lad-sandbox/**

# Local testing files
**/test-pages/
**/*-test.tsx
```

## ✅ Pre-Merge Checklist

Before merging to LAD, verify:

- [ ] No files > 400 lines
- [ ] APIs are feature-prefixed (`/campaigns/*`)
- [ ] SDK has no Next.js/JSX/CSS imports
- [ ] All SDK tests pass (`npm test`)
- [ ] Backend tests pass
- [ ] `lad-sandbox/` is not in git
- [ ] No web code in feature repo
- [ ] Feature follows LAD architecture

## 📚 Additional Resources

- [LAD Feature Developer Playbook](../../../lad-docs/lad-feature-developer-playbook.md)
- [SDK Template](../../SDK_TEMPLATE.md)
- [Backend Feature Guidelines](../../../backend/README.md)

## 🆘 Need Help?

If sandbox setup fails:
1. Check symlink paths are absolute
2. Verify LAD is cloned and built
3. Ensure you have proper file permissions
4. Check `.gitignore` includes `lad-sandbox/`

---

**Version:** 1.0  
**Last Updated:** 23 December 2025  
**Purpose:** Local development and testing only - NEVER commit sandbox
