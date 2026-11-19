# Módulo Declaraciones — Modelo de datos (Fase A)

Estado: **aprobado y adoptado** (18-11-2026). La API, la importación de Excel y la web ya lo usan; 52 pruebas e2e OK.

| Dónde | Contenido |
|---|---|
| `packages/db/prisma/schema.prisma` | Esquema completo (50 tablas: las 32 anteriores + 18 nuevas/rehechas) |
| `packages/db/prisma/migrations/20261119000000_declaraciones` | Tablas nuevas y cambios sobre el esquema de la fase 1 |
| `packages/db/prisma/migrations/20261119000100_declaraciones_reglas` | CHECK y triggers: obligatorios, coherencia, **cobertura de permisos**, solicitudes |
| `packages/db/prisma/migrations/20261119000200_declaraciones_fds` | FDS obligatoria para autorizar un residuo peligroso |
| `packages/shared/src/declaraciones/catalogos.ts` | Catálogos con los datos reales de Terra Viva (los usan el seed, las plantillas y la demo) |
| `packages/shared/src/declaraciones/esquema.ts` | Validación zod del formulario de 8 secciones (API y web) |

## Decisiones sobre las preguntas abiertas (18-11-2026)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿El ACU lo ampara el OF-311-21 o la Res. 316 de 2018 CAS? | **Los dos.** Ambos actos amparan la disposición ACU; basta con que uno esté vigente. Registre la fecha de vencimiento real de cada uno |
| 2 | Lista real de categorías del declarado | **Confirmada:** Peligrosos, No peligrosos, Aprovechables, Especiales y Servicios |
| 3 | ¿FDS obligatoria para peligrosos? | **Sí, para autorizar** (Dec. 1079/2015). Se puede enviar sin ella; no se autoriza sin ella |
| 4 | ¿Etiquetado de selección múltiple? | **Sí** (`declaracion_etiquetados`) |
| 5 | ¿Recurrencia = solicitud automática? | **Sí** (`solicitud_automatica` + `frecuencia_dias`) |
| 6 | ¿Residuos de inventario? | **Se aplaza** al módulo de inventario |
| 7 | ¿Datos reales cargados? | **Migración abierta:** funciona con la base vacía o con datos de la fase 1, que convierte sin perder información (ver §7) |

## 7. Migración abierta: conversión de datos de la fase 1

Con la base vacía, la conversión no hace nada. Si encuentra datos de la fase 1, convierte así (probado con datos de ejemplo):

| Fase 1 | Modelo nuevo |
|---|---|
| Declaración por sede y residuo | Una declaración por cada anterior (conserva id, número, tarifas y solicitudes), con su sede en `declaracion_sucursales` |
| Mismo código de residuo en varias sedes del cliente | La primera conserva el código; las siguientes llevan sufijo `-2`, `-3`… (se pueden unir después) |
| Estado `INACTIVA` | `AUTORIZADA` con `activa = false` |
| Tipo de manejo | Disposición: `ESC→RCD`, `INC→INCH`, `CEL→DF`, `TRANS→TRA`; los demás (p. ej. `FQ`, `REG`) se conservan con su código, marcados VERIFICAR |
| `manejos_cubiertos` del permiso | `permiso_disposiciones` |
| Peligrosidad / corriente / N.º ONU / estado físico | Riesgos CRETIB / código Y o A / código UN / estado físico |
| Frecuencia en texto · cantidad | Días (`Mensual` = 30…) · cantidad por frecuencia |
| Unidad del residuo | Métrica de la tarifa |
| Línea de servicio (nombre) | Código de línea (las sin equivalente van a la 01, para revisar) |
| Autorización, embalaje, destino | Nota en `datos_extras` |
| Columnas eliminadas del catálogo de residuos | `catalogo_residuos.valores.faseAnterior` |
| Horario de la sede · municipio | `observaciones` · se conserva (se crea en `municipios` si no estaba) |

Las convertidas quedan con `origen_fase1 = true`. Se pueden **inactivar o rechazar** sin completarlas, pero para
**activarlas o autorizarlas** deben tener las secciones nuevas completas. Por eso las reglas de completitud son
`NOT VALID`: no rechazan las filas viejas, pero sí cualquier fila nueva o modificada.

## 1. Mapa de tablas

