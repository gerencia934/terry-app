# Documentos reales de la operación — qué deben cambiar en el diseño

Estos son documentos reales de Terra Viva, emitidos en noviembre de 2026 con el sistema actual. Se usan como
**referencia de contenido y de reglas**, no de diseño gráfico: los formatos nuevos llevan diseño propio de Terra Viva.
Los PDF **no se suben al repositorio** mientras la gerencia no lo autorice, porque contienen datos personales
(cédulas, firmas, ARL y EPS). Este análisis recoge todo lo necesario para el diseño.

| Archivo | Qué es |
|---|---|
| `recibo-descarga-TV1830.pdf` | Recibo de descarga en planta (tiquete angosto) |
| `manifiesto-descarga-TV1830.pdf` | Manifiesto de descarga y recepción de residuos |
| `certificado-PSAP2026-296.pdf` | Certificado de gestión integral, tratamiento y disposición final |
| `planilla-cargue-declaraciones-DMR.pdf` | Planilla diligenciada de cargue masivo: residuos, servicios, códigos Y/A y notas |

> **Datos personales.** Los originales contienen cédulas, firmas y datos de seguridad social de personas. Nunca se
> usan como datos de prueba: las pruebas usan datos ficticios.

## 1. Caso real: cliente GESTOR con muchos generadores

En el manifiesto TV1830, el cliente Limpieza y Logística Ambiental de Colombia S.A.S. es un **gestor**. Llevó
en su propio vacuum ARD de más de 35 generadores terceros: Braserv, Ismocol, Power China, Ventus y otros.

**Problemas del sistema actual que el nuevo NO debe repetir:**

1. **Las 39 líneas dicen «Sede Principal».** El generador real de cada línea solo aparece en un texto libre de
   observaciones.
   - **Requisito:** cada línea del manifiesto y del certificado se liga a la **sede/generador** que la produjo.
   - El modelo ya lo permite: `sucursales.generador_nit` y `generador_nombre` para clientes GESTOR.
2. **Unidades mezcladas.** Las observaciones van en litros y las líneas en m³.
   - **Requisito:** se registra la cantidad en la unidad en que se recibe y se convierte con el factor de la métrica.
   - El certificado muestra siempre la unidad de la declaración.
3. **El certificado sale a nombre de «Sede Principal - Vda. El Palmar»** como razón social, y su generador es el gestor.
   - **Requisito:** para clientes GESTOR, el sistema debe poder emitir:
     - **un certificado por generador**, que es lo que el gestor entrega a cada uno de sus clientes, o
     - un consolidado para el gestor con el detalle por generador.
   - La razón social del certificado es la del generador, nunca el nombre de una sede.
4. **Precios en $0.** El servicio se factura aparte (tarifa global o por contrato).
   - **Requisito:** debe ser posible manifestar con valor 0 sin que la conciliación ni la prefactura fallen, y
     marcarlo como «facturación por contrato».

## 2. Recepción en planta de transportadores externos

En el caso real **el vehículo no es de Terra Viva**: placa LPM847 y conductor del cliente.

**Requisitos:**
- La recepción y el manifiesto aceptan un **transportador externo**:
  - empresa y NIT;
  - placa y tipo de vehículo;
  - conductor con documento, ARL y EPS;
  - auxiliar.
- No se exige que el vehículo esté en la flota propia.
- Registro de **hora de llegada y salida**, y de **cantidad de entrada, de salida y neta** por báscula, con la nota
  de calibración de la báscula.
