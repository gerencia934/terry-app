# TERRY-GO — Núcleo operativo: análisis y plan (propuesta)

Estado: análisis del 19-11-2026. La fase **3-A** (modelo y reglas) ya está hecha: ver `MODELO_OPERACION.md`.

Este documento cruza tres fuentes:
- la operación de Terra Viva;
- una especificación de 5 módulos que Diego obtuvo con Gemini;
- lo que TERRY-GO ya tiene construido desde la fase 1.

La especificación de Gemini se usó **solo como lista de funcionalidad**. No se guarda en el repositorio, porque está armada
a partir de pantallas de un software de terceros: ver la política en `docs/REQUISITOS_FUNCIONALES.md`.

## 1. La cadena que se va a cerrar

```
Declaración → Solicitud → Ruta (+ inspección del vehículo) → Manifiesto (firma, fotos, báscula)
            → Conciliación (cantidades y dinero) → Acta / certificado (PDF con QR)
```

Hoy la cadena llega con reglas hasta la ruta y la inspección. Del manifiesto en adelante existen las tablas, pero no hay
pantallas ni reglas de cierre.

## 2. Qué ya existe y qué falta, módulo por módulo

### 2.0 Solicitudes (según la matriz de Excel de Terra Viva, carpeta SOLICITUDES)

| Ya existe | Falta |
|---|---|
| Solicitud de carga o descarga, cliente, sede, fecha, franja, estado y causal de cancelación | **Aprobación** de la solicitud (pendiente, aprobada o rechazada), separada del avance operativo |
| Ítems por declaración **autorizada y activa y asignada a la sede** (regla en la base) | Por ítem: sede, jornada (am, pm o todo el día) y especificaciones |
| Cargue masivo por Excel | Orden de compra, adjunto PDF y observaciones con opción de **enviarlas al cliente** |
| | Descarga en planta: destino, empresa transportadora, tipo de vehículo, placa, conductor y auxiliar con ARL y EPS |
| | Cargue masivo **por cliente** con códigos (sede, declaración, cantidad), como el de Declaraciones |
| | Total de la solicitud (suma de cantidades) |

### 2.1 Rutas y rastreo

| Ya existe | Falta |
|---|---|
| Ruta con código, fecha, zona, vehículo, conductor, auxiliar, kilómetros y horas | Rutas recurrentes (las que se repiten con una frecuencia) |
| Paradas por solicitud, con llegada, ubicación, firma y fotos | Asignar **ítems** sueltos de una solicitud, no solo la solicitud completa |
| Etapas del recorrido con color y orden; regla de que la ruta no sale sin inspección aprobada | Marca de **ruta interna** (movimiento dentro de la planta) |
| Programar y cambiar etapa por API | En la etapa: descripción y el interruptor «rastreo GPS mientras esté en esta etapa» |
| | Historial de puntos GPS (`ruta_rastreo`) y su mapa |
| | Vehículo de tercero: su propietario o transportador y el **valor del flete** de la ruta |
| | Informes: costos de flete (Excel) y rendimiento (servicios planeados / ejecutados, % de cumplimiento, km) |
| | Calendario de programación (mes / semana / día / lista) |

### 2.2 Inspección del vehículo (preoperacional)

| Ya existe | Falta |
|---|---|
| Lista de elementos, con los críticos que bloquean la salida | Consecutivo propio del documento de inspección |
| Respuesta por elemento con foto; firma; km; aprobado sí o no | Marca de «novedad» visible en el listado, calculada si algún elemento falló |
| Regla en la base: la ruta no sale sin inspección aprobada | Observación por elemento; enlace con los manifiestos de esa ruta |

### 2.3 Manifiestos de carga y descarga

| Ya existe | Falta |
|---|---|
| Número, ruta, cliente, sede, vehículo, conductor, destino, estado y consecutivo RNDC | **Tipo**: carga o descarga |
| Ítems ligados al ítem de la solicitud, con cantidad y embalajes | Ítems agregados en campo, que no venían en la solicitud pero sí en una declaración autorizada |
| | Por ítem: métrica, disposición, embalaje, especificaciones, precio unitario y subtotal |
| | Báscula: **peso de entrada, de salida y neto** (neto = entrada − salida) |
| | Transportador de terceros (descargas): empresa, tipo de vehículo, placa |
| | Conductor y auxiliar con **ARL y EPS**: catálogos ARL y EPS, obligatorios para entrar a planta |
| | Manifiesto del cliente y orden de compra |
| | Conciliación interna o externa; sede o planta que recibe |
| | **Evidencias**: 2 fotos desde la cámara del celular más un PDF escaneado |
| | **Hora de llegada y de salida**, ambas obligatorias |
| | **Firma táctil del conductor**, con nombre e identificación, obligatoria para grabar |
| | Anulación con motivo, auditada; descarga masiva de copias (ZIP) |

