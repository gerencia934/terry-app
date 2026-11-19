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
| `PUT declaraciones/:id` | Edita desde el formulario (fase B; reglas en §8) |
| `GET declaraciones/cobertura?disposiciones=…` | Cobertura legal de una lista de disposiciones, para mostrarla en vivo antes de guardar |

## 8. Fase B: formulario de 8 secciones (hecha, 19-11-2026)

Pantalla: Comercial › Declaraciones › «Nueva declaración», o «Editar» / «Completar» en el detalle.
No usa librerías nuevas: valida con el mismo `EsquemaDeclaracion` del API (`packages/shared`) y la base de datos vuelve a
revisar todo al guardar.

```
DeclaracionesServidor (lista con filtros y «Cargar más»)
└─ FormularioDeclaracion (apps/web/src/pages/declaraciones/FormularioDeclaracion.tsx)
   ├─ índice de secciones: columna fija en pantalla grande, fila de botones 1–8 en el celular;
   │  cada sección muestra ✓ completa, • pendiente o ! con errores
   ├─ 1 Generador: tipo (solo al crear), cliente con buscador, sedes (todas · principal · elegir)
   ├─ 2 Datos específicos: precarga del catálogo de servicios, nombre, código, categoría, línea → unidad,
   │  frecuencia y solicitud automática; residuo: tipo, peligrosidad (Y/A con subcorrientes, UN, CRETIB,
   │  composición), etiquetado y proceso; servicio: descripción
   ├─ 3 Embalaje y 4 Fisicoquímicas (solo residuos; «Otro» exige el texto)
   ├─ 5 Disposición: varias, la de la estrella es la principal, y la cobertura legal de cada una en vivo
   ├─ 6 Adicional: FDS (obligatoria para autorizar un peligroso), serial, datos extras
   ├─ 7 Precio: valor, métrica (vacía = global), negociación y forma de pago (vacías = las del cliente), historial
   ├─ 8 Estado: vigencia, observaciones, aceptación de responsabilidad y «qué faltará para autorizarla»
   └─ barra fija: qué falta (en orden de secciones) · Guardar borrador · Enviar a revisión / Guardar cambios
      (formulario.ts convierte pantalla ↔ API y ubica cada error en su campo y su sección)
```

**Reglas al editar (`PUT`):**
- No cambian el cliente ni el tipo: para eso se crea otra declaración.
- Borrador, pendiente o rechazada: se guarda como borrador o vuelve a revisión (pendiente).
- Autorizada:
  - si la edita quien puede autorizar, sigue autorizada; antes se vuelve a revisar que esté completa y con
    cobertura legal (y la base lo revisa otra vez al confirmar);
  - si la edita otro rol, vuelve a «pendiente» e inactiva hasta que HSEQ la autorice.
- Precio: si cambia, nueva vigencia desde hoy y la anterior queda cerrada; el mismo día se corrige la de hoy. Nunca se
  sobrescribe un precio de días anteriores.
- Al completar una declaración convertida de la fase 1, deja de estar marcada como tal.
- La auditoría guarda qué columnas cambiaron (antes y después), cuántas sedes y disposiciones quedaron y el precio.

La fase C (CSV y deshacer un cargue) está en §10. Falta el cargue desde el portal del cliente, cuando exista el portal, y
adjuntar la FDS como archivo; hoy es un enlace.

## 9. Reglas de cumplimiento de las respuestas de la gerencia (19-11-2026)

Las preguntas están en `docs/PREGUNTAS_GERENCIA.md`. Esto quedó en el sistema, casi todo con reglas en la base de datos
(migración `20261123000000_respuestas_gerencia`):

- **Los tratamientos de Los Pinos (ASP, BIO, RCD, ACU) solo admiten residuos sin características de peligrosidad**
  (Res. DGL 000632 de 2023, art. 6). Un peligroso nunca se autoriza con ellos: va a un gestor aliado
  (`disposiciones.admite_peligrosos`, `fn_decl_autorizacion_check`).
- **Los Pinos no recibe ni almacena peligrosos.** Ningún manifiesto con destino a la planta propia lleva un residuo
  peligroso (`trg_item_peligroso_destino`). La recepción en planta solo ofrece declaraciones no peligrosas.
- **Hidrocarburos** (`contiene_hidrocarburos`):
  - la biorremediación exige la caracterización CRETIB negativa cargada (`caracterizacion_url`);
  - los RCD con hidrocarburos no se reciben (`disposiciones.hidrocarburos`).
- **Gestores aliados.** Puede haber varios por disposición (`disposicion_gestores`). Basta uno que cumpla tres cosas:
  - licencia registrada;
  - vigente, con fecha o `licencia_indefinida`;
  - que no excluya el tipo de residuo (`excluye_tipos_residuo`; por ejemplo, Las Bateas no recibe hospitalarios).

  Si la vigencia «no consta», la disposición no queda cubierta.
- **Inactivas:**
  - aprovechamiento propio y reciclaje (el objeto social no es una autorización ambiental);
  - lavado y reúso;
  - coprocesamiento;
  - «incineración y celda ordinaria», que se separó en INCH y RS.