```
                         ┌──────────────── empresas ────────────────┐
                         │ (todas las tablas paramétricas por empresa)│
clientes (DIRECTO|GESTOR)┘                                            │
   │ 1:N                                                              │
sucursales ── N:M ── declaracion_sucursales ── N:1 ──┐                │
                                                     │                │
                                               DECLARACIONES          │
   categorias_declarado ─────────────────────── N:1 ─┤                │
   tipos_residuo ────────────────────────────── N:1 ─┤                │
   lineas_servicio ── N:1 ── unidades_negocio    N:1 ─┤                │
   codigos_clasificacion (A / Y, global) ── 2 × N:1 ──┤                │
   tipos_embalaje / materiales_embalaje ──────── N:1 ─┤                │
   metricas (densidad) ───────────────────────── N:1 ─┤                │
   riesgos (global) ── N:M ── declaracion_riesgos ────┤                │
   sistemas_etiquetado (global) ── N:M ── declaracion_etiquetados     │
   disposiciones ── N:M ── declaracion_disposiciones ─┤                │
      │  └── N:1 proveedores (gestor aliado, licencia + vencimiento)  │
      └── N:M ── permiso_disposiciones ── permisos_ambientales (CAS)  │
   tarifas (vigencias) ── N:1 metricas (NULL = GLOBAL) ───────────────┘
   cargues_masivos ── 1:N ── declaraciones (lote que la creó)
```

## 2. Campos del formulario → columnas

