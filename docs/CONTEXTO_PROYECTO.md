# Contexto del proyecto — para continuar en otra cuenta o sesión de Claude

Pegue este archivo (o pida «lee docs/CONTEXTO_PROYECTO.md») al iniciar la nueva sesión.

## Quién y cómo trabajar

- Producto: **TERRY-GO**, nombre de la plataforma web y de la app de campo desde el 18-11-2026. «Terry» es la mascota de
  Terra Viva. La empresa sigue figurando como Terra Viva S.A.S. E.S.P. en logos, documentos legales y certificados. El
  prefijo interno de los paquetes (`@terraviva/...`) y el repositorio `terry-app` no cambian.
- Cliente: **Terra Viva S.A.S. E.S.P.** (NIT 901.089.780-8), Sabana de Torres, Santander.
  Gestión integral de residuos con planta propia, el Parque de Saneamiento Ambiental Los Pinos, y autoridad ambiental CAS.
- Usuario: Diego, director general, representante legal y dueño.
- Claude actúa como asesor en negocios, derecho, ingeniería y gestión ambiental, y como arquitecto y desarrollador full-stack.
- Prioridades del usuario:
  1. Cumplimiento estricto de los permisos ambientales.
  2. Tratamientos de bajo costo en la planta.
  3. Estrategias para aumentar las ventas.
- Respuestas en español: prácticas, directas y adaptadas a Colombia.
- **Antiplagio:** Terra Viva usa el software Grinclic como cliente y lo toma como referencia **solo de funcionalidad**.
  - No se copian su diseño, textos, logos, organización visual, códigos numéricos internos ni plantillas.
  - El vocabulario, la navegación y las plantillas son propios.
  - La constancia está en `docs/REQUISITOS_FUNCIONALES.md`.
  - El historial de git sirve como prueba de desarrollo independiente: consérvelo.

## Qué está hecho

