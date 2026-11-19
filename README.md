# TERRY-GO — Plataforma de Gestión Integral de Residuos de Terra Viva

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
usuarios → declaraciones → tarifas. Las plantillas están en `docs/plantillas`. Se suben en Excel o en CSV (el separador se
detecta solo), y un cargue de declaraciones equivocado se puede deshacer: sus declaraciones quedan anuladas, no se borran.

**Usuario de la base y portal de clientes.** El usuario que crea la imagen de PostgreSQL de Docker es superusuario, y
PostgreSQL deja que un superusuario se salte la seguridad por filas (RLS), la segunda barrera del portal de clientes. En
su computador el API solo lo advierte al arrancar. En producción (`NODE_ENV=production`) no arranca así: debe conectarse
con un usuario sin superusuario ni BYPASSRLS, como ya lo hacen las pruebas automáticas de GitHub.

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

334 pruebas: autenticación, sesiones (también cerrar en todos los dispositivos), aceptación de la política de datos,
límites de peticiones, roles, aislamiento entre empresas, clientes y sedes, tarifas, permisos y gestores aliados, flota e inspecciones, usuarios (invitación, inactivar cierra sesiones), inicio, indicadores y recepción en planta, importación de Excel y CSV (también deshacer un cargue),
declaraciones (crear, completar y editar desde el formulario de 8 secciones) y permisos ambientales,
residuos no autorizados, inspección vehicular, tarifas, auditoría (con IP e inmutable) y la cadena operativa completa:
programación por línea, ruta, GPS, manifiesto con firma y fotos, conciliación, certificado PDF con QR y hash, actas de
aliados e informes, y el portal de clientes: un cliente no ve nada de otro (listados, detalle, descargas con enlace
firmado, filtros e informes), ni por el API ni en la base (RLS); el administrador del cliente carga sus declaraciones
(quedan en revisión), pide servicios y cancela los que nadie ha confirmado. Al final prueban el límite de ingresos: durante un
minuto esa IP no puede volver a ingresar.

Reglas de la cadena operativa escritas directamente en la base (sin API), sobre una base migrada y sembrada:

```bash
DATABASE_URL=postgresql://terraviva:terraviva@localhost:5432/terraviva npm run test:reglas -w @terraviva/db
```

82 pruebas: aprobación y programación por línea, rutas y rastreo GPS (también sin señal), grabar y anular manifiestos,
conciliación, actas, descargue en planta, las reglas de cumplimiento de la gerencia, deshacer un cargue, el historial de cumplimiento de obligaciones y los usuarios del portal de clientes (perfil, sedes y RLS) y lo que puede escribir una sesión del portal.

**En GitHub** (`.github/`), cada cambio en `main` o en una rama `fase-*`, y cada pull request, corre solo:
- **Pruebas:** compila todo, migra y siembra una base nueva y corre las dos suites. También falla si una librería de
  producción tiene una vulnerabilidad crítica.
- **CodeQL:** escaneo de seguridad del código.
- **Dependabot:** cada lunes propone actualizar librerías.

**Prueba de carga** (400 usuarios concurrentes, solo en staging): `apps/api/test/carga/LEAME.md`.

## App del conductor (celular, sin señal)

Con `VITE_API_URL` definido, la ruta `#campo` es la app de campo conectada al API: ruta del día, inspección del
vehículo, etapas con kilometraje, manifiestos con fotos, báscula y firma táctil, y la bandeja «Envíos».

- **Instalar en el celular:** abra la web publicada (con `https`) en Chrome y elija «Instalar aplicación» o «Agregar a
  pantalla de inicio». Desde ahí abre como app, incluso sin señal.
- **Sin señal:** descargue la ruta del día con señal (en planta) y trabaje normal. Todo queda en el teléfono y se envía
  solo al recuperar la conexión.
- **Detalle técnico:** `docs/operacion/MODELO_OPERACION.md`, sección 7.

## Torre de control (oficina)

En modo servidor, la oficina maneja la cadena completa:
- **Logística:**
  - **Solicitudes** y **Por confirmar:** crear, aprobar o cancelar.
  - **Programación:** calendario de rutas y líneas aprobadas por programar.
  - **Programación en tabla** y **Seguimiento** del día.
- **Campo y HSEQ:** **Manifiestos**, con fotos, firma, PDF escaneado y anulación.
- **Planta Los Pinos:**
  - **Conciliación:** bandeja y grilla con totales en vivo, aprobación y factura.
  - **Certificados:** emitir con QR, descargar varios en ZIP y cargar actas de aliados.

**Código QR de los certificados.** Lleva a `<web>/#verificar/<código>`. Esa página es pública: cualquiera confirma si el
documento es auténtico, sin entrar a TERRY-GO y sin ver datos del cliente. Para que el enlace del QR sea el correcto,
ponga en `WEB_URL` (en `apps/api/.env`) la dirección pública de la web. Detalle: `docs/operacion/MODELO_OPERACION.md`,
sección 8.

## Modo demostración

Sin `VITE_API_URL`, la app usa datos de ejemplo (`apps/web/src/data/mock.ts`) y no guarda nada.
`npm run build:demo -w @terraviva/web` genera un solo archivo HTML para mostrar el prototipo.

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) y [docs/REQUISITOS_FUNCIONALES.md](docs/REQUISITOS_FUNCIONALES.md).