### 2.4 Conciliaciones (cierre operativo y financiero)

Hoy la conciliación cuelga del **acta**, y se debe mover: la conciliación es **por manifiesto** y va **antes** del acta.

| Ya existe | Falta |
|---|---|
| Ítem con cantidad de origen y de destino (báscula de planta) | Encabezado de conciliación por manifiesto, con estado (borrador o aprobada) y responsable |
| Regla en la base: diferencia de más de ±2 % exige justificación | Cantidad conciliada, unidad conciliada, precio unitario y valor total por ítem |
| | Negociación (cobro o compra), forma de pago (contado o crédito), disposición y orden de compra por ítem |
| | **Factura del cliente**, fecha de emisión, fecha de vencimiento y estado de pago: cartera básica, antes de la factura electrónica DIAN |
| | Botón «igualar cantidades»: copia lo cargado en lo conciliado |
| | Totales: ítems, cargado, conciliado, cobro, compra, contado, crédito y pesos de báscula |
| | Exportar a Excel, enviar por correo y PDF de la conciliación |

### 2.5 Actas y certificados de disposición final

| Ya existe | Falta |
|---|---|
| Acta con número, tipo, cliente, destino, periodo, estado y PDF | Que use **solo cantidades de conciliaciones aprobadas** |
| Disposición con soporte legal y permisos de la CAS que la amparan (módulo Declaraciones) | Consecutivo de Terra Viva, con el formato que ustedes definan |
| | **Código QR** con enlace público de verificación: muestra solo lo mínimo (número, fecha, estado), nunca datos del cliente |
| | Generador con **coordenadas** de la sede |
| | Por ítem: tratamiento y licencia o permiso, tomados de las disposiciones y los permisos vigentes |
| | Bloque legal automático: resoluciones de la CAS según los tratamientos aplicados |
| | Actas de gestores aliados cargadas como archivo (quién la cargó y cuándo); descarga masiva en ZIP |

### 2.6 Detalles adicionales de funcionalidad (revisión de las capturas de referencia, 19-11-2026)

Solo se anota funcionalidad. El diseño, los textos y los formatos son propios de TERRY-GO.

- **Dos flujos distintos:**
  - **Carga:** solicitud → aprobación → programación → inspección → manifiesto con recorrido → conciliación.
  - **Descarga:** el cliente o un tercero llega a la planta, y va de la solicitud directo al manifiesto, sin ruta ni
    rastreo.
- **Solicitudes:**
  - Estados de aprobación y de gestión: pendiente, aprobada, no aprobada, gestionada, descartada.
  - Calendario de pendientes por tipo: carga, carga automática, descarga, sin aprobar y descartada.
  - Aviso al salir sin guardar.
- **Solicitudes recurrentes (pre-solicitudes):** nacen de un servicio ya hecho, con fecha del próximo servicio. Encajan
  con la «solicitud automática» por frecuencia de la declaración.
- **Especificaciones adicionales:** catálogo con nombre, descripción y abreviatura (cadena de custodia, destrucción
  certificada…), de selección múltiple por línea de solicitud y de manifiesto.
- **Cargue de solicitudes por Excel:** la plantilla sale **prellenada** con las sedes y las declaraciones del cliente.
  Solo se escribe la cantidad.
- **Programación parcial:** se elige **línea por línea** qué se recoge en cada ruta. Lo no programado queda pendiente,
  con un contador por solicitud. También se pueden agregar servicios a la ruta sin solicitud previa (se crea la
  solicitud al vuelo).
- **Filtros de programación:** «rutas sin vehículo o sin conductor» y «rutas internas».
- **Etapas del recorrido** (configurables): en camino (con rastreo), en sitio, finalizada, cancelada.
- **Rendimiento de rutas:**
  - % por ruta = servicios ejecutados ÷ habilitados de la ruta.
  - % por día = Σ ejecutados ÷ Σ habilitados de las rutas del día.
  - Kilómetros de inicio, en ruta y total.
- **Vehículo:** capacidad (kg) y volumen (m³). Si es de un tercero, su proveedor y su NIT, para el informe de costos de
  flete.
- **Manifiesto:**
  - El consecutivo es **uno solo** para carga y descarga.
  - Precio unitario de solo lectura, tomado de la tarifa vigente.
  - **Generador por línea**, porque los clientes gestores traen residuos de varios generadores.
  - Pesos con máximo 2 decimales.
  - Evidencias: 2 fotos **o** un PDF.
  - La hora de llegada se propone con la hora actual.
  - Al anularlo se pide la causal y se libera su programación.
