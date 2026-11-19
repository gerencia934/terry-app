# Arquitectura — TERRY-GO (plataforma de Terra Viva)

## 1. Cadena de trazabilidad (núcleo del sistema)

```
Cliente → Sede → Declaración (+Tarifa) → Solicitud → Parada del recorrido
       → Manifiesto → Recepción y pesaje (PSA Los Pinos) → Certificado → Factura
```

Cada eslabón referencia al anterior. Si un registro rompe la cadena se pierde el soporte del
certificado ante la CAS o el cliente.

## 2. Stack

| Capa | Tecnología | Estado |
|---|---|---|
| Web + app del conductor | React 18 + Vite 6 + TypeScript + Tailwind 3 | Hecho (modo demostración y modo servidor) |
| API | NestJS 11 + Prisma 6 (monolito modular) | **Hecho — fase 1** |
| Base de datos | PostgreSQL 16 (imagen con PostGIS) | 60 tablas, 8 migraciones, reglas de toda la cadena en la base (ver `docs/operacion/MODELO_OPERACION.md`) |
| Reglas compartidas | `packages/shared` (validaciones e importación de Excel) | Hecho |
| Correo | Nodemailer (SMTP); sin SMTP escribe en la consola | Hecho |
| Archivos | S3 / Cloudflare R2 (fotos, firmas, PDF) | Fase 2 |
| PDF | Gotenberg (HTML → PDF) | Fase 2 |
| Integraciones | Factura electrónica DIAN, RNDC | Fase 3 |

## 3. API (`apps/api`, prefijo `/api/v1`)

| Módulo | Rutas | Reglas |
|---|---|---|
| Auth | `POST auth/login · renovar · salir · recuperar · restablecer`, `GET auth/yo` | argon2id; token de acceso 15 min; token de renovación rotativo (reuso ⇒ cierra todas las sesiones); bloqueo 15 min tras 5 intentos; respuestas que no revelan si un correo existe |
| Clientes | `GET/POST clientes`, `POST clientes/:id/sucursales` | DV del NIT calculado (DIAN) |
| Declaraciones | `GET/POST declaraciones`, `GET declaraciones/catalogos`, `PATCH :id/estado`, `PATCH :id/activa`, `POST tarifas/masivas` | Una declaración por residuo y cliente, con N sedes y N disposiciones. No autoriza si alguna disposición no está cubierta por permiso de la CAS, licencia vigente del gestor aliado u objeto social (regla también en la base); peligroso exige FDS; tarifas con vigencias. Ver `docs/declaraciones/MODELO_DATOS.md` |
| Logística | `solicitudes` (+ `:id/aprobacion`, `:id/estado`, `items/:id/descartar`), `rutas` (código automático R-AAAAMMDD-NN), `PATCH rutas/:id`, `rutas/:id/items`, `rutas/:id/rastreo`, `programacion/pendientes`, `PATCH rutas/:id/estado`, `preoperacionales`, `PATCH paradas/:id` | Solo residuos autorizados (trigger); la ruta no inicia sin inspección aprobada (trigger); cancelar siempre se permite |
| Cumplimiento | `permisos-ambientales`, `PATCH obligaciones/:id/cumplida`, `alertas`, `catalogos`, `vehiculos`, `personal`, `zonas`, `estados-recorrido`, `elementos-chequeo`, `salud` | Alertas de obligaciones, SOAT/RTM/póliza, licencias y curso MP, rutas sin inspección |
| Importación | `GET importacion/plantillas[/:id/archivo]`, `POST importacion/:id/vista-previa · confirmar`, `GET historial` | Revalida todo en servidor; guarda en una transacción; registra el cargue |
| Manifiestos | `manifiestos`, `desde-ruta`, `:id/items`, `:id/evidencias`, `:id/grabar`, `:id/anular` | Firma táctil, báscula, ARL/EPS de terceros; al grabar abre la conciliación (regla en la base) |
| Conciliaciones | `conciliaciones`, `consolidado`, `:id/items`, `:id/igualar · aprobar · reabrir`, `:id/excel` | Totales por unidad (shared); ±2 % con justificación; aprobada solo cambia factura/pago |
| Actas | `actas`, `pendientes`, `:id/emitir`, `cargar`, `:id/pdf`, `zip`, `verificar/:código` (pública; el QR abre `<web>/#verificar/<código>`) | Solo líneas aprobadas; soporte legal a la fecha del servicio; PDF con QR (pdfkit) |
| Informes | `informes/rutas/rendimiento`, `informes/rutas/costos` | Cumplimiento por ruta/día/rango; fletes en Excel |
| Archivos | `archivos?clave=` | Carpeta local por empresa (S3/R2 en producción); tipo real validado |

