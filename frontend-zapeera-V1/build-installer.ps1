# Build script for Zapeera Installer
# This script builds the NSIS installer for Windows
# IMPORTANT: Run PowerShell as Administrator to avoid symlink permission errors

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Zapeera Installer Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "WARNING: Not running as Administrator!" -ForegroundColor Yellow
    Write-Host "The build may fail due to symlink permission errors." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To fix this:" -ForegroundColor Yellow
    Write-Host "1. Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host "2. Navigate to this directory and run this script again" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

# Set environment variables to disable code signing
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:WIN_CSC_LINK = ""
$env:SKIP_NOTARIZATION = "true"

Write-Host "Building frontend..." -ForegroundColor Green
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Building backend..." -ForegroundColor Green
npm run electron:build-backend

if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Creating NSIS installer..." -ForegroundColor Green
npx electron-builder --config electron-builder.json --win

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Build completed successfully!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    $buildPath = "$env:USERPROFILE\Desktop\Zapeera-Build"
    Write-Host "Installer location: $buildPath" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Look for: Zapeera Setup 1.0.0.exe" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  Build failed!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "If you see symlink errors, run PowerShell as Administrator." -ForegroundColor Yellow
    exit 1
}


