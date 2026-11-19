# TERRY-GO · Fase 3-A — Modelo de datos y reglas del núcleo operativo

Estado: **aprobado** (18-11-2026) y con su API hecha (fase 3-B, sección 6), en la rama `fase-3-operacion`.

**Verificación:**
- **Pruebas:** pasan las 40 de reglas en la base y las 52 de punta a punta.
- **Conversión:** probada con datos de la fase 1.
- **Esquema y migraciones:** coinciden.

Análisis previo y preguntas abiertas: `ANALISIS_MODULOS_OPERATIVOS.md`.

| Dónde | Qué |
|---|---|
| `packages/db/prisma/schema.prisma` | 60 tablas (18 nuevas o rehechas en esta fase) |
| `migrations/20261120000000_operacion` | Tablas y columnas nuevas. **Migración abierta:** convierte los datos anteriores si los hay |
| `migrations/20261120000100_operacion_reglas` | Reglas de estado: triggers y CHECK |
| `packages/db/pruebas/reglas-operacion.mjs` | 40 pruebas que escriben directo en la base (`npm run test:reglas -w @terraviva/db`) |

## 1. La cadena

```
Declaración ─▶ Solicitud ──(aprobación)──▶ líneas por sede
                  │                           │ programación línea por línea
                  │ DESCARGA (sin ruta)        ▼
                  │                   Ruta ─ Paradas (una por sede) ─ ruta_items
                  │                     │  └ inspección del vehículo · rastreo GPS
                  ▼                     ▼
              Manifiesto (CARGUE o DESCARGUE · líneas por generador · báscula · firma · evidencias)
                  │ grabar = REALIZADO
                  ▼
              Conciliación (por manifiesto · cantidades · dinero · factura y pago)
                  │ aprobar
                  ▼
              Acta (consecutivo · código de verificación para el QR · copia fija de lo certificado)
```

## 2. Tablas nuevas o rehechas

| Tabla | Para qué |
|---|---|
| `solicitudes` (cambia) | **Aprobación** aparte del avance; orden de compra; adjunto; observaciones «enviar al cliente»; destino y transportador (descargas); recurrencia (`clase = PRE`, fecha de activación, manifiesto de origen). **La sede sale de aquí y pasa a cada línea** |
| `solicitud_items` (cambia) | Sede, jornada (AM, PM o todo el día), avance de la línea (pendiente, programada, realizada, descartada) y causal de descarte |
| `especificaciones_adicionales` + 2 tablas de relación | Cadena de custodia, destrucción certificada, etc., por línea de solicitud y de manifiesto |
| `entidades_seguridad_social` | ARL y EPS (catálogo nacional). Los usuarios (conductores propios) tienen ARL y EPS |
| `transportes_terceros` | Empresa, vehículo, conductor y auxiliar con documento, ARL y EPS (descargas) |
| `consecutivos` | Numeración por empresa y documento (`MF-2026-00001`, `INS-…`, `ACT-…`). El prefijo, los dígitos y el reinicio anual son configurables |
| `rutas` (cambia) | Puede crearse **sin vehículo ni conductor**; ruta interna; valor del flete; hora; recurrencia (frecuencia y ruta base) |
| `ruta_paradas` (cambia) | Ahora **por sede**, no por solicitud |
| `ruta_items` | **Programación línea por línea**, con marca `liberado` cuando la ruta se cancela o el manifiesto se anula |
| `ruta_rastreo` | Puntos GPS (hora del teléfono y hora de recibido, para el trabajo sin señal) |
| `estados_recorrido` (cambia) | Descripción; `rastreo` (GPS en esa etapa); `cancela` (libera las líneas) |
| `vehiculos` · `proveedores` (cambian) | Volumen (m³) y transportador dueño, para el informe de fletes |
| `manifiestos` (rehecha) | Tipo, estado (pendiente, realizado, anulado), báscula, horas, firma, anulación, manifiesto del cliente, orden de compra, tipo de conciliación |
| `manifiesto_items` (rehecha) | Línea con o sin solicitud previa: declaración, **generador**, métrica, disposición, embalaje, precio |
| `manifiesto_evidencias` | Fotos de la cámara (máx. 2) y PDF escaneado (máx. 1) |
| `conciliaciones` | **Nueva**: una por manifiesto, en borrador o aprobada |
| `conciliacion_items` (rehecha) | Cantidad cargada y conciliada, métrica, precio, negociación, forma de pago, disposición, **factura, vencimiento y estado de pago**. Ya no cuelga del acta: el acta la referencia |
| `actas` (rehecha) | Origen (generada o cargada de un aliado), estado, **código de verificación** para el QR, `contenido` (copia fija de lo certificado) y anulación |
| `clientes` · `preoperacionales` (cambian) | Asesor comercial · consecutivo de la inspección y observación por elemento |

