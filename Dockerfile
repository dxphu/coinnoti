FROM node:18-alpine AS builder
WORKDIR /app

# Copy package manifests first for cached dependency install
COPY package.json package-lock.json* ./

# Copy rest of the repo and build
COPY . .

RUN npm ci --silent || npm install --silent
RUN npm run build --silent

FROM nginx:stable-alpine

# Use our nginx config (listens on port 20000)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 20000

CMD ["nginx", "-g", "daemon off;"]