| Fase | Estado | Dónde |
|---|---|---|
| 0 | Prototipo web, esquema y plantillas de Excel | `apps/web`, `docs/plantillas` |
| 1 | API NestJS + Prisma + PostgreSQL. 37 pruebas e2e OK. Web conectada en ingreso, declaraciones e importación | rama `master` |
| 3-A | **Núcleo operativo: modelo y reglas, aprobado** (18-11-2026). Cadena Solicitud → Ruta → Manifiesto → Conciliación → Acta; migración abierta | rama `fase-3-operacion` (leer `docs/operacion/MODELO_OPERACION.md`) |
| 3-B | **API del núcleo operativo, hecha** (18-11-2026): manifiestos con firma, fotos y báscula; conciliación con totales y cartera; actas con PDF, QR y verificación pública; GPS sin señal; informes. 43 pruebas de reglas y 95 e2e OK | rama `fase-3-operacion` |
| 3-C | **App del conductor (PWA sin señal), hecha** (18-11-2026): ruta del día, inspección, etapas con kilometraje, manifiesto con cámara, báscula y firma, cola de envíos y GPS en lotes. 43 pruebas de reglas y 98 e2e OK | rama `fase-3-operacion` |
| DR | **Ajustes por documentos reales, hechos** (19-11-2026): recepción en planta con transportador externo, dos firmas, recibo térmico y manifiesto en PDF (TV####); certificado por generador, textos legales por disposición, firma, sellos y hash (PSAP); subcorrientes IDEAM, cargue por nombre, asignación masiva, solicitudes automáticas agrupadas y permisos reales. 46 pruebas de reglas y 132 e2e OK | rama `fase-3-operacion` (`docs/referencia/ANALISIS_DOCUMENTOS_REALES.md`, `docs/REVISION_REQUISITOS_PRODUCCION.md`) |
| PR | **Ajustes por requisitos de producción, hechos** (19-11-2026): buscador de clientes y listados de 50 en 50 (probado con 2.000 clientes), consolidado en la base, auditoría con IP e inmutable, permiso y registro de exportaciones, aceptación de la política de datos (Ley 1581), cerrar sesión en todos los dispositivos, aviso de ingreso nuevo, límite de peticiones por usuario, librerías actualizadas, pruebas en GitHub, CodeQL, Dependabot y guion de carga k6. 46 pruebas de reglas y 145 e2e OK | rama `fase-3-operacion` (`docs/REVISION_REQUISITOS_PRODUCCION.md` §9, `apps/api/test/carga/LEAME.md`) |
| 3-D | **Torre de control (oficina), hecha** (18-11-2026): calendario de rutas y programación por línea; seguimiento del día; manifiestos con fotos, firma y anulación; bandeja y grilla de conciliación con totales en vivo; actas con PDF, ZIP y cargue de aliados; página pública del QR. 43 pruebas de reglas y 109 e2e OK | rama `fase-3-operacion` (`apps/web/src/pages/torre/`) |
| 2-B | **Formulario de declaraciones (8 secciones), hecho** (19-11-2026): crear, completar y editar; cobertura legal en vivo; editar una autorizada la deja autorizada si la edita HSEQ y la devuelve a revisión si la edita otro rol; el precio nunca se sobrescribe. 46 pruebas de reglas y 157 e2e OK. Preguntas abiertas para la gerencia: `docs/PREGUNTAS_GERENCIA.md` | rama `fase-3-operacion` (`apps/web/src/pages/declaraciones/`) |
| 2-A | **Modelo de datos de Declaraciones: aprobado y adoptado** (18-11-2026). 50 tablas, 3 migraciones, reglas en la base, catálogos reales en `packages/shared`, API e importación ajustadas; 52 pruebas e2e OK | rama `fase-2-declaraciones` (leer `docs/declaraciones/MODELO_DATOS.md`) |

Stack:
- Monorepo con npm workspaces.
- Web: React 18, Vite 6, TypeScript y Tailwind 3.
- API: NestJS 11 y Prisma 6.19.
- Base de datos: PostgreSQL 16 (imagen con PostGIS) en docker-compose.
- Reglas compartidas en `packages/shared`.

Para levantar el proyecto, ver `README.md`.

En el equipo de Diego (Windows, sin Docker) hay Git, Node 22 y PostgreSQL 16 instalados de forma nativa. El repositorio está en
`Documentos\terry-app`, con la base local `terraviva` (usuario y clave `terraviva`). Los archivos `apps/api/.env` y
`packages/db/.env` son locales y no se suben a git.

## Encargo en curso: módulo «Declaraciones»

Es la parametrización de residuos y servicios por cliente. Tiene un formulario de 8 secciones y un cargue masivo
para clientes directos. Se trabaja por fases y **se espera el visto bueno del usuario entre fases**:

- **A. Esquema de base de datos.** ✅ Aprobado el 18-11-2026 y adoptado.
- **B. Formulario de 8 secciones.** ✅ Hecho el 19-11-2026 con el visto bueno del usuario («sí, sigue»): crear, completar
  borradores y editar, con la cobertura legal de cada disposición en vivo. Valida con el mismo `EsquemaDeclaracion` del API
  (sin react-hook-form). Árbol de componentes y reglas de edición: `docs/declaraciones/MODELO_DATOS.md` §8.
- **C.** Cargue masivo de clientes directos:
  - Ya hecho para Excel: valida los códigos paramétricos, guarda el lote en una transacción y deja el historial en
    `cargues_masivos` con el hash del archivo.
  - Falta:
    - leer CSV (con su delimitador);
    - permitir el cargue por cliente desde su portal;
    - revertir un lote.

Las 7 preguntas de la fase A están respondidas. Ver la tabla en `docs/declaraciones/MODELO_DATOS.md`:
- **ACU:** lo amparan los dos actos, el OF-311-21 y la Res. 316 de 2018.
- **Categorías:** las 5 actuales quedan confirmadas.
- **Migración «abierta»:** convierte datos de la fase 1 si los hay.

Falta registrar la fecha de vencimiento real de cada permiso de la CAS. Hoy no tienen fecha, y la regla de cobertura los
toma como vigentes mientras su estado sea VIGENTE.

## Fuentes del usuario

Están en la carpeta de Google Drive «Grinclic» (`G:\Mi unidad\Grinclic`):
- capturas de cada pantalla (subcarpeta DECLARACIONES);
- la matriz «Estructura de Base de Datos y Formulario - Módulo Declaraciones.xlsx»;
- las plantillas `plantilla_dec_cliente_directo`, `plantilla_dec_gestor`, `plantilla_suc_cliente_directo` y `plantilla_gen_gestor`;
- las exportaciones de líneas de servicio, unidades de negocio y disposiciones.

En la cuenta nueva hay que conectar Google Drive con acceso a esa carpeta.

## Pendientes generales

- Fase 1b: conectar a la API las pantallas restantes y la app del conductor sin señal.
- Obligaciones reales de cada acto de la CAS: hoy están marcadas «VERIFICAR».
- Formatos PDF oficiales de manifiesto y certificado.
- Docker no se probó en el entorno de Claude: el usuario lo levanta en su equipo.