## 3. Reglas en la base

Ninguna pantalla, API, app sin señal ni cargue puede saltárselas. Entre paréntesis, la prueba que la demuestra.

**Solicitudes y programación**
- La línea exige una declaración autorizada, activa, del mismo cliente y **asignada a la sede de la línea** (1.1).
- Solo se programan solicitudes **aprobadas**, formales (no recurrentes sin activar) y de carga (1.2).
- Se programa línea por línea. El estado de la solicitud **se calcula** a partir de sus líneas: queda pendiente
  mientras le falte algo por programar (1.3, 1.4).
- Una línea solo puede estar en una ruta vigente (1.5).
- Cancelar una solicitud descarta sus líneas pendientes. No se cancela si tiene líneas en ruta o realizadas.

**Rutas**
- No sale de la etapa inicial sin vehículo, conductor e inspección aprobada (2.1).
- Al entrar a una etapa que «cancela», las líneas no recogidas vuelven a pendientes y se pueden reprogramar (2.3, 2.4).
- El **GPS solo se guarda** mientras la ruta está en una etapa con rastreo (Ley 1581) (2.2, 2.5).

**Manifiestos**
- **Grabar** exige:
  - firma, nombre e identificación de quien firma;
  - hora de llegada y de salida;
  - al menos una línea;
  - en un descargue, además: el peso neto, y la identificación, ARL y EPS del conductor (y del auxiliar, si lo hay);
  - en un cargue, además: vehículo y conductor.

  El mensaje dice todo lo que falta (3.4, 6.2).
- Peso neto = entrada − salida; la salida no puede ser antes que la llegada; un descargue no lleva ruta (3.3, 6.1).
- **Al grabar**:
  - las líneas de la solicitud quedan realizadas, con la cantidad del manifiesto;
  - se abre la conciliación en borrador, con la cantidad, el precio y la negociación del cliente;
  - si la declaración tiene solicitud automática, nace la **solicitud recurrente** a N días (3.6–3.8).
- Grabado ya no se modifica ni admite líneas; solo el PDF escaneado y el consecutivo RNDC (3.9–3.11).
- **Anular** exige causal o motivo, y no se puede si la conciliación está aprobada. Al anular:
  - se borra la conciliación;
  - las líneas vuelven a pendientes y se libera su programación;
  - se retiran las recurrentes que nadie ha tocado (4.6, 6.4, 6.5).

**Conciliación**
- Para aprobar, toda línea necesita cantidad conciliada y precio (4.1).
- Una diferencia de más de ±2 % exige justificación (regla de la fase 1, se mantiene) (4.2).
- **Aprobada**, solo cambian la factura, las fechas y el estado de pago (cartera) (4.4, 4.5).

**Actas**
- Solo certifican líneas de conciliaciones aprobadas y del mismo cliente.
- Para emitir, necesitan líneas y su copia fija (`contenido`). Las cargadas de un aliado necesitan el archivo (5.2, 5.3).
- Emitida no se modifica. Una conciliación certificada no vuelve a borrador (5.5, 5.6).
- Al anular, las líneas quedan libres para otra acta; lo certificado sigue guardado en el acta anulada (5.7).