- **Conciliación:**
  - Listado con el **asesor comercial** del cliente (hoy el cliente no tiene ese campo) y clasificación interna.
  - «Consolidado» de varias conciliaciones.
  - **Mejora propia:** los totales se agrupan por unidad (kg, m³, gal…), en vez de sumar unidades distintas.
- **Inspección del vehículo:** se ve el listado (novedad, consecutivo, elaboró, incumple sí/no, manifiestos
  relacionados), pero no el formulario. El nuestro ya existe.

## 3. Reglas de cambio de estado (propuestas)

Las reglas viven en la base de datos, como en Declaraciones. Así no se pueden saltar ni desde la app ni con cargues.

| Evento | Efecto automático |
|---|---|
| Se programa la ruta con la solicitud | Solicitud → PROGRAMADA |
| La ruta pasa a una etapa con rastreo | Empieza el registro GPS (solo en esas etapas) |
| Se **graba** el manifiesto con firma, horas y báscula completas | Manifiesto → REALIZADO; solicitud → RECOLECTADA; se crea la conciliación en borrador |
| Falta la firma, la hora de llegada o de salida, o el peso neto (si aplica báscula) | No se puede grabar |
| Se **aprueba** la conciliación (diferencias de más de ±2 % justificadas) | Se habilita el acta |
| Se intenta emitir un acta con ítems de conciliaciones no aprobadas | Bloqueado |
| Se anula un manifiesto | Solo si su conciliación no está aprobada; queda auditado con motivo |

## 4. Lo que no se toma de la propuesta de Gemini

- **«Replicar la arquitectura de Grinclic».** Se toma la funcionalidad, no la réplica. El vocabulario, la navegación,
  los formatos de consecutivo y las plantillas son de Terra Viva.
- **Códigos de ejemplo** de otro sistema (códigos de ruta, de acta, formatos de placa). Terra Viva define los suyos.
- **«Server Actions».** TERRY-GO usa API REST con NestJS. Se mantiene el stack actual.
- **Sellos ISO e IQNet en el certificado.** Solo se pueden poner si el certificado está vigente y el ente certificador lo
  permite, con su manual de uso de marca. Hay que confirmarlo antes de diseñar el PDF.

## 5. Cuidados legales y técnicos

- **Rastreo GPS de conductores** (Ley 1581 de 2012):
  - solo durante las etapas con rastreo activado, nunca fuera de la jornada;
  - con aviso y autorización firmada del trabajador.
- **ARL y EPS de conductores de terceros:** son datos personales. Se piden solo para el ingreso a planta, con
  autorización de tratamiento, y se ven solo por rol.
- **Fotos, firmas y PDF:** se guardan en almacenamiento de archivos (S3 o R2, como prevé la arquitectura). En el equipo de
  desarrollo, en una carpeta local.
- **App del conductor sin señal:** el manifiesto se diligencia sin conexión y se sincroniza al volver la señal. La
  firma y las fotos se guardan en el teléfono hasta enviarse. Ya estaba pendiente desde la fase 1b.
- **PDF y QR:** el PDF se genera en el servidor (Gotenberg, como prevé la arquitectura). El QR apunta a
  `/verificar/<código>`, que es público y de solo lectura.

## 6. Plan por fases (cada una con su visto bueno, como en Declaraciones)

| Fase | Contenido | Entregable |
|---|---|---|
| **3-A** | Modelo de datos y reglas de estado de toda la cadena, incluidos los cambios en Solicitudes que pide su matriz | Esquema, migraciones y pruebas SQL de las reglas |
| **3-B** | API: báscula, totales de conciliación, anulación, PDF del certificado con QR, verificación pública | Rutas y pruebas e2e |
| **3-C** | App del conductor (celular, sin señal): inspección, ruta del día con cambio de etapa, manifiesto con cámara, báscula y firma | Pantallas móviles |
| **3-D** | Torre de control (escritorio): calendario de rutas, conciliación editable, actas y descargas | Pantallas de escritorio |

Pendiente en paralelo: la **fase B de Declaraciones** (formulario de 8 secciones).

## 7. Datos que hay que confirmar con Terra Viva

1. Formato del consecutivo de manifiestos, inspecciones y actas (prefijo, año, número).
2. Certificaciones vigentes y si el ente certificador autoriza su sello en los certificados.
3. Lista de ARL y EPS que se va a usar.
4. Si los vehículos de terceros cobran flete por ruta, por viaje o por tonelada.
5. Si la conciliación la aprueba siempre una misma persona o un rol (Facturación o Logística).
6. Diferencia entre servicios **planeados** y **habilitados** en el informe de rendimiento.
7. Qué hace que una solicitud pase a **gestionada** y quién la **descarta**.
8. Listas de: tipo de conciliación (interna o externa), clasificación interna del cliente, tipo de vehículo y estados de
   pago de factura.
9. Si el **total general** de la conciliación es cobro − compra o la suma de ambos.
