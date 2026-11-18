# Arquitectura — Plataforma de Gestión Integral Terra Viva

## 1. Hilo de trazabilidad (núcleo del sistema)

```
Cliente → Sucursal → Declaración (+Tarifa) → Solicitud → Parada de ruta
       → Manifiesto (origen) → Conciliación (báscula PSA Los Pinos) → Acta / Certificado → Factura
```

Cada eslabón referencia al anterior por llave foránea. Si un registro rompe la cadena se pierde
el soporte del certificado de disposición final ante la CAS o el cliente.

## 2. Stack

| Capa | Tecnología | Estado |
|---|---|---|
| Frontend web + PWA | React 18 + Vite 6 + TypeScript + Tailwind 3 | **Prototipo funcional** (`apps/web`) |
| Gráficos | Recharts (paleta validada para daltonismo, claro/oscuro) | Hecho |
| Backend | NestJS + Prisma (monolito modular) | Siguiente fase |
| Base de datos | PostgreSQL 16 (+ PostGIS para zonas y check-in GPS) | **Esquema validado** (`packages/db`) |
| Jobs | Redis + BullMQ (alertas de vencimientos, PDF, correos) | Siguiente fase |
| Archivos | S3 / Cloudflare R2 (fotos, firmas, PDF) | Siguiente fase |
| PDF | Gotenberg (HTML → PDF) | Siguiente fase |
| Integraciones | Factura electrónica DIAN (proveedor tecnológico), RNDC | Fase 3 |

### Cambio respecto a la propuesta inicial: Vite en lugar de Next.js
La plataforma vive completa detrás de un inicio de sesión, así que no necesita SSR ni SEO
(el sitio comercial terravivasas.com sigue siendo independiente). Con Vite:
- el frontend se publica como archivos estáticos (hosting casi gratuito: S3 + CloudFront, Cloudflare Pages);
- la PWA de conductores con modo sin conexión es más simple (sin capa de servidor de Next);
- hay menos piezas que mantener: el único servidor es el API NestJS.

## 3. Base de datos

- `packages/db/prisma/schema.prisma`: 32 tablas y 14 enums. Validado con `prisma validate` y aplicado
  sobre PostgreSQL 16 sin errores.
- `packages/db/prisma/schema.sql`: DDL generado.
- `packages/db/prisma/reglas_negocio.sql`: reglas que la base de datos hace cumplir:
  1. **Conciliación**: diferencia y % calculados; si |dif| > 2 % la justificación es obligatoria (CHECK).
  2. **Preoperacional (PESV, Res. 40595/2022)**: una ruta no pasa de «Programada» sin preoperacional aprobado (trigger).
  3. **Declaración autorizada**: no se programa la recolección de una declaración que no esté AUTORIZADA (trigger).

Decisiones clave:
- `empresa_id` en todas las tablas: el sistema queda listo para licenciarse como SaaS a otros gestores.
- `tarifas` con vigencias: ningún precio se sobrescribe (soporte ante reclamos de facturación).
- `catalogo_items` genérico: riesgos, embalajes, causales, líneas, tipos de manejo y métricas en una tabla,
  administrados por un solo componente de interfaz.
- `permisos_ambientales` + `obligaciones_permiso`: cada declaración se valida contra el alcance de los
  permisos de la CAS (Res. 0235-2024, Res. 0632-2023, Auto SAA 0244-21, OF-311-21).

## 4. Frontend (`apps/web/src`)

```
components/
  AppShell.tsx     menú superior por módulo + menú lateral por submódulo; hamburguesa en < lg
  data.tsx         ResponsiveTable (tabla ↔ tarjetas), FilterBar (fila ↔ hoja inferior), MonthCalendar (grilla ↔ agenda)
  ui.tsx           Button, Badge, ColorBadge, Card, Sheet, Tabs, Field, Kpi, Toast
lib/
  router.tsx       rutas por hash (#inicio, #solicitudes…)
  store.tsx        estado del prototipo (en producción: TanStack Query → API)
  alertas.ts       reglas de alerta (permisos, SOAT/RTM, licencias, curso MP, preoperacional, conciliación)
data/mock.ts       datos de demostración (servicios, permisos y planta reales; clientes ficticios)
pages/
  Auth.tsx         ingreso y recuperación de contraseña
  Inicio.tsx       panel: KPIs, recorridos de hoy, alertas, permisos, accesos rápidos
  Declaraciones.tsx residuos / servicios con 6 filtros, validación contra permisos, autorizar/rechazar
  Precios.tsx      asignación masiva (ajuste % o precio fijo, vigencia, impacto estimado)
  Logistica.tsx    solicitudes (formales/pre, tabla/calendario) y rutas (informe, calendario, estados con color)
  Operacion.tsx    preoperacionales, manifiestos (RNDC), actas y conciliación origen vs. destino
  Informes.tsx     indicadores generales y operativos
  Configuracion.tsx permisos ambientales, clientes, vehículos, usuarios/roles, catálogos genéricos
  Campo.tsx        PWA del conductor: mi ruta, preoperacional con firma, atención de parada
```

## 5. Cargues masivos (Excel)

- `apps/web/src/cargues/definiciones.ts`: **fuente única** de las 8 plantillas (columnas, listas, reglas). La usan el
  navegador, el script que genera los `.xlsx` y, en fase 1, el API para revalidar en servidor.
- `apps/web/src/cargues/excel.ts`: genera la plantilla (hoja Plantilla con desplegables, hoja Instrucciones, hoja Listas
  oculta) y lee el archivo diligenciado (ExcelJS, carga diferida).
- Validación: obligatorios, tipos, listas, NIT + dígito de verificación DIAN, corrientes Y/A, placas, duplicados en el
  archivo, cruce con clientes/sucursales/declaraciones existentes y advertencia si el manejo no está cubierto por un permiso.
- Tabla `cargues_masivos` guarda cada cargue (archivo, filas OK/error, errores, usuario) para auditoría.
- Plantillas listas en `docs/plantillas/` (`npm run plantillas` las regenera).

## 6. Estrategia mobile-first

1. Cada columna declara `priority`. En < 768 px la tabla se vuelve tarjetas con título, estado y solo
   columnas de prioridad 1–2; el resto aparece en la hoja de detalle.
2. Filtros en hoja inferior con contador de filtros activos.
3. Calendario mensual → agenda por día.
4. Vista de conductor separada: botones ≥ 44 px, barra inferior, sin tablas, flujo guiado:
   preoperacional → paradas → cantidades reales → foto → firma → manifiesto.
5. Sin conexión (siguiente fase): Service Worker + IndexedDB; la ruta del día se descarga al iniciar turno
   y los registros se sincronizan al recuperar señal (el indicador «Sin señal · 2 en cola» ya está maquetado).

## 7. Fases

| Fase | Alcance | Resultado de negocio |
|---|---|---|
| 0 ✅ | Esquema BD + prototipo navegable | Validar flujos con logística, HSEQ y conductores |
| 1 | API NestJS (auth, declaraciones, solicitudes, rutas) + conectar frontend + PWA offline | Menos digitación, rutas sin papel |
| 2 | Manifiestos PDF, conciliación con báscula, actas/certificados, job de alertas | Cumplimiento automático ante la CAS |
| 3 | Factura electrónica DIAN, RNDC, portal del cliente (pre-solicitudes y descarga de certificados) | Diferenciador comercial |