## 4. Migración abierta: qué pasa con los datos anteriores

| Antes | Ahora |
|---|---|
| Solicitud con una sede | Cada línea lleva esa sede; la solicitud queda **aprobada** (ya estaba en operación) |
| Estado de la solicitud | Avance de cada línea (recolectada → realizada; programada → programada; cancelada → descartada) |
| Parada por solicitud | Parada por sede, y sus líneas en `ruta_items`. La firma y las fotos viejas quedan en las observaciones |
| Etapa final «Cancelada» | Marcada para cancelar |
| Manifiesto (emitido, recibido, cerrado, anulado) | Pendiente, realizado o anulado; la fecha de emisión pasa a fecha de servicio |
| Línea del manifiesto | Toma declaración, generador y precio de la solicitud; disposición principal y métrica de la declaración |
| Conciliación colgada del acta | Una conciliación por manifiesto; queda aprobada si su acta estaba emitida |
| Acta (estado anterior, certificado) | Borrador, emitida o anulada; el certificado pasa a archivo; código de verificación nuevo |
| Inspecciones | Reciben su consecutivo en orden de fecha |

## 5. Decisiones que tomé y conviene confirmar

1. **Consecutivos provisionales:** `MF-AAAA-00001`, `INS-AAAA-00001` y `ACT-AAAA-00001`, con reinicio anual. Se cambian en
   la tabla `consecutivos` sin tocar código (pregunta 1).
2. **Recurrente:** nace a la fecha del servicio más la frecuencia de la declaración. Se puede activar 3 días antes. Al
   aprobarla pasa a formal.
3. **ARL y EPS:**
   - se exigen al **tercero** que descarga en planta;
   - para los conductores propios quedan en su ficha, pero no bloquean el cargue, porque los gestiona Talento Humano.
4. **Fotos:** solo con el manifiesto pendiente. El **PDF escaneado** puede subirse después de grabar.
5. **Cancelar una ruta:**
   - libera las líneas que no se recogieron;
   - lo ya recogido sigue en su manifiesto.
6. **Cargue de solicitudes por Excel:** crea solicitudes **pendientes de aprobación**. El cargue no reemplaza la decisión
   comercial.

## 6. Fase 3-B: API (hecha, 18-11-2026)

Pasan 43 pruebas de reglas y 95 de punta a punta. La sección 8 de las e2e recorre toda la cadena por la API.

| Ruta | Qué hace |
|---|---|
| `GET programacion/pendientes` | Solicitudes aprobadas con líneas sin programar y su contador |
| `POST rutas` · `PATCH rutas/:id` · `POST rutas/:id/items` · `DELETE rutas/:id/items/:id` | Programar por línea, también sin recursos; asignar vehículo, conductor y flete; agregar o quitar líneas |
| `POST rutas/:id/rastreo` · `GET rutas/:id/rastreo` | GPS en lote desde la app (sirve sin señal) y recorrido para el mapa |
| `PATCH solicitudes/:id/aprobacion` · `PATCH solicitudes/items/:id/descartar` | Aprobar o no aprobar; descartar una línea con causal |
| `POST manifiestos/desde-ruta` · `POST manifiestos` | Un cargue por parada de la ruta; descargue (o cargue manual) desde una solicitud |
| `PATCH manifiestos/:id` · `POST/DELETE manifiestos/:id/items` | Báscula, horas, transportador con ARL y EPS; líneas agregadas en campo |
| `POST manifiestos/:id/evidencias` | Fotos (JPG, PNG o WebP) y PDF. El tipo se reconoce por el contenido, no por el nombre |
| `POST manifiestos/:id/grabar` · `POST manifiestos/:id/anular` | Firma táctil (PNG) y paso a REALIZADO, con el peso neto calculado; anulación con causal o motivo |
| `GET conciliaciones` · `GET conciliaciones/consolidado` · `GET conciliaciones/:id` · `GET conciliaciones/:id/excel` | Bandeja con totales; consolidado por cliente; detalle; Excel |
| `PATCH conciliaciones/:id/items` · `POST conciliaciones/:id/igualar · aprobar · reabrir` | Grilla editable (cantidades, precio, negociación, factura y pago); igualar cantidades; aprobar o reabrir |
| `GET actas/pendientes` · `POST actas` · `POST actas/:id/items` | Líneas aprobadas sin certificar; crear acta del periodo; ajustar líneas |
| `POST actas/:id/emitir` · `POST actas/cargar` · `POST actas/:id/anular` | Copia fija y PDF con QR; acta de un gestor aliado (PDF subido); anular |
| `GET actas/:id/pdf` · `GET actas/zip?ids=` | PDF individual y descarga masiva en ZIP |
| `GET verificar/:código` (pública) | Lo mínimo para validar el QR: número, tipo, estado, fecha y emisor. Nunca datos del cliente |
| `GET informes/rutas/rendimiento` · `GET informes/rutas/costos?formato=xlsx` | Cumplimiento por ruta, día y rango, más kilómetros; costos de flete |
| `GET catalogos/operacion` · `GET archivos?clave=` | Listas para la app (ARL, EPS, especificaciones, causales, destinos, etapas); descarga de firmas, fotos y PDF, solo de la propia empresa |

