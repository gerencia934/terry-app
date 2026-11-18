# Imagen del API (se construye desde la raíz del repositorio).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps/api apps/api
RUN npx prisma generate --schema packages/db/prisma/schema.prisma \
 && npm run build -w @terraviva/shared && npm run build -w @terraviva/api

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/api/v1/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Aplica migraciones pendientes y arranca
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma && node apps/api/dist/main.js"]
