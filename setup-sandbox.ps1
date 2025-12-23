###############################################################################
# LAD Feature Sandbox Setup Script (PowerShell)
# 
# Purpose: Creates a local sandbox with symlinks to feature backend/sdk
# Usage: .\setup-sandbox.ps1
# 
# IMPORTANT: This sandbox is LOCAL ONLY and should NEVER be committed
###############################################################################

# Configuration
$FEATURE_NAME = "campaigns"
$SANDBOX_DIR = "lad-sandbox"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   LAD Feature Sandbox Setup" -ForegroundColor Cyan
Write-Host "   Feature: $FEATURE_NAME" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if backend and sdk directories exist
if (-not (Test-Path "backend")) {
    Write-Host "ERROR: Backend directory not found" -ForegroundColor Red
    Write-Host "  This script must be run from feature repository root" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path "sdk")) {
    Write-Host "ERROR: SDK directory not found" -ForegroundColor Red
    Write-Host "  This script must be run from feature repository root" -ForegroundColor Yellow
    exit 1
}

Write-Host "OK: Found backend and SDK directories" -ForegroundColor Green
Write-Host ""

# Create sandbox directory
Write-Host "Creating sandbox directory..." -ForegroundColor Cyan
if (Test-Path $SANDBOX_DIR) {
    Write-Host "WARNING: Sandbox already exists. Removing old symlinks..." -ForegroundColor Yellow
    Remove-Item -Path $SANDBOX_DIR -Recurse -Force
}
New-Item -ItemType Directory -Path $SANDBOX_DIR | Out-Null
Write-Host "OK: Created $SANDBOX_DIR/" -ForegroundColor Green
Write-Host ""

# Create symlinks
Write-Host "Creating symlinks..." -ForegroundColor Cyan
$currentDir = Get-Location

# Get absolute paths
$backendPath = Join-Path $currentDir "backend"
$sdkPath = Join-Path $currentDir "sdk"
$sandboxBackendPath = Join-Path $currentDir "$SANDBOX_DIR\backend"
$sandboxSdkPath = Join-Path $currentDir "$SANDBOX_DIR\sdk"

try {
    # Create backend symlink
    New-Item -ItemType SymbolicLink -Path $sandboxBackendPath -Target $backendPath -ErrorAction Stop | Out-Null
    Write-Host "OK: backend/ -> ../backend" -ForegroundColor Green
    
    # Create SDK symlink
    New-Item -ItemType SymbolicLink -Path $sandboxSdkPath -Target $sdkPath -ErrorAction Stop | Out-Null
    Write-Host "OK: sdk/ -> ../sdk" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: Failed to create symlinks" -ForegroundColor Red
    Write-Host "  Note: Symlinks on Windows require:" -ForegroundColor Yellow
    Write-Host "  1. Run PowerShell as Administrator, OR" -ForegroundColor Yellow
    Write-Host "  2. Enable Developer Mode in Windows Settings" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  To enable Developer Mode:" -ForegroundColor Cyan
    Write-Host "  Settings -> Update and Security -> For Developers -> Developer Mode" -ForegroundColor Cyan
    exit 1
}
Write-Host ""

# Update .gitignore
Write-Host "Updating .gitignore..." -ForegroundColor Cyan
if (Test-Path ".gitignore") {
    $gitignoreContent = Get-Content ".gitignore" -Raw
    if ($gitignoreContent -match "lad-sandbox") {
        Write-Host "OK: .gitignore already configured" -ForegroundColor Green
    }
    else {
        Add-Content -Path ".gitignore" -Value "`n# Sandbox (LOCAL ONLY - never commit)`nlad-sandbox/"
        Write-Host "OK: Added lad-sandbox/ to .gitignore" -ForegroundColor Green
    }
}
else {
    Set-Content -Path ".gitignore" -Value "lad-sandbox/"
        Write-Host "OK: Created .gitignore with lad-sandbox/" -ForegroundColor Green
}
Write-Host ""

# Verify setup
Write-Host "Verifying setup..." -ForegroundColor Cyan
if ((Get-Item $sandboxBackendPath).LinkType -eq "SymbolicLink" -and (Test-Path $sandboxBackendPath)) {
    Write-Host "OK: Backend symlink working" -ForegroundColor Green
}
else {
    Write-Host "ERROR: Backend symlink failed" -ForegroundColor Red
    exit 1
}

if ((Get-Item $sandboxSdkPath).LinkType -eq "SymbolicLink" -and (Test-Path $sandboxSdkPath)) {
    Write-Host "OK: SDK symlink working" -ForegroundColor Green
}
else {
    Write-Host "ERROR: SDK symlink failed" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Success message
Write-Host "============================================" -ForegroundColor Green
Write-Host "   Sandbox Setup Complete" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

Write-Host "Sandbox Structure:" -ForegroundColor Cyan
Write-Host "   lad-sandbox/"
Write-Host "   +-- backend/  -> Feature backend"
Write-Host "   +-- sdk/      -> Feature SDK"
Write-Host ""

Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Test backend:  cd backend; npm start" -ForegroundColor Yellow
Write-Host "   2. Test SDK:      cd sdk; npm test" -ForegroundColor Yellow
Write-Host "   3. Develop features in backend/ and sdk/ directories"
Write-Host ""

Write-Host "Documentation:" -ForegroundColor Cyan
Write-Host "   Read SANDBOX_SETUP.md for detailed instructions"
Write-Host ""

Write-Host "IMPORTANT REMINDERS:" -ForegroundColor Red
Write-Host "   - Sandbox is LOCAL ONLY" -ForegroundColor Red
Write-Host "   - NEVER commit lad-sandbox/ to git" -ForegroundColor Red
Write-Host "   - Only commit backend/ and sdk/ directories" -ForegroundColor Red
Write-Host "   - Sandbox links to your local feature code" -ForegroundColor Red
Write-Host ""

Write-Host "Happy developing!" -ForegroundColor Green
Write-Host ""