| Sección | Campo | Columna / tabla | Obligatorio |
|---|---|---|---|
| — | Tipo de declaración | `tipo` RESIDUO \| SERVICIO | Sí |
| 1 Generador | Cliente | `cliente_id` | Sí |
| 1 | Sedes generadoras | `declaracion_sucursales` + `alcance_sedes` (TODAS / PRINCIPAL / SELECCIÓN) | ≥ 1 para autorizar |
| 2 Datos específicos | Nombre | `nombre` | Sí |
| 2 | Código interno | `codigo_interno` (único por cliente) | No |
| 2 | Precargar desde catálogo | `catalogo_id` → `catalogo_residuos.valores` | No |
| 2 | Categoría del declarado | `categoria_id` | Sí |
| 2 | Frecuencia (días) / cantidad | `frecuencia_dias`, `cantidad_frecuencia` | No |
| 2 | Solicitar automáticamente | `solicitud_automatica` (exige frecuencia) | No |
| 2 | Tipo de residuo | `tipo_residuo_id` | Sí (residuo) |
| 2 | Línea de servicio → Unidad de negocio | `linea_servicio_id` (la unidad se deriva) | Sí |
| 2 | ¿Es peligroso? | `es_peligroso` | Sí |
| 2 | Sistema de etiquetado | `declaracion_etiquetados` (múltiple) | No |
| 2 | Código A / Corriente Y | `codigo_a_id`, `codigo_y_id` | Una de las dos si es peligroso |
| 2 | Código UN | `codigo_un` (formato UN####) | No |
| 2 | Riesgos CRETIB | `declaracion_riesgos` | No |
| 2 | Proceso que lo generó | `descripcion_proceso` | Sí (residuo) |
| 2 | Composición fisicoquímica | `composicion` | Sí si es peligroso |
| 2 | Descripción del servicio | `descripcion_servicio` (≤ 1000) | Sí (servicio) |
| 3 Embalaje | Tipo / presentación | `tipo_embalaje_id`, `presentacion`, `otro_tipo_embalaje` | Sí (residuo); texto si «Otro» |
| 3 | Material | `material_embalaje_id`, `otro_material` | Sí (residuo); texto si «Otro» |
| 3 | Tipo de sellado | `tipo_sellado` | No |
| 4 Fisicoquímicas | Estado físico | `estado_fisico` | Sí (residuo) |
| 4 | Inflamable / estupefacientes | `inflamable`, `controlada_estupefacientes` | Sí (residuo) |
| 4 | Color, olor | `color`, `olor` | No |
| 4 | Densidad + métrica | `densidad`, `metrica_densidad_id` | Ambos o ninguno |
| 5 Disposición | Disposición / manejo | `declaracion_disposiciones` (múltiple, una «principal») | ≥ 1 para autorizar (residuo) |
| 6 Adicional | Datos extras, FDS, serial | `datos_extras`, `ficha_seguridad_url`, `serial` | No |
| 7 Precio | Valor, métrica, negociación, forma de pago | `tarifas` (nueva vigencia por cambio; métrica NULL = GLOBAL) | Sí para autorizar |
| 7 | Ver precio en app de logística | `mostrar_precio_app` | — |
| 8 Estado | ¿Se aprueba? | `estado` BORRADOR / PENDIENTE / AUTORIZADA / RECHAZADA | Sí |
| 8 | Activar | `activa` (solo si AUTORIZADA) | — |
| 8 | Observaciones / causal | `observaciones`, `causal_id` | No |
| 8 | Responsabilidad del generador | `responsabilidad_aceptada`, `aceptada_por`, `aceptada_en` | Sí para enviar |

## 3. Reglas que aplica la base de datos (no se pueden saltar ni con cargue masivo)

1. **Cumplimiento ambiental (prioridad #1).** Una declaración solo queda AUTORIZADA si tiene sede, disposición
   y **cada disposición está cubierta**:
   - es actividad del objeto social (aprovechamiento, reciclaje), o
   - es propia y la ampara un permiso de la CAS **vigente o por vencer**, o
   - es de un gestor aliado cuya **licencia está registrada y vigente** (nuevo campo `licencia_vence`).

   Se revisa al confirmar la transacción. Así funciona igual desde el formulario o desde el cargue masivo,
   y tampoco permite quitar la última sede o disposición de una declaración autorizada.
2. **Obligatorios por tipo.** Si es residuo: secciones 2–4. Si es servicio: la descripción. Si es peligroso:
   la composición y una corriente Y o A. El BORRADOR permite guardar a medias.
3. **Coherencia.**
   - La sede debe ser del mismo cliente.
   - Los catálogos deben ser de la misma empresa y estar activos.
   - Una corriente Y no puede ir en el campo A (ni al revés).
   - Si elige «Otro», el texto es obligatorio.
   - Solo una sede principal por cliente.
4. **Solicitudes.** Solo con declaración AUTORIZADA **y activa**, **y asignada a esa sede**.
5. **Sedes nuevas.** Si una declaración tiene alcance «TODAS», cada sede nueva del cliente queda incluida sola.

Resultado de las pruebas en PostgreSQL 16: las 14 dan lo esperado (por ejemplo, ACU se rechaza porque OF-311-21
se marcó vencido en la prueba; la incineración se rechaza con la licencia del aliado vencida y pasa al renovarla).

## 4. Catálogos iniciales (datos reales de Terra Viva)

- **Unidades de negocio (6):** 01 Tratamiento (TTR), 02 Transporte (TPT), 03 Fumigación (FUM), 04 Obras civiles (CIV),
  05 Aprovechamiento (APR), 11 Mantenimiento hidrosanitario (sin sigla).
- **Líneas de servicio (15):** códigos 01–12, 15, 19 y 20, cada una con su unidad de negocio.
- **Disposiciones (15):**
  - Las propias van ligadas a su permiso: BIO y ASP a la Res. 0632-2023, RCD a la Res. 0235-2024, TRA al Auto 0244-21 y ACU.
  - Las de aliado van con su licencia: INCH e INCO (Res. 0144/2000 CDMB), RS (Res. 1121/2014), COP, DES, DF y POS.
  - APR y REC quedan amparadas por el objeto social.
- **Métricas:**
  - Precio: kg, ton, m³, gal, L, und, viaje.
  - Densidad: kg/m³, g/cm³, g/L, g/mL, kg/L.
- **Tipos de embalaje (12), materiales (8), tipos de residuo (7), riesgos CRETIB + radiactivo, etiquetado ONU/NFPA/SGA/HMIS.**
- **Corrientes Y / códigos A:** tabla global; se carga completa (Y1–Y45, A1010–A4160) al adoptar.
- **Municipios:** DIVIPOLA del DANE (código de 5 dígitos), en lugar de listas de ciudades con números propios.

En las plantillas de cargue se escriben **códigos legibles** (`CANECA`, `MET`, `ASP;BIO`, `Y9`, `C001;C002`), no
números internos. Son más fáciles de diligenciar y no dependen de los ID de ningún otro sistema.

## 5. Cambios sobre el esquema actual

- `declaraciones`:
  - sale `sucursal_id`; ahora las sedes van en `declaracion_sucursales`.
  - sale `residuo_id`; queda `catalogo_id`, que es opcional.
  - salen `tipo_manejo_id` y `destino_id`; ahora las disposiciones van en `declaracion_disposiciones`.
  - el estado INACTIVA pasa a ser el campo `activa`.
- `permisos_ambientales.manejos_cubiertos` (lista de texto) → tabla `permiso_disposiciones`.
- `catalogo_items` queda solo para listas simples (causales).
- `clientes.tipo` (DIRECTO / GESTOR).
- `sucursales` gana:
  - código (C001), sede principal y clasificación;
  - generador tercero (para gestores);
  - horarios L-V y fin de semana, celular, correos y estado.
- `proveedores.licencia_vence`.
- `cargues_masivos` gana:
  - cliente, tipo de cargue, formato (CSV o XLSX) y delimitador;
  - hash del archivo, para avisar si el mismo archivo se sube dos veces;
  - estado y la relación con las declaraciones que creó.

## 6. API después de la adopción

| Ruta | Qué hace |
|---|---|
| `GET declaraciones` | Listado con sedes, categoría, línea/unidad, disposiciones y tarifa vigente. Filtros: tipo, cliente, sede, estado, activa, nombre, código |
| `GET declaraciones/catalogos` | Listas del formulario de 8 secciones (solo activas) |
| `GET declaraciones/:id` | Detalle completo + cobertura legal de cada disposición |
| `POST declaraciones` | Crea desde el formulario (BORRADOR o PENDIENTE) en una transacción; valida con `EsquemaDeclaracion` |
| `PATCH declaraciones/:id/estado` | AUTORIZADA (exige sede, disposición, precio, FDS si es peligroso y cobertura) o RECHAZADA |
| `PATCH declaraciones/:id/activa` | Activa o inactiva (con causal) una declaración autorizada |
| `POST importacion/decl-residuos · decl-servicios` | Cargue por códigos; el lote queda en `cargues_masivos` con hash del archivo |
