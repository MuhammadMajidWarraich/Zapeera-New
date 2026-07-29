# Zapeera Backend API (Node.js + Express + TypeScript)

Backend service for the Zapeera business management platform with support for web (PostgreSQL) and desktop/electron (SQLite) modes.

## Core Features

- JWT authentication with role-based authorization
- User lifecycle: signup, activation flow, login/session token management
- Password reset flow (forgot password, token verification, reset)
- Company and branch management
- Product, category, supplier, manufacturer, shelf, batch, and purchase management
- POS and sales workflow with invoices, refunds, and stock deduction
- Customer management and dashboard/report APIs
- Employee attendance, shifts, scheduled shifts, and commissions
- Settings, role management, admin operations, and subscriptions
- Real-time updates via SSE endpoints
- Data sync APIs for online/offline scenarios

## Tech Stack

- Node.js + Express
- TypeScript
- Prisma ORM
- PostgreSQL (web mode)
- SQLite (electron mode)
- Joi validation
- JWT + bcrypt
- Helmet, CORS, rate limiting, compression, morgan

## API Base

- Base URL: `http://localhost:4200/api`
- Health checks:
  - `GET /health`
  - `GET /api/health`

## Main Route Groups

- `/api/auth`
- `/api/users`
- `/api/companies`
- `/api/branches`
- `/api/products`
- `/api/customers`
- `/api/sales`
- `/api/reports`
- `/api/dashboard`
- `/api/admin`
- `/api/categories`
- `/api/suppliers`
- `/api/manufacturers`
- `/api/shelves`
- `/api/employees`
- `/api/attendance`
- `/api/shifts`
- `/api/scheduled-shifts`
- `/api/commissions`
- `/api/roles`
- `/api/refunds`
- `/api/subscription`
- `/api/batches`
- `/api/purchases`
- `/api/inventory`
- `/api/sse`
- `/api/settings`
- `/api/sync`

## Requirements

- Node.js 20+ recommended
- npm 9+ recommended
- PostgreSQL 13+ (for web mode)

## Environment Variables

Create `.env` in this directory. Typical keys:

```env
PORT=4200
NODE_ENV=development
USE_POSTGRESQL=true
POSTGRESQL_URL=postgresql://user:password@localhost:5432/zapeera?schema=public
REMOTE_DATABASE_URL=postgresql://user:password@host:5432/zapeera?schema=public
JWT_SECRET=replace-with-strong-secret
FRONTEND_URL=http://localhost:4100
```

Notes:

- Web mode uses `POSTGRESQL_URL` / `REMOTE_DATABASE_URL`.
- Runtime sets `DATABASE_URL` internally during initialization.

## Installation

```bash
npm install
```

## Run Modes

### Web mode (PostgreSQL)

```bash
npm run dev:web
```

### Electron mode (SQLite)

```bash
npm run dev:electron
```

## Build & Start

```bash
npm run build
npm run start
```

Production web build:

```bash
npm run build:prod
npm run start:web
```

## Prisma & Database Commands

```bash
npm run db:generate
npm run db:push
npm run db:migrate
npm run db:studio
npm run db:switch-postgresql
npm run db:switch-sqlite
npm run setup:web
npm run setup:electron
```

## Testing

```bash
npm test
npm run test:watch
npm run test:coverage
```

## Deployment

- Build with `npm run build:prod`
- Start with `npm run start:web` or use PM2 scripts:
  - `npm run start:pm2`
  - `npm run restart:pm2`
  - `npm run stop:pm2`

## Project Structure (high level)

- `src/controllers` - request handlers
- `src/routes` - API route modules
- `src/services` - business/data services
- `src/config` - runtime DB/environment initialization
- `prisma` - Prisma schema
