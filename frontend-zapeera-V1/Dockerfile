FROM node:20-alpine AS zapeera-frontend-builder

WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=2048

# Single-host build args (2026-10-15): relative /api URLs keep ONE build
# valid on any domain (test: zapeera.seikho.online; later: Zapeera's own
# domain) — moving domains never needs a rebuild. VITE_* values are baked
# in at build time by Vite, so they are passed as build args from
# docker-compose.yml / the root .env.
ARG VITE_API_BASE_URL=/api
ARG VITE_SSE_BASE_URL=/api
ARG VITE_CLOUD_API_URL=https://api.zapeera.seikho.online/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SSE_BASE_URL=$VITE_SSE_BASE_URL \
    VITE_CLOUD_API_URL=$VITE_CLOUD_API_URL

COPY package*.json ./
RUN npm install -g npm@11 && npm ci --legacy-peer-deps

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS zapeera-frontend-runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=zapeera-frontend-builder /app/dist /usr/share/nginx/html

# QA B-1: files copied from public/ keep their source permissions, which
# can be 0660 (group-only) depending on how the tree was extracted — the
# nginx worker then gets 403 on favicon/logo/health.html/share-modal.js
# while Vite-generated assets (fresh 0644) work. Make the whole tree
# world-readable in the image, regardless of source perms.
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