- **Cambios a una autorizada.** Un cambio crítico la devuelve a revisión y la autoriza otra persona
  (`revision_pedida_por`, `chk_decl_cuatro_ojos`). Son críticos los cambios de:
  - peligrosidad o corriente Y/A;
  - hidrocarburos o caracterización;
  - disposición;
  - sedes;
  - unidad de medida.
- **Certificado:**
  - textos legales aprobados por la gerencia;
  - los de RESPEL salen solo si hay residuos peligrosos (`solo_peligrosos`);
  - GESTOR_ALIADO sale por cada aliado, con su razón social, NIT, licencia, autoridad y el número de su certificado;
  - ese número se registra en cada línea del acta, y sin él no se emite el certificado final.
- **Obligaciones reales:**
  - llevan el código del Cronograma Maestro (OB-xx), el artículo y la periodicidad;
  - las permanentes y las de por evento no tienen fecha.
- **Sellos y báscula:**
  - solo salen las certificaciones con número y vigentes; el sello NORSOK no se imprime sin certificado;
  - el recibo de báscula cita el certificado de calibración y sale con alerta si está vencido.
- **Política de datos:** en producción el API no arranca sin `POLITICA_DATOS_URL` y `POLITICA_DATOS_VERSION`.

**Pendiente** (falta información o es una fase propia):
- La lista de orígenes del art. 6 de la Res. 000632, para validar las ASP. Falta el texto completo del artículo.
- Las rutas del plan de contingencia, para validar el transporte de RESPEL.
- La constancia de recolección y entrega, que se emite antes de tener el certificado del aliado.
- Los campos del Anexo VI del Decreto 0766 de 2026 y los códigos D/R en los certificados.
- Documentos que la gerencia debe conseguir:
  - vigencias de las licencias de Sandesol y de Veolia Aseo;
  - prórroga de Las Bateas;
  - NIT de Lúmina;
  - gestor de coprocesamiento;
  - constancia de ejecutoria de la Res. 000632;
  - certificado de calibración de la báscula;
  - política de datos.

## 10. Fase C: cargue desde CSV y deshacer un cargue (hecha, 19-11-2026)

**CSV.** Ajustes › Importar datos acepta la plantilla en Excel (.xlsx) o en CSV. Se lee en `packages/shared`
(`importacion/csv.ts` y `planilla.ts`), igual en la web y en el API:
- El formato se reconoce por el contenido, no por el nombre del archivo:
  - un .xlsx es un ZIP;
  - un Excel antiguo (.xls) o un archivo binario se rechazan, explicando cómo guardarlo.
- El separador se detecta solo: punto y coma, coma, tabulador o barra. Se elige el que hace coincidir más encabezados
  con la plantilla, y con un empate gana el punto y coma, que es el de Excel en Colombia. También se respeta la línea
  `sep=;` que agrega Excel. El usuario puede fijarlo a mano en la revisión.
- Las codificaciones aceptadas son:
  - el «CSV UTF-8» de Excel (con BOM);
  - el «CSV (delimitado por comas)» de Windows (Windows-1252), con las tildes intactas;
  - UTF-16.
- Comillas: una celda con varios valores (`"BIO;ASP"`), con comillas o con saltos de línea va entre comillas.
- Plantilla en CSV: `GET importacion/plantillas/:id/archivo?formato=csv`, o el botón «En CSV».
- `cargues_masivos` guarda el formato y el separador. Un CSV sin separador no se registra (`chk_cargue_formato`).

**Deshacer un cargue** (`GET importacion/cargues/:id/reversion` muestra qué pasaría, y
`POST importacion/cargues/:id/revertir` lo hace, con un motivo obligatorio):
- **Alcance.** Solo los cargues de declaraciones. Los de clientes, sedes, precios, vehículos, usuarios y solicitudes
  crean o actualizan registros: se corrigen con otro cargue o en su pantalla.
- **Nada se borra.** Sus declaraciones quedan en el estado nuevo **ANULADA**:
  - inactivas y como constancia;
  - fuera del listado, salvo con el filtro «Anulada», que dice de qué cargue vienen y por qué se deshizo.
- **Código libre.** El código interno de una anulada queda libre para volver a cargar el archivo corregido. El índice
  único es parcial: `ux_decl_codigo_interno`, con `WHERE estado <> 'ANULADA'`.
- **En uso.** No se deshace si alguna declaración ya está en una solicitud o un manifiesto: se inactiva desde su ficha.
- **Quién.** Lo deshace quien lo cargó, si ninguna de sus declaraciones está autorizada. Si no, quien tenga el permiso
  `importacion.revertir`: HSEQ y Administración.
- **Reglas en la base** (migraciones `20261124000000` y `20261124000100`):
  - una anulada no cambia más, ni sus sedes, disposiciones, precios, riesgos o etiquetado (`trg_decl_anulada`,
    `fn_hijo_decl_anulada`);
  - no se anula una declaración en uso;
  - un lote solo se deshace si está confirmado, es de declaraciones y todas sus declaraciones quedaron anuladas en la
    misma transacción;
  - el lote exige quién, cuándo y un motivo de al menos 10 caracteres (`chk_cargue_revertido`) y después no cambia más
    (`trg_cargue_revertido`).
- La auditoría guarda el lote deshecho y la anulación de cada declaración.

**Pendiente:** el cargue por el propio cliente desde su portal (fase 3, cuando exista el portal).
