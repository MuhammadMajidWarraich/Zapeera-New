# Zapeera Frontend (React + Vite + Electron)

Frontend application for the Zapeera business management platform.  
Supports:

- Web deployment (Vite production build)
- Desktop app packaging (Electron + electron-builder)

## Core Features

- Secure login/signup flow and password reset
- Role-based routing and guarded pages
- Dashboard views for business and Zapeera admin contexts
- POS workflows: sales, invoices, refunds, and check-in/performance
- Inventory management:
  - Medical and non-medical products
  - Categories
  - Manufacturers
  - Suppliers
  - Shelves
  - Batches
  - Purchases and order purchase
- Customer and reporting modules
- Branch/company/user/admin/subscription management pages
- Realtime notifications (SSE-based integration)
- Works with backend API in web mode and localhost backend in Electron mode

## Tech Stack

- React 18 + TypeScript
- Vite
- React Router (HashRouter)
- TanStack React Query
- Tailwind CSS + Radix UI
- Recharts for analytics
- Electron + electron-builder for desktop distribution

## Requirements

- Node.js 20+ recommended
- npm 9+ recommended

## Environment Variables

Frontend expects Vite environment variables (example):

```env
VITE_API_BASE_URL=http://localhost:4200/api
VITE_API_TIMEOUT=30000
VITE_APP_NAME=Zapeera
VITE_APP_VERSION=1.0.0
VITE_DEBUG_MODE=false
VITE_LOG_LEVEL=info
VITE_ENABLE_ANALYTICS=false
VITE_ENABLE_DEBUG_LOGS=false
VITE_DEFAULT_THEME=light
VITE_ITEMS_PER_PAGE=10
```

Notes:

- In Electron runtime, frontend uses local backend (`http://localhost:4200/api`).
- In production web mode, `VITE_API_BASE_URL` must be set.

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production Build (Web)

```bash
npm run build:prod
npm run preview:prod
```

## Standard Build

```bash
npm run build
npm run preview
```

## Electron Development

```bash
npm run electron:dev
```

## Electron Distribution Builds

```bash
npm run electron:dist:win
npm run electron:dist:mac
npm run electron:dist:mac:dmg
npm run electron:dist:linux
```

Full multi-platform build:

```bash
npm run electron:dist:all
```

## Linting

```bash
npm run lint
```

## Project Structure (high level)

- `src/pages` - main route pages
- `src/components` - reusable UI and feature components
- `src/contexts` - auth/admin/dashboard state providers
- `src/hooks` - shared hooks (including realtime integration)
- `src/lib` - shared config/util logic
- `electron` - desktop runtime entry and packaging assets
