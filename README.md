# Terra Viva — Plataforma de Gestión Integral de Residuos

Gestión de declaraciones, logística de recolección, operación HSEQ en campo, documentos de
trazabilidad e indicadores para **Terra Viva S.A.S. E.S.P.**

## Estructura

```
apps/web        Frontend React + Vite (admin web + vista de conductor)
packages/db     Esquema Prisma/PostgreSQL y reglas de negocio en SQL
docs/           Arquitectura y fases
```

## Ejecutar el prototipo

```bash
cd apps/web
npm install
npm run dev          # http://localhost:5173/#login
npm run build:demo   # genera dist-demo/index.html (un solo archivo, se abre sin servidor)
```

## Base de datos

```bash
cd packages/db
npm install
export DATABASE_URL=postgresql://usuario:clave@localhost:5432/terraviva
npx prisma validate
npx prisma migrate dev --name init
psql "$DATABASE_URL" -f prisma/reglas_negocio.sql
```

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

> El prototipo usa datos de demostración: servicios, permisos de la CAS e infraestructura vienen del
> portafolio 2026. Clientes, personas, placas y cifras son ficticios.