- **Firma digital del receptor de Terra Viva y del conductor o cliente** en el momento de la descarga.
- **Recibo inmediato** en formato angosto (impresora térmica) y manifiesto completo en PDF.
- El recibo y el manifiesto de una misma descarga comparten número (TV####).

## 3. Certificado de disposición final

**Contenido mínimo que ya maneja Terra Viva** (se conserva el texto propio de Terra Viva):
- Número con formato `PSAP{año}-{consecutivo}`.
- QR de verificación de autenticidad.
- Datos del generador.
- Relación técnica por línea:
  - número de manifiesto y fecha de servicio;
  - residuo, unidad y cantidad;
  - tecnología de tratamiento;
  - licencia o permiso.
- Transportador.
- Respaldo legal.
- Lugar, fecha y firma del representante legal.
- Sellos ISO 9001, 14001 y 45001 y Norsok S-006 con sus números de certificado.

**Problemas a corregir:**
1. **La columna «Licencia y/o permiso» sale vacía.**
   - **Requisito:** se llena sola desde la disposición de cada línea. Usa el permiso de la CAS que la ampara o la
     licencia del gestor aliado (tabla `permiso_disposiciones`).
   - Esta es la prueba de cumplimiento que el generador muestra a su autoridad.
2. **Los párrafos de respaldo son fijos.** El certificado de este caso, que solo contiene ARD con vertimiento a
   suelo, incluye textos sobre RESPEL en celdas de seguridad, incineración, aprovechamiento y ZLD.
   - **Requisito:** cada párrafo se incluye **solo si el certificado contiene residuos con esa disposición**.
   - Los textos legales se administran desde Ajustes, con versión y fecha.
3. **Certificado emitido solo con recepción confirmada.**
   - Debe guardar el hash SHA-256 del PDF.
   - Anular un certificado deja rastro y nunca lo borra.

### Permisos a registrar (tomados del certificado)

| Acto | Autoridad | Ampara |
|---|---|---|
| Resolución DGL No. 000632 del 15/08/2023 | CAS | Tratamiento y vertimiento al suelo de ARI y lodos, caudal 3,65 L/s |
| Oficio SAO No. 1762-2023 | CAS | Alcance técnico: lodos, cortes de perforación, salmueras y borras (hidrocarburos, manufactura, minería) |
| Resolución 0235-2024 | CAS | Disposición final de RCD |
| Oficio SAA No. 0311-21 | CAS | Inscripción como gestor de ACU, conforme a la Res. 316 de 2018 |
| Auto SAA 0244-21 (Rad. 80.30.17312.2024) | CAS | Plan de contingencia: transporte de hidrocarburos y RESPEL |
| Expediente TH 0013-2021 / SINCA 33950 | CDMB | Plan de contingencia: transporte |

Con esto queda resuelta la pregunta 1 de la Fase A: el acto del ACU es el **Oficio SAA 0311-21**, y la
**Res. 316 de 2018** es la norma bajo la que se inscribió. Además se agregan el Oficio SAO 1762-2023 y el PDC de
la CDMB.

## 4. Planilla de cargue masivo (DMR)

**Lo que muestra la operación real:**
1. **Los mismos 10 servicios estándar se cargan para unos 40 clientes**, uno por fila: alquiler de camión de vacío,
   limpieza de trampas de grasa, pozos sépticos, tanques y vasijas, cuadrilla de limpieza, recolección y embalaje,
   transporte, fumigación institucional, poda de árboles y obras civiles.
   - **Requisito:** «asignación masiva». Se eligen uno o varios servicios del catálogo propio y se asignan a varios
     clientes de una vez, con valores por defecto. No hace falta una planilla de 400 filas.
2. **Las unidades sanitarias portátiles (USP)** tienen frecuencias distintas por cliente: cada 3, 7 o 15 días.
   La frecuencia es por declaración, no por servicio.
3. **Línea de servicio escrita por nombre** («SERV ESPECIALES») y no por código.
   - **Requisito:** el cargue acepta el código o el nombre exacto y avisa si hay ambigüedad.
4. **Subcorrientes del IDEAM** (Y9.1, Y9.2, A4060.1, Y10.1, Y45.x…) además de las corrientes Y y A, y algunos
   números UN dentro de la misma lista.
   - **Requisito:** `codigos_clasificacion` debe manejar **subcorrientes**, con un campo padre que apunte a la
     corriente: Y9.1 → Y9. Los números UN siguen siendo un campo aparte.
5. **Solicitud automática.** La nota de la planilla advierte que se genera **una solicitud por cada residuo**.
   - **Requisito:** las solicitudes automáticas se **agrupan por sede y fecha**: una solicitud con varios ítems.
   - Solo se generan para declaraciones autorizadas y activas.
6. **Reglas de la planilla que coinciden con el modelo propuesto** y deben mantenerse:
   - residuo peligroso: corriente A o Y obligatoria;
   - residuo no peligroso: la corriente se ignora;
   - métrica de precio vacía significa GLOBAL;
   - alcance de sedes: todas o solo la principal.

## 5. Alertas de cumplimiento para la gerencia (verificar)

- **Cobertura del permiso.** El certificado ampara «aguas residuales domésticas» con la Res. 000632, que según su
  propio texto autoriza **aguas residuales industriales** y lodos. Verificar que el acto cubre también ARD, o
  incluir el acto que lo haga.
  - El sistema impedirá autorizar declaraciones cuya disposición no esté amparada, así que esta relación debe quedar
    bien definida.
- **Coherencia del texto ZLD.** El certificado afirma que «NO existen descargas directas» con un modelo de
  descarga cero. Al mismo tiempo, la tecnología certificada es «tratamiento y vertimiento a suelo», bajo un
  permiso de vertimiento.
  - Revisar la redacción con el área jurídica y ambiental para que no se lea como contradictoria ante la CAS o un
    auditor.
- **Alcance de la responsabilidad del generador.** El párrafo de RESPEL habla de «eliminación total de la
  responsabilidad ambiental del generador». Conviene ajustarlo a la Ley 1252 de 2008 y al Decreto 1076 de 2015:
  la responsabilidad del generador subsiste hasta el aprovechamiento o la disposición final.
  - El certificado acredita que esa disposición ocurrió.
