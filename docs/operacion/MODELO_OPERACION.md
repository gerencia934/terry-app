# TERRY-GO · Fase 3-A — Modelo de datos y reglas del núcleo operativo

Estado: **entregado para revisión** (20-11-2026), en la rama `fase-3-operacion`.

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

## 6. Lo que sigue (fase 3-B, con su visto bueno)

- **API de manifiestos:** crear desde la ruta o la solicitud, líneas en campo, evidencias, grabar y anular.
- **API de conciliación:** «igualar cantidades», totales agrupados por unidad, aprobación y cartera.
- **API de actas:** armar desde conciliaciones aprobadas, copia fija con los permisos vigentes, PDF con QR y la ruta
  pública `/verificar/<código>`.
- **Almacenamiento de archivos:** firma, fotos y PDF. En el equipo de desarrollo, carpeta local; en producción, S3 o R2.
