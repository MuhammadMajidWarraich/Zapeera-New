FROM node:20-alpine AS zapeera-frontend-builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS zapeera-frontend-runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=zapeera-frontend-builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
