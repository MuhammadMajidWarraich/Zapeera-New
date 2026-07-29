# Zapeera Platform Deployment Guide

Complete guide for deploying Zapeera across **Web**, **Desktop (Windows/Mac/Linux)**, and **Mobile (iOS/Android)** platforms.

## Quick Start

| Platform | Command | Output |
|----------|---------|--------|
| Web (Vercel) | `npm run deploy:web` | Live URL |
| Desktop Windows | `npm run electron:dist:win:exe` | .exe installer |
| Desktop Mac | `npm run electron:dist:mac:dmg` | .dmg installer |
| Mobile Android | `npm run mobile:build:android` | .apk file |
| Mobile iOS | `npm run mobile:build:ios` | .ipa file (App Store) |

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Backend Deployment](#backend-deployment)
3. [Web Deployment](#web-deployment)
4. [Desktop Deployment](#desktop-deployment)
5. [Mobile Deployment](#mobile-deployment)
6. [Data Sync Architecture](#data-sync-architecture)
7. [Environment Variables](#environment-variables)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### All Platforms
- Node.js 18+ and npm
- Git

### Platform-Specific

**Web Deployment:**
- Vercel account (free)
- Railway or Render account (free tier available)

**Desktop (Windows):**
- Windows 10/11
- Optional: Windows code signing certificate

**Desktop (Mac):**
- macOS 12+
- Xcode 14+
- Apple Developer account ($99/year for distribution)

**Mobile (Android):**
- Android Studio
- Android SDK
- Optional: Google Play Console account ($25 one-time)

**Mobile (iOS):**
- macOS 12+
- Xcode 14+
- Apple Developer account ($99/year)

---

## Backend Deployment

### Option 1: Railway (Recommended)

1. **Push code to GitHub**
   ```bash
   git push origin main
   ```

2. **Create project on Railway**
   - Go to https://railway.app
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository

3. **Add PostgreSQL database**
   - Click "New" → "Database" → "Add PostgreSQL"
   - Railway automatically sets `DATABASE_URL`

4. **Configure environment variables**
   ```
   NODE_ENV=production
   JWT_SECRET=your-256-bit-secret-key-here
   ENCRYPTION_KEY=your-encryption-key-32chars!
   USE_POSTGRESQL=true
   ```

5. **Deploy**
   - Railway auto-deploys on every push
   - Custom domain: Settings → Domains

### Option 2: Render

1. **Create Blueprint instance**
   - Go to https://dashboard.render.com/blueprints
   - Connect GitHub repo with `render.yaml`

2. **Configure environment variables in Render Dashboard**

3. **Deploy**
   - Render auto-deploys on every push

### Backend Health Check

```bash
curl https://your-backend-url.railway.app/api/health
```

Expected response:
```json
{
  "status": "ok",
  "database": {
    "status": "online",
    "type": "postgresql"
  }
}
```

---

## Web Deployment

### Vercel (Frontend)

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Configure backend URL**
   Edit `frontend-zapeera-V1/vercel.json`:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/(.*)",
         "destination": "https://your-backend-url.railway.app/api/$1"
       }
     ]
   }
   ```

3. **Deploy**
   ```bash
   cd frontend-zapeera-V1
   npm run deploy:web
   ```

4. **Custom domain (optional)**
   - Vercel Dashboard → Domains
   - Add your domain and follow DNS instructions

---

## Desktop Deployment

### Windows (.exe installer)

```bash
cd frontend-zapeera-V1
npm run electron:dist:win:exe
```

Output: `dist_electron/Zapeera Setup 1.0.0.exe`

### macOS (.dmg installer)

```bash
cd frontend-zapeera-V1
npm run electron:dist:mac:dmg
```

Output: `dist_electron/Zapeera-1.0.0.dmg`

### Linux (.AppImage / .deb)

```bash
cd frontend-zapeera-V1
npm run electron:dist:linux
```

Outputs:
- `dist_electron/Zapeera-1.0.0.AppImage` (universal)
- `dist_electron/zapeera_1.0.0_amd64.deb` (Debian/Ubuntu)

### Code Signing (Production)

**Windows:**
1. Purchase certificate from Sectigo/DigiCert
2. Set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` env vars
3. Build will auto-sign

**macOS:**
1. Enroll in Apple Developer Program
2. Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`
3. Build will auto-sign and notarize

---

## Mobile Deployment

### Android

#### Setup
```bash
cd frontend-zapeera-V1
npm run mobile:setup
```

#### Development (emulator/device)
```bash
npm run mobile:dev:android
```

#### Build Release APK
```bash
npm run mobile:build:android
```

Output: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

#### Sign and Publish to Play Store
1. Create keystore:
   ```bash
   keytool -genkey -v -keystore zapeera.keystore -alias zapeera -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Sign APK:
   ```bash
   jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore zapeera.keystore android/app/build/outputs/apk/release/app-release-unsigned.apk zapeera
   ```

3. Upload to Google Play Console

### iOS

#### Setup (macOS only)
```bash
cd frontend-zapeera-V1
npm run mobile:setup
```

#### Development (simulator/device)
```bash
npm run mobile:dev:ios
```

#### Build for App Store
```bash
npm run mobile:build:ios
```

#### Publish to App Store
1. Open `ios/App.xcworkspace` in Xcode
2. Select "Any iOS Device (arm64)"
3. Product → Archive
4. Distribute App → App Store Connect

---

## Data Sync Architecture

Zapeera supports offline-first operation with automatic sync:

```
┌─────────────────────────────────────────────────────────┐
│                     CLOUD (PostgreSQL)                    │
│                   Railway/Render/AWS                      │
└─────────────────────────────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
           ▼                ▼                ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│     Web       │  │    Desktop    │  │    Mobile     │
│   (Online)    │  │  (Online+Offline)│  │ (Online+Offline)│
└───────────────┘  └───────────────┘  └───────────────┘
                   │    SQLite     │  │    SQLite     │
                   │  Local Store  │  │  Local Store  │
                   └───────────────┘  └───────────────┘
```

### How Sync Works

1. **Desktop/Mobile**: Uses SQLite locally for offline operation
2. **Web**: Direct PostgreSQL connection (online only)
3. **Sync**: Automatic background sync when online

### Configuring Sync

In your backend `.env`:
```
# For desktop/mobile sync support
ENABLE_SYNC=true
SYNC_BATCH_SIZE=100
SYNC_INTERVAL_MS=30000
```

---

## Environment Variables

### Backend (.env)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | ✅ | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | ✅ | 256-bit secret for tokens | `your-secret-min-32-chars-long!` |
| `ENCRYPTION_KEY` | ✅ | 32-char encryption key | `32-character-encryption-key!!` |
| `USE_POSTGRESQL` | ✅ | Force PostgreSQL mode | `true` |
| `NODE_ENV` | ✅ | Environment | `production` |
| `PORT` | ❌ | Server port | `3000` |
| `PG_CONNECTION_LIMIT` | ❌ | DB pool size | `10` |
| `PG_POOL_TIMEOUT` | ❌ | DB timeout | `15` |

### Frontend (.env.local)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_API_URL` | ✅ | Backend URL | `https://api.zapeera.com` |
| `VITE_APP_NAME` | ❌ | App display name | `Zapeera` |
| `VITE_ENABLE_ANALYTICS` | ❌ | Enable tracking | `true` |

---

## Troubleshooting

### Backend Issues

**"PostgreSQL not available"**
- Check `DATABASE_URL` is set correctly
- Verify PostgreSQL service is running
- For local dev: Use `provider = "sqlite"` in schema.prisma

**"Connection pool exhausted"**
- Reduce `PG_CONNECTION_LIMIT` to 5-10
- Check for connection leaks in code

**"JWT verification failed"**
- Ensure `JWT_SECRET` is at least 32 characters
- Same secret must be used across all backend instances

### Desktop Issues

**"Cannot find module 'electron'"**
```bash
cd frontend-zapeera-V1
npm install electron --save-dev
```

**Build fails on Windows**
- Install Visual Studio Build Tools
- Enable Windows Developer Mode

**Build fails on macOS**
- Install Xcode Command Line Tools: `xcode-select --install`
- Accept license: `sudo xcodebuild -license accept`

### Mobile Issues

**Android build fails**
- Set `JAVA_HOME` environment variable
- Update Android SDK: `sdkmanager --update`

**iOS build fails**
- Update Xcode to latest version
- Run `sudo xcode-select --reset`

**Capacitor sync fails**
```bash
cd frontend-zapeera-V1
npx cap sync --force
```

---

## Platform-Specific Notes

### Web
- Always use HTTPS in production
- Configure CORS properly on backend
- Set up CDN for static assets (optional)

### Desktop
- Auto-updates: Configure `electron-builder` publish settings
- Offline support: Already built-in with SQLite
- Data location: `~/.zapeera/data/zapeera.db`

### Mobile
- Push notifications: Configure Firebase (Android) / APNs (iOS)
- Deep linking: Set up universal links
- App stores: Prepare screenshots and descriptions

---

## Support

For deployment issues:
1. Check logs: `npm run [command] -- --verbose`
2. Review environment variables
3. Verify database connectivity
4. Open issue with platform details

---

## Summary

| Platform | Status | Deploy Command |
|----------|--------|----------------|
| Web | ✅ Ready | `vercel --prod` |
| Desktop Windows | ✅ Ready | `npm run electron:dist:win:exe` |
| Desktop Mac | ✅ Ready | `npm run electron:dist:mac:dmg` |
| Desktop Linux | ✅ Ready | `npm run electron:dist:linux` |
| Mobile Android | ✅ Ready | `npm run mobile:build:android` |
| Mobile iOS | ✅ Ready | `npm run mobile:build:ios` |

Your Zapeera platform is now configured for **universal deployment** across all platforms with automatic data sync!