Detalle de la cadena operativa: `docs/operacion/MODELO_OPERACION.md`.

Transversal: guard global (toda ruta exige token salvo `@Publico()`), permisos por rol con `@Permiso()`,
**aislamiento por empresa** en cada consulta (`empresa_id` del token), auditoría de cada cambio,
límite de peticiones, Helmet, CORS solo para la web, errores en español (los RAISE de la base se
traducen a 409 con el mensaje de la regla).

Roles iniciales: Administrador, Logística, HSEQ, Comercial, Facturación, Conductor, Auxiliar.

## 4. Base de datos (`packages/db`)

- `prisma/schema.prisma` + `prisma/migrations/` (inicial y reglas de negocio).
- Reglas en la base: tolerancia de báscula ±2 % con explicación obligatoria (CHECK), ruta sin
  inspección aprobada no inicia (trigger), ítem de solicitud solo con declaración autorizada (trigger).
- `prisma/seed.mjs`: idempotente. Empresa (NIT 901.089.780-8), roles, permisos ambientales de la CAS
  (obligaciones de ejemplo marcadas «VERIFICAR»), catálogos, zonas, etapas, elementos de inspección,
  flota y usuario administrador.

## 5. Web (`apps/web`)

- `lib/api.ts`: cliente HTTP con renovación automática del token. `VITE_API_URL` activa el modo servidor.
- Conectado al servidor hoy: ingreso, recuperar/restablecer contraseña, Declaraciones, Importar datos, alertas, la app
  del conductor (`pages/CampoServidor.tsx`) y la torre de control (`pages/torre/`): Solicitudes, Por confirmar,
  Programación (calendario y por línea), Programación en tabla, Seguimiento, Manifiestos, Conciliación y Certificados.
  La página pública `#verificar/<código>` (`pages/Verificar.tsx`) no pide sesión. Las demás secciones muestran un aviso
  de «datos de ejemplo» en modo servidor.
- Navegación lateral por procesos (Comercial, Logística, Campo y HSEQ, Planta, Cumplimiento, Análisis,
  Ajustes) y buscador con Ctrl + K.
- Móvil: tablas que se vuelven tarjetas, filtros en hoja inferior, calendario que pasa a agenda,
  app del conductor con botones grandes.

## 6. Fases

| Fase | Alcance | Estado |
|---|---|---|
| 0 | Esquema, prototipo, importación de Excel | ✅ |
| 1 | API con autenticación, declaraciones, logística, cumplimiento, importación; web conectada en ingreso, declaraciones e importación | ✅ |
| 1b / 3 | Núcleo operativo: modelo y reglas (3-A), API (3-B), app del conductor sin señal (3-C) y torre de control (3-D) | ✅ |
| 1c | Conectar a la API lo que aún es de ejemplo: clientes, tarifas, inspecciones (vista de oficina), inventario, permisos, indicadores y ajustes | Siguiente |
| 2 | PDF de manifiestos y certificados, fotos y firmas en S3, tarea diaria de alertas por correo | |
| 3 | Factura electrónica DIAN, RNDC, portal del cliente | |