**Decisiones de esta fase:**
- **PDF con `pdfkit`, en el mismo servidor.** No usa Gotenberg, así que no hace falta Docker ni otro servicio. El PDF se
  genera solo desde la copia fija, de modo que se puede volver a generar idéntico.
- **Diseño del certificado: provisional y propio.** Lleva encabezado con QR, generador con coordenadas, tabla de residuos
  con tratamiento y soporte legal, transporte, marco legal y firma del representante legal. **No lleva sellos ISO**
  hasta que se confirme la autorización del ente certificador.
- **Soporte legal de cada línea:** se exige al emitir, revisado **a la fecha del servicio**:
  - permiso de la CAS que no haya vencido antes del servicio;
  - licencia del aliado vigente en esa fecha;
  - o el objeto social.

  Si alguna línea no lo tiene, el acta no se emite.
- **GPS sin señal:** la base guarda el historial de etapas (`ruta_eventos`, migración `20261121000000`). Un punto vale si
  la ruta estaba en una etapa con rastreo **a la hora del punto**. Los puntos con hora futura se rechazan.
- **Archivos:**
  - se guardan en una carpeta local separada por empresa (`ALMACENAMIENTO_DIR`, por defecto `apps/api/almacenamiento`);
  - en producción se cambia a S3 o R2 con la misma interfaz;
  - se valida el tipo real de cada archivo;
  - cada empresa solo ve los suyos.
- **Error corregido de la fase 1:** el precio de la solicitud tomaba la tarifa más reciente aunque rigiera en el futuro.
  Ahora toma la tarifa vigente **en la fecha del servicio**.
- **Informe de rendimiento:**
  - *planeados* = líneas que alguna vez se asignaron a la ruta;
  - *habilitados* = las que siguen asignadas;
  - *ejecutados* = las habilitadas que quedaron en un manifiesto grabado.

  Pendiente confirmar con Terra Viva (pregunta 6 del análisis).

## 7. Fase 3-C: app del conductor (hecha, 18-11-2026)

Funciona en el celular como app instalable (PWA) y **sin señal**. Está en `apps/web/src/pages/CampoServidor.tsx` y `apps/web/src/campo/`.
Se probó en el navegador en tamaño de celular contra la API: inspección, salida con kilometraje, manifiesto con firma
**grabado con la API apagada** y enviado solo al volver la conexión.

