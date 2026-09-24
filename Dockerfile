# Multi-stage production Dockerfile for AI Chat Platform
FROM node:20-alpine AS base

# Install build dependencies for better-sqlite3 native addon
RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Builder stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Production runner stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3010
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create data and uploads directories with permissions
RUN mkdir -p /app/data /app/uploads && chown -R nextjs:nodejs /app/data /app/uploads

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src/lib/db/schema.sql ./src/lib/db/schema.sql

USER nextjs

EXPOSE 3010

CMD ["sh", "-c", "node scripts/migrate.js && node scripts/seed.js && npm start"]
