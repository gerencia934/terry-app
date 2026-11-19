# Contexto del proyecto — para continuar en otra cuenta o sesión de Claude

Pegue este archivo (o pida «lee docs/CONTEXTO_PROYECTO.md») al iniciar la nueva sesión.

## Quién y cómo trabajar

- Producto: **TERRY-GO**, nombre de la plataforma web y de la app de campo desde el 19-11-2026. «Terry» es la mascota de
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
| 2-A | **Modelo de datos de Declaraciones: aprobado y adoptado** (19-11-2026). 50 tablas, 3 migraciones, reglas en la base, catálogos reales en `packages/shared`, API e importación ajustadas; 52 pruebas e2e OK | rama `fase-2-declaraciones` (leer `docs/declaraciones/MODELO_DATOS.md`) |

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

- **A. Esquema de base de datos.** ✅ Aprobado el 19-11-2026 y adoptado.
- **B. Siguiente.** Árbol de componentes del formulario de 8 secciones, más el estado y la validación con react-hook-form + zod.
  - El esquema zod ya existe: `packages/shared/src/declaraciones/esquema.ts` (`EsquemaDeclaracion`).
  - La API ya existe: `POST /declaraciones` y `GET /declaraciones/catalogos`.
  - Falta la interfaz. Se presenta el árbol y se espera el visto bueno antes de construirla.
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
