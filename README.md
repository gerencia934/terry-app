# Terra Viva — Plataforma de Gestión Integral de Residuos

Trazabilidad de residuos para **Terra Viva S.A.S. E.S.P.**: declaraciones, logística, inspecciones,
manifiestos, recepción en planta, certificados, permisos ambientales e indicadores.

```
apps/web         App web (React + Vite): oficina + app del conductor
apps/api         API (NestJS + Prisma): autenticación, reglas de negocio, importación de Excel
packages/db      Esquema, migraciones y datos iniciales (PostgreSQL)
packages/shared  Reglas compartidas web/API (plantillas y validaciones de importación)
docs/            Arquitectura, requisitos y plantillas de Excel
```

## Conectar desde su computador (Windows, Mac o Linux)

Necesita **Node.js 22** (nodejs.org) y **Docker Desktop** (docker.com). Abra una terminal en la carpeta del proyecto.

**1. Configurar.** Copie `.env.example` como `.env` y complete `JWT_SECRET` con un valor largo. Puede generarlo con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

En el mismo `.env` ponga `SEED_ADMIN_PASSWORD` con la contraseña inicial del administrador.

**2. Levantar base de datos y API** (la primera vez tarda unos minutos):

```bash
docker compose up -d --build
```

**3. Cargar los datos iniciales** (empresa, roles, permisos de la CAS, catálogos, flota, administrador):

```bash
docker compose exec api npm run db:seed
```

**4. Verificar el API.** Abra http://localhost:3000/api/v1/salud — debe decir `"estado":"ok"`.

**5. Abrir la app web conectada al API:**

```bash
npm install
```

```bash
echo VITE_API_URL=http://localhost:3000/api/v1 > apps/web/.env
```

```bash
npm run dev:web
```

Entre a http://localhost:5173 con `gerencia@terravivasas.com` y la contraseña de `SEED_ADMIN_PASSWORD`.
Cámbiela después del primer ingreso (Olvidé mi contraseña).

**6. Cargar sus datos reales** en Ajustes › Importar datos, en este orden: clientes → sedes → vehículos y
usuarios → declaraciones → tarifas. Las plantillas están en `docs/plantillas`.

### Sin Docker (PostgreSQL instalado en el equipo)

Cree la base `terraviva`, copie `apps/api/.env.example` como `apps/api/.env` con su `DATABASE_URL` y ejecute:

```bash
npm install && npm run db:migrate && npm run db:seed && npm run dev:api
```

## Pruebas

Con el API corriendo y la base sembrada (`ADMIN_PASSWORD` = la de `SEED_ADMIN_PASSWORD`):

```bash
ADMIN_PASSWORD='su-clave' DATABASE_URL=postgresql://terraviva:terraviva@localhost:5432/terraviva npm run test:e2e
```

37 pruebas: autenticación, sesiones, roles, aislamiento entre empresas, importación de Excel,
permisos ambientales, residuos no autorizados, inspección vehicular, tarifas y auditoría.

## Modo demostración

Sin `VITE_API_URL`, la app usa datos de ejemplo (`apps/web/src/data/mock.ts`) y no guarda nada.
`npm run build:demo -w @terraviva/web` genera un solo archivo HTML para mostrar el prototipo.

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) y [docs/REQUISITOS_FUNCIONALES.md](docs/REQUISITOS_FUNCIONALES.md).
