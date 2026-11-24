# Stage 1: Build TypeScript server bundle
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.server.json ./
COPY server ./server
COPY functions ./functions
RUN npm run build:server

# Stage 2: Minimal production runtime (~85 MB, non-root)
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist-server ./dist-server

USER node
EXPOSE 8080

CMD ["node", "dist-server/index.mjs"]
