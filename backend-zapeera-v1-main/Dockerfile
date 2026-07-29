FROM node:20-bookworm-slim AS zapeera-backend-builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run setup:web
RUN npm run build
RUN npx prisma generate
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS zapeera-backend-runtime

ENV NODE_ENV=production
ENV PORT=4200

WORKDIR /app

COPY --from=zapeera-backend-builder /app/package*.json ./
COPY --from=zapeera-backend-builder /app/node_modules ./node_modules
COPY --from=zapeera-backend-builder /app/dist ./dist
COPY --from=zapeera-backend-builder /app/prisma ./prisma

EXPOSE 4200

CMD ["node", "dist/server.js"]
