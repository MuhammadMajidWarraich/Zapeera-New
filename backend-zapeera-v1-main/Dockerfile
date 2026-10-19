# Zapeera backend — Node + Express + TypeScript (single-host stack)
#
# Base image choice: node:22-slim (Debian/glibc), NOT Alpine/musl.
#  - The repo's Prisma generator already ships binaryTargets for
#    debian-openssl-3.0.x (this image, incl. aarch64) and
#    linux-musl-arm64-openssl-3.0.x; glibc slim is the lower-risk default
#    and matches the Node 22 used by CI (.github/workflows/ci-validate.yml).
#  - Works identically on linux/amd64 and linux/arm64 (Oracle Ampere A1).
#
# Schema handling: this project has NO prisma/migrations directory — the
# repo's supported flow is `prisma db push`, applied automatically at boot
# by src/config/schema-heal.ts (additive, fail-fast). The container entry
# therefore just starts the server; no migrate step is run here. The full
# node_modules (incl. the prisma CLI devDependency) are kept in the runtime
# image because schema-heal shells out to `npx prisma` at boot.

FROM node:22-slim AS builder
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=2048

# Prisma engines need OpenSSL + CA certs present at generate/download time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# npm run build = setup:web (prisma generate for PostgreSQL) + tsc
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Full app tree incl. node_modules + generated Prisma client + prisma/
# schemas + scripts/ (runtime shells out to npx prisma / node scripts).
COPY --from=builder /app ./

# Multer uploads (payment proofs etc.) live under cwd()/uploads and are
# served at /uploads — docker-compose mounts a named volume here.
RUN mkdir -p /app/uploads

EXPOSE 4200

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4200/health || exit 1

CMD ["node", "dist/server.js"]
