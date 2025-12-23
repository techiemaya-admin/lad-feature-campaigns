# LAD Feature Sandbox Setup

Complete guide for setting up and using the local sandbox environment for feature development.

## 📁 Repository Structure

```
lad-feature-campaigns/
├── backend/                         ✅ Feature backend (committed)
├── sdk/                             ✅ Feature SDK (committed)
├── lad-sandbox/                     ❌ NEVER COMMIT (local only)
│   ├── backend/   → symlink to ../backend
│   └── sdk/       → symlink to ../sdk
├── .gitignore                       ✅ Updated to exclude lad-sandbox/
└── SANDBOX_SETUP.md                 ✅ This file
```

## 🎯 Purpose

The sandbox allows you to:
- Test your feature backend and SDK **locally**
- Work on your feature in complete isolation
- Develop and test without affecting LAD main repo
- Keep sandbox completely disposable (never committed)

## ⚙️ How It Works

The sandbox uses **symlinks** to connect to your local feature code:

```
lad-sandbox/
├── backend/  → ../backend  (your feature backend)
└── sdk/      → ../sdk      (your feature SDK)
```

This means:
- Sandbox provides isolated testing environment
- All changes stay in your feature repo
- No connection to LAD main repository
- Complete feature isolation for development

## 🚀 Quick Setup

### Option 1: Automated Setup (Recommended)

```bash
# From feature repository root
./setup-sandbox.sh
```

### Option 2: Manual Setup

```bash
# Create sandbox directory
mkdir -p lad-sandbox
cd lad-sandbox

# Create symlinks
ln -s ../backend backend
ln -s ../sdk sdk

# Update .gitignore
cd ..
echo "lad-sandbox/" >> .gitignore
```

## 🧪 Testing Workflows

### 1. Test SDK

```bash
cd sdk
npm test

# Watch mode
npm test -- --watch
```

### 2. Test Backend

```bash
cd backend
npm start
```

### 3. Develop Features

Work directly in `backend/` and `sdk/` directories:

```bash
# Edit backend
vim backend/controllers/myController.js

# Edit SDK
vim sdk/api.ts
vim sdk/hooks/useMyFeature.ts

# Run tests
cd sdk && npm test
```

## 📝 Development Workflow

1. **Develop** in `backend/` and `sdk/` directories
2. **Test** using sandbox environment
3. **Commit** only backend/ and sdk/ changes
4. **Never commit** lad-sandbox/

## 🔐 Critical Rules

### ✅ DO:
- Work in `backend/` and `sdk/` directories
- Commit backend and SDK changes
- Use sandbox for testing
- Keep files under 400 lines
- Follow feature isolation rules

### ❌ DON'T:
- Commit `lad-sandbox/` directory
- Create cross-feature dependencies
- Hardcode secrets or credentials
- Exceed 400-line file limit
- Break feature isolation

## 🔄 Merge to LAD Main

When your feature is ready:

### What Gets Merged:
```
✅ backend/              → LAD/backend/features/campaigns/
✅ sdk/                  → LAD/frontend/sdk/features/campaigns/
```

### What Never Gets Merged:
```
❌ lad-sandbox/          (local only, disposable)
```

### Pre-Merge Checklist:

- [ ] All SDK tests pass (`npm test`)
- [ ] No file exceeds 400 lines
- [ ] Feature-prefixed API routes (`/campaigns/*`)
- [ ] No cross-feature imports
- [ ] No hardcoded secrets
- [ ] Documentation updated
- [ ] Types properly exported
- [ ] Hooks domain-split if needed
- [ ] `.gitignore` excludes sandbox
- [ ] Only backend/ and sdk/ committed

## 🐛 Troubleshooting

### Symlinks Not Working?

```bash
# Check symlinks
ls -la lad-sandbox/

# Should see:
# lrwxr-xr-x backend -> ../backend
# lrwxr-xr-x sdk -> ../sdk

# Re-create if broken
rm -rf lad-sandbox
./setup-sandbox.sh
```

### Changes Not Reflecting?

- Changes to backend/ and sdk/ are immediate (symlinks)
- Restart backend server if needed: `npm start`
- Re-run SDK tests: `npm test`

### Accidentally Staged Sandbox?

```bash
# Remove from staging
git reset lad-sandbox/

# Verify .gitignore
cat .gitignore | grep lad-sandbox

# Should show: lad-sandbox/
```

### Backend Not Starting?

```bash
# Check dependencies
cd backend
npm install

# Check environment variables
cat .env.example

# Check for port conflicts
lsof -i :3000
```

## 📚 Documentation Links

- [Feature Repository Rules](../../../lad-docs/FEATURE_REPOSITORY_RULES.md)
- [LAD Feature Developer Playbook](../../../lad-docs/lad-feature-developer-playbook.md)
- [SDK Template](../../SDK_TEMPLATE.md)
- [Feature Repositories Index](../../../lad-docs/FEATURE_REPOSITORIES_INDEX.md)

## 💡 Tips

1. **Keep It Simple**: Sandbox is just for testing
2. **Stay Isolated**: Work only in your feature directories
3. **Test Often**: Run `npm test` frequently
4. **Follow Template**: Use campaigns SDK as reference
5. **Ask When Stuck**: Refer to documentation

## ⚠️ Important Reminders

- 🔴 **NEVER commit lad-sandbox/**
- 🟢 **ONLY commit backend/ and sdk/**
- 🔵 **Sandbox is LOCAL ONLY**
- 🟡 **Keep feature isolated**
- 🟣 **Follow 400-line limit**

---

**Need Help?** Check the [LAD Feature Developer Playbook](../../../lad-docs/lad-feature-developer-playbook.md)
