# Electron Build Guide - Complete Setup

## Overview
The Electron app includes:
1. **Frontend** - React/Vite application (built to `dist/`)
2. **Backend** - Embedded server (`electron/embedded-server.js`) + Full backend (`backend-zapeera-v1-main/dist`)
3. **Database** - SQLite (offline-first) with optional PostgreSQL sync

## Build Process

### Prerequisites
1. Build backend for Electron mode (SQLite)
2. Build frontend
3. Package with electron-builder

### Step-by-Step Build

#### 1. Build Backend for Electron
```bash
cd backend-zapeera-v1-main
npm run setup:electron  # Switches to SQLite schema and generates Prisma client
npm run build            # Compiles TypeScript to JavaScript
```

#### 2. Build Frontend
```bash
cd frontend-zapeera-V1
npm run build            # Builds React app with Vite
```

#### 3. Build Electron App
```bash
cd frontend-zapeera-V1
npm run electron:dist:win    # Windows
npm run electron:dist:mac    # macOS
npm run electron:dist:linux  # Linux
```

### Automated Build (All-in-One)
The build scripts now automatically:
- Build frontend
- Build backend (with SQLite setup)
- Package Electron app

Just run:
```bash
cd frontend-zapeera-V1
npm run electron:dist:win
```

## What's Included in Electron App

### Files Included:
- ✅ `frontend-zapeera-V1/dist/` - Built frontend
- ✅ `backend-zapeera-v1-main/dist/` - Built backend server
- ✅ `backend-zapeera-v1-main/node_modules/` - All backend dependencies
- ✅ `backend-zapeera-v1-main/prisma/` - Prisma schema and migrations
- ✅ `electron/embedded-server.js` - Standalone SQLite server (fallback)
- ✅ `electron/main.js` - Electron main process
- ✅ `electron/preload.js` - Preload script
- ✅ `bundled-node/win/node.exe` - Node.js runtime (Windows)

### Dependencies Included:
- ✅ All Express dependencies
- ✅ Prisma Client and query engines
- ✅ bcryptjs, jsonwebtoken, joi
- ✅ PostgreSQL client (pg)
- ✅ All backend npm packages

## Server Modes

### Development Mode
- Tries external backend first (`backend-zapeera-v1-main/dist/server.js`)
- Falls back to embedded server if external fails

### Production Mode
- Uses embedded server directly (more reliable)
- Falls back to external backend if embedded fails

## Database
- **Primary**: SQLite (stored in `app.getPath('userData')`)
- **Sync**: PostgreSQL (optional, background sync)
- **Location**: `%USERPROFILE%\.zapeera\data\zapeera.db` (Windows)

## Verification

After building, verify:
1. ✅ Backend `dist/` folder exists
2. ✅ Prisma client generated (`.prisma/client/`)
3. ✅ Frontend `dist/` folder exists
4. ✅ All node_modules included
5. ✅ Embedded server file exists

## Troubleshooting

### Backend not starting
- Check if `backend-zapeera-v1-main/dist/server.js` exists
- Verify Prisma client is generated
- Check logs in `%USERPROFILE%\.zapeera\logs\`

### Missing dependencies
- Ensure `electron:build-backend` runs before packaging
- Check `electron-builder.json` includes all dependencies
- Verify `asarUnpack` includes Prisma files

### Database issues
- SQLite database is created automatically
- Check write permissions in userData directory
- Verify database path in logs

