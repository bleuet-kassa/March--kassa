# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
#  Eén image die zowel de kassa-API (/api) als de website serveert.
#  Gebruikt door de online server (Render). Lokaal verandert er niets.
# ---------------------------------------------------------------------------

# ---- 1. Website bouwen (Vite -> statische bestanden) ----
FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. Backend bouwen (NestJS + Prisma-client) ----
FROM node:22-slim AS backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate
RUN npm run build

# ---- 3. Runtime ----
FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV FRONTEND_DIR=/app/backend/public
WORKDIR /app/backend
COPY --from=backend /app/backend/node_modules ./node_modules
COPY --from=backend /app/backend/dist ./dist
COPY --from=backend /app/backend/prisma ./prisma
COPY --from=backend /app/backend/package.json ./package.json
# de gebouwde website komt in /public — die serveert de backend in productie
COPY --from=frontend /app/frontend/dist ./public
EXPOSE 3000
# eerst de database-migraties toepassen, dan de server starten
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