| Pantalla | Qué hace |
|---|---|
| **Mi ruta** | Ruta del día (placa, código, etapa, auxiliar); aviso si falta la inspección; botones de etapa (pide el kilometraje al salir y al terminar); paradas con cliente, sede, residuos, «Cómo llegar» y estado del manifiesto; «Abrir los manifiestos de la ruta» (con señal) |
| **Inspección** | Elementos por grupo con botones grandes Bien / Falla / No aplica; los críticos marcados; kilometraje; resultado al instante |
| **Manifiesto** | Cantidad y embalajes por residuo; horas con «Marcar ahora»; báscula con neto automático; ARL y EPS del conductor tercero (descargues); 2 fotos desde la cámara (comprimidas); firma con el dedo; nombre e identificación; avisa exactamente qué falta antes de grabar |
| **Envíos** | Estado de la señal y de la cola; «Enviar ahora»; las acciones rechazadas por el servidor quedan a la vista con su motivo, para reintentar o descartar |

**Cómo funciona sin señal:**
- **Paquete del día:** con señal (normalmente en planta), la app descarga la ruta, sus manifiestos, la inspección del
  día y las listas, y lo guarda en el teléfono.
- **Cola en el teléfono (IndexedDB):** guarda cada acción, incluidas las fotos, y la envía **en orden** cuando hay
  conexión (al volver la señal, cada 30 segundos o con «Enviar ahora»).
- **Rechazo del servidor:** si rechaza algo por una regla del negocio, esa acción y las siguientes del mismo manifiesto
  esperan a que el conductor la revise.
- **GPS:** se toma cada ~30 segundos solo mientras la ruta está en una etapa con rastreo y se envía en lotes. La base lo
  acepta por la hora del punto, gracias al historial de etapas.
- **Borrador del manifiesto:** se guarda mientras se diligencia, así que cerrar la app no borra lo escrito.
- **PWA:** manifiesto, ícono propio y *service worker*. La app abre sin señal después de la primera visita, solo en la
  versión publicada.

**Límites conocidos:**
- El GPS solo se toma con la app abierta: el navegador no permite rastreo en segundo plano. Para eso haría falta una app
  nativa.
- Los manifiestos se abren con señal, porque el consecutivo lo asigna el servidor.

**Errores corregidos en esta fase:**
- **Fechas en hora de Colombia.** Varias fechas se tomaban en hora UTC, y después de las 7 p. m. en Colombia ya era el
  día siguiente: la tarifa nueva quedaba vigente «mañana», y la fecha de emisión del certificado salía corrida. Ahora se
  usa la fecha de Colombia (`fechaColombia()`).
- **Rutas nuevas para la app:** `GET preoperacionales?vehiculoId&fecha` (inspección del día del vehículo) y
  `PATCH manifiestos/:id/items/:itemId` (corregir la cantidad recogida en campo).

## 8. Fase 3-D: torre de control (hecha, 18-11-2026)

La oficina maneja toda la cadena desde el computador, y las pantallas también se adaptan al celular. Está en
`apps/web/src/pages/torre/` y `apps/web/src/pages/Verificar.tsx`.

Se probó en el navegador contra la API, de punta a punta:
1. crear y aprobar una solicitud;
2. programar dos líneas en una ruta nueva y quitar una;
3. asignar vehículo y conductor a una ruta que no los tenía;
4. abrir el manifiesto y ver uno ya grabado, con su firma;
5. conciliar con una diferencia del −7,7 % (pide justificación), aprobar y registrar la factura;
6. crear y emitir el acta, y abrir su QR en la página pública.

