# Contexto del proyecto — para continuar en otra cuenta o sesión de Claude

Pegue este archivo (o pida «lee docs/CONTEXTO_PROYECTO.md») al iniciar la nueva sesión.

## Quién y cómo trabajar

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
| 2-A | **Modelo de datos de Declaraciones (propuesta)**: 50 tablas, reglas en la base y catálogos reales; 14 pruebas SQL OK | rama `fase-2-declaraciones`, `docs/declaraciones/` (leer `MODELO_DATOS.md`) |

Stack:
- Monorepo con npm workspaces.
- Web: React 18, Vite 6, TypeScript y Tailwind 3.
- API: NestJS 11 y Prisma 6.19.
- Base de datos: PostgreSQL 16 (imagen con PostGIS) en docker-compose.
- Reglas compartidas en `packages/shared`.

Para levantar el proyecto, ver `README.md`.

## Encargo en curso: módulo «Declaraciones»

Es la parametrización de residuos y servicios por cliente. Tiene un formulario de 8 secciones y un cargue masivo
para clientes directos. Se trabaja por fases y **se espera el visto bueno del usuario entre fases**:

- **A. Esquema de base de datos.** Entregado y pendiente de comentarios.
- **B.** Árbol de componentes del formulario de 8 secciones, más el estado y la validación con react-hook-form + zod.
  Se empieza solo después de que el usuario apruebe la fase A.
- **C.** Algoritmo de cargue masivo de clientes directos (CSV o Excel):
  - validar que los códigos paramétricos existan;
  - guardar el lote en una transacción;
  - guardar el historial en `cargues_masivos`.

Preguntas abiertas de la fase A (el usuario aún no respondió):
1. ¿El acto que ampara el ACU es el OF-311-21 o la Res. 316 de 2018 CAS?
2. ¿Cuál es la lista real de categorías del declarado? Hoy hay 5 provisionales.
3. ¿La ficha de datos de seguridad será obligatoria para peligrosos? Se recomendó que sí, por el Decreto 1079 de 2015.
4. ¿El sistema de etiquetado será de selección múltiple? Se recomendó que sí.
5. ¿«Recurrencia» es lo mismo que «solicitud automática»?
6. ¿«Residuos de inventario» se aplaza al módulo de inventario?
7. ¿Ya hay datos reales cargados? Si los hay, la migración debe convertirlos.

Al aprobar la fase A, adoptar el esquema:
- pasar `docs/declaraciones/schema.prisma` a `packages/db/prisma/schema.prisma`;
- convertir `migracion.sql` y `reglas.sql` en migraciones;
- pasar los catálogos al seed;
- ajustar la API (`declaraciones`, `importacion`, `clientes`) y `packages/shared`.

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