| Pantalla (menú) | Qué hace |
|---|---|
| **Solicitudes** | Lista por fecha, cliente, aprobación y avance. **Nueva solicitud:** cliente, fecha, residuos autorizados y activos del cliente con la sede, cantidad y jornada de cada línea, y el total estimado con la tarifa vigente. Se puede aprobar al crearla. En el detalle: aprobar, no aprobar o cancelar con causal |
| **Por confirmar** | Solo lo que espera aprobación comercial, incluidas las recurrentes que crea TERRY-GO al grabar un manifiesto. Al aprobar pasan a «por programar» |
| **Programación** | **Calendario del mes:** las rutas con el color del vehículo (gris si no tiene); clic en el número del día para ver todas sus rutas. **Pestaña «Por programar»:** líneas aprobadas agrupadas por solicitud, con buscador, zona y aviso de atrasadas; se programan líneas sueltas o solicitudes completas en una ruta nueva (una parada por sede) o se agregan a una ruta del mismo día; también se descarta una línea con su causal |
| **Programación en tabla** | Las rutas por rango, con filtros de vehículo, conductor y zona, y los costos de flete en Excel |
| **Seguimiento** | Las rutas de hoy con su etapa, salida, kilometraje y paradas atendidas. Se actualiza cada minuto |
| **Detalle de ruta** (en las tres anteriores) | Asignar o cambiar vehículo, conductor (avisa si la licencia está vencida), auxiliar, zona, fecha, hora y flete; quitar una línea, que vuelve a «por programar»; abrir los manifiestos; ver la última ubicación GPS en el mapa |
| **Manifiestos** | Lista por fechas, estado, tipo y número. El detalle trae las líneas con su valor, la báscula, las horas, la firma y las fotos. Desde ahí se adjunta el PDF escaneado, se anula con causal o motivo, o se va a su conciliación |
| **Conciliación** (antes «Recepción y pesaje») | **Bandeja:** por defecto, las que están por conciliar, con totales de cobro, compra y neto. **Grilla por manifiesto:** cantidad conciliada, precio, negociación, forma de pago, justificación, orden de compra, factura y pago. La diferencia % y los totales se recalculan mientras se escribe. Acciones: igualar cantidades, guardar, aprobar, reabrir y Excel. Ya aprobada, solo cambian la factura y el pago |
| **Certificados** | Filtros por cliente, estado, periodo y número. Se eligen varias actas y se descargan en un ZIP. **Nueva acta:** cliente, periodo y tipo; propone las líneas aprobadas sin certificar; crea el borrador, al que se le pueden quitar líneas, y al emitirlo genera el PDF con QR. Además: ver o descargar el PDF, anular, copiar el enlace de verificación y cargar el PDF del acta de un gestor aliado |
| **Verificación pública** | Página sin sesión que abre el QR. Dice si el documento es auténtico y vigente, está anulado o no existe, con número, tipo, periodo, fecha y emisor. Nunca muestra datos del generador. El código también se puede escribir a mano |

**Cambios en la API:**
- **Listas nuevas:** `GET personal` (conductores y auxiliares activos, sin correos ni documentos) y `GET zonas`, para
  asignar rutas.
- **`POST rutas`:**
  - el código es opcional: se numera solo como `R-AAAAMMDD-01`;
  - acepta hora y observaciones;
  - explica si el código ya existe;
  - valida que vehículo, conductor y zona sean de la empresa (antes solo lo hacía al editar).
- **Enlace del QR:** ahora es `…/#verificar/<código>`, que abre en cualquier hosting sin reglas de reescritura. Los
  enlaces viejos `…/verificar/<código>` también sirven: la página los convierte.
- **Pruebas e2e:** pasan de 98 a 109. Las nuevas cubren las listas, el código automático, programar por línea, agregar
  y quitar líneas de una ruta, descartar y cargar actas de aliados.

**Decisiones que tomé y conviene confirmar:**
- **Nombre en el menú:** «Recepción y pesaje» pasó a llamarse **Conciliación**. Es la misma tarea (lo cargado contra la
  báscula) y ahora incluye precios y factura.
- **Bandeja de conciliación:** abre en las que están **en borrador**, con servicio en los últimos 60 días.
- **Nueva acta:** propone el **mes anterior** completo y todas sus líneas aprobadas sin certificar.

## 9. Lo que sigue

- **Pendientes de la torre de control:**
  - descargues en planta desde la oficina: hoy la API los soporta, pero falta el formulario de la solicitud de descarga
    y su manifiesto;
  - recorrido GPS completo en un mapa (hoy se ve el último punto);
  - mover rutas arrastrándolas en el calendario.
- **Conectar lo que aún es de ejemplo:** clientes, tarifas, inspecciones (vista de oficina), inventario, permisos,
  indicadores y ajustes.
- **Declaraciones, fase B:** el formulario de 8 secciones.
