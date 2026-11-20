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
| RG | **Respuestas de la gerencia aplicadas** (19-11-2026): ningún peligroso en Los Pinos (ni autorización ni recepción), hidrocarburos con caracterización CRETIB, gestores aliados reales con licencia y exclusiones, permisos y obligaciones reales (OB-xx), textos legales aprobados (RESPEL solo con peligrosos, aliado con su certificado), cuatro ojos en cambios críticos, sellos vigentes y calibración de báscula. 53 pruebas de reglas y 178 e2e OK | rama `fase-3-operacion` (`docs/declaraciones/MODELO_DATOS.md` §9; respuestas en `docs/privado/`, fuera de git) |
| 1c | **Conectar lo que aún era de ejemplo, hecho** (19-11-2026): ✅ Clientes y sedes (búsqueda, ficha, crear y editar; inactivar sin borrar; DIVIPOLA completa del DANE con 1.122 municipios). ✅ Tarifas (ajuste % o precio fijo a las seleccionadas o a todas las filtradas, impacto mensual, historial; nunca hacia atrás: desde hoy o una fecha futura, la misma fecha corrige y un precio programado manda). ✅ Permisos (obligaciones con plazo; cada cumplimiento con radicado y soporte en un historial que no se borra; vigencia de permisos y de licencias de aliados desde la pantalla: con eso se desbloquean INCH y RS). ✅ Inspecciones (vista de oficina por rango, vehículo y resultado, con el detalle de cada ítem) y Flota (vencimientos de SOAT, técnico-mecánica y póliza; crear, editar e inactivar). ✅ Usuarios y roles (solo administración: invitación por correo para que cada quien cree su contraseña, inactivar cierra sus sesiones, desbloquear, matriz de permisos). ✅ Inicio e Indicadores (cadena de trazabilidad del mes, operación de hoy, agenda, obligaciones; toneladas, facturado, compras y servicios por mes, cliente, destino, tratamiento, vehículo y conductor). ✅ Inventario (por ahora, lo que entra a Los Pinos por tratamiento) y Catálogos y etapas (consulta). Falta el saldo de inventario y editar catálogos: preguntas F1 y F2 de `docs/PREGUNTAS_GERENCIA.md`. 72 pruebas de reglas y 288 e2e OK | rama `fase-3-operacion` (`apps/web/src/pages/ClientesServidor.tsx`) |
| 2-C | **Cargue desde CSV y deshacer un cargue, hecho** (19-11-2026): CSV con el separador y la codificación detectados (punto y coma, coma, tabulador o barra; UTF-8, Windows-1252 o UTF-16), plantilla en CSV; deshacer un cargue de declaraciones las deja ANULADAS (nada se borra), libera sus códigos y no se permite si alguna ya está en una solicitud o un manifiesto. 67 pruebas de reglas y 208 e2e OK | rama `fase-3-operacion` (`docs/declaraciones/MODELO_DATOS.md` §10) |
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
- **C.** Cargue masivo de clientes directos. ✅ Hecho el 19-11-2026 (MODELO_DATOS §10):
  - Excel o CSV, con el separador y la codificación detectados; valida los códigos paramétricos, guarda el lote en una
    transacción y deja el historial en `cargues_masivos` con el hash, el formato y el separador del archivo.
  - Deshacer un cargue de declaraciones: quedan ANULADAS (nada se borra) y sus códigos quedan libres.
  - Cargue por el propio cliente desde su portal: ✅ 19-11-2026 (misma plantilla sin NIT ni precio; queda en revisión).

Las 7 preguntas de la fase A están respondidas. Ver la tabla en `docs/declaraciones/MODELO_DATOS.md`:
- **ACU:** lo amparan los dos actos, el OF-311-21 y la Res. 316 de 2018.
- **Categorías:** las 5 actuales quedan confirmadas.
- **Migración «abierta»:** convierte datos de la fase 1 si los hay.

Los permisos de la CAS, sus vigencias y sus obligaciones reales (código OB-xx) quedaron cargados con las respuestas de la
gerencia (fila RG). Un permiso sin fecha de vencimiento cuenta como vigente mientras su estado sea VIGENTE.

## Fuentes del usuario

Están en la carpeta de Google Drive «Grinclic» (`G:\Mi unidad\Grinclic`):
- capturas de cada pantalla (subcarpeta DECLARACIONES);
- la matriz «Estructura de Base de Datos y Formulario - Módulo Declaraciones.xlsx»;
- las plantillas `plantilla_dec_cliente_directo`, `plantilla_dec_gestor`, `plantilla_suc_cliente_directo` y `plantilla_gen_gestor`;
- las exportaciones de líneas de servicio, unidades de negocio y disposiciones.

En la cuenta nueva hay que conectar Google Drive con acceso a esa carpeta.

## Pendientes generales

- Inventario con saldo por tratar y edición de catálogos: esperan las respuestas F1 y F2 (`docs/PREGUNTAS_GERENCIA.md`).
- Exportar e Informes (descargas en Excel) siguen de ejemplo.
- Certificados: ✅ modelo oficial de Terra Viva y constancia de RCD (Anexo II de la Res. 1257 de 2021) el 19-11-2026.
  Siguen pendientes los campos del Anexo VI del Decreto 0766 de 2026 y los códigos D/R (`docs/declaraciones/MODELO_DATOS.md` §9),
  y que la gerencia confirme los tres textos legales ajustados (quedaron «por revisar» en Ajustes).
- Portal de clientes (fase 3, paso 3 del orden de la gerencia): ✅ consulta y descarga el 19-11-2026, con doble barrera
  (API + RLS), enlace firmado de 5 minutos, usuarios del cliente (administrador y consulta, sedes opcionales) e informe
  anual en Excel. Con el visto bueno del usuario («Sí, sigue») el administrador del cliente también carga sus
  declaraciones (quedan en revisión), pide servicios (quedan «por confirmar») y cancela los que nadie ha confirmado.
- Verificación en dos pasos (requisitos de producción §4): ✅ el 19-11-2026. App de autenticación (TOTP) con códigos de
  respaldo; obligatoria para el personal en producción (o antes, con el interruptor de Ajustes › Empresa) y opcional
  en el portal; la restablece otro administrador. 85 pruebas de reglas y 376 e2e OK.
- Respuestas de la gerencia del 19-11-2026 (tarde), hechas el mismo día:
  - ✅ cola de trabajos: el ZIP de certificados y los Excel se preparan aparte y «Descargas» avisa;
  - ✅ enlaces firmados de 5 minutos para todo archivo guardado (almacén local o S3 / R2 / MinIO);
  - ✅ representante legal obligatorio en los clientes;
  - ✅ certificados sujetos al pago: con una factura vencida y sin pagar el cliente lo ve en el portal, pero lo
    descarga al pagar o cuando la oficina lo libera (días de gracia en Ajustes).

  88 pruebas de reglas y 390 e2e OK.
- ✅ Licencias de los gestores aliados verificadas contra el Drive (carpetas «uso común» y «uso no común»), con cinco
  tratamientos nuevos de aliados (TAR, BIOA, AUT, AUS, ESC). Los textos legales del certificado se apoyan en los permisos
  registrados (`{permiso:COD}`, `{permisos}`), y desde Permisos se registra un aliado nuevo o una licencia propia nueva
  con su PDF. Teléfono y correo de la planta: solo en la base (el repositorio es público). 88 pruebas de reglas y 396 e2e.
- Fase 2b (pedido de la gerencia del 19-11-2026), hecha el mismo día:
  - ✅ almacenamiento en Cloudflare R2 (`ALMACENAMIENTO=s3` con los nombres `R2_*`; las claves solo en `apps/api/.env`):
    fotos y firma de la inspección del vehículo, firmas, licencias y PDF se suben al bucket privado y la base guarda su
    clave; se descargan con enlace firmado de 5 minutos. Las pruebas automáticas usan el almacén local;
  - ✅ gestores aliados: activos solo los de la gerencia (Veolia —Las Bateas y San Silvestre—, Conyser, Sandesol, Social
    RAEE, Colbitumen —antes Humberto Quintero, mismo NIT—, Geoambiental, Vectors and Waste, Recitrac, Urbaser —Descont— y
    EMAS de Veolia). Los demás quedan inactivos con su licencia: no cubren ni se ofrecen como destino de servicios nuevos,
    y se reactivan en Permisos. Sin licencia registrada todavía: Recitrac, Geoambiental y Vectors and Waste (a este le falta
    además el NIT; el dígito de verificación de Geoambiental es calculado);
  - ✅ clientes: se inactivan con su motivo (pagos pendientes, entregas no autorizadas u otra eventualidad, con nota
    interna). En el portal ven un aviso amable: consultan y descargan, pero no piden servicios ni cargan declaraciones.
    El sector sale de una lista (Hidrocarburos, Doméstico, Industrial, Agrícola, Minero, Alimenticio y otros);
  - ✅ certificado comercial (modelo PD-GG-F-01, dinámico): el cliente lo descarga en el portal y la oficina en la ficha.
    Consecutivo propio CC-AAAA-0001, uno por cliente y día, PDF en R2 con QR. La frase de cumplimiento solo sale sin
    facturas vencidas, y ya no dice que Los Pinos trata peligrosos, suelos contaminados o borras (Res. 000632, art. 6).
  88 pruebas de reglas y 418 e2e OK.
- Siigo Nube (pedido de la gerencia del 19-11-2026), hecho el mismo día, solo lectura:
  - ✅ sincronización diaria (6:00 a. m.) y botón «Sincronizar con Siigo»: trae las facturas de venta y las notas crédito,
    las cruza con los manifiestos por el número que citan sus observaciones («manifiesto 1830») y el NIT del cliente, o
    por el número registrado en la conciliación, y deja en cada manifiesto «facturado» y el estado de pago (pendiente,
    pagado o sin cobro). Una nota crédito por el total anula la factura;
  - ✅ regla del certificado por cliente: «Exigir factura», «Exigir pago», «Libre» y la regla amable de antes (retener en
    el portal si hay una factura vencida), que es la de siempre. La base la aplica al emitir y al descargar (oficina,
    ZIP y portal); facturación libera un certificado o marca un manifiesto sin cobro, con su motivo;
  - ✅ solo Comercial, Facturación y Gerencia ven facturas, pagos, la regla y la alerta de manifiestos sin facturar
    (permisos `finanzas.ver` y `finanzas.gestionar`); el portal y la app de campo no leen esas tablas (RLS).
  88 pruebas de reglas y 436 e2e OK (con un Siigo simulado: las pruebas nunca tocan la cuenta real).
- Seguridad y avisos (19-11-2026):
  - ✅ correo diario de alertas por rol (hora en Ajustes; si no hay alertas, no llega nada);
  - ✅ avisos de errores del servidor al administrador (a lo sumo uno por hora por error) y registro en la base;
  - ✅ cada ingreso fallido queda en la auditoría; alertas de seguridad para el administrador: picos de ingresos
    fallidos, cuentas bloqueadas, descargas masivas y errores;
  - decisión: la separación por empresa en la base para el personal queda para cuando haya más de una empresa (hoy el
    API filtra cada consulta por empresa y las pruebas lo verifican).
  88 pruebas de reglas y 441 e2e OK.
- GPS de la flota con Wialon (19-11-2026), solo lectura con un token que va únicamente en el `.env` del API:
  - ✅ posición en vivo de cada vehículo (cada 30 a 60 s) en el mapa de Seguimiento y en el detalle de la ruta;
  - ✅ placa ↔ unidad: se enlaza sola si el nombre de la unidad trae la placa; si no, se elige en Flota;
  - ✅ salida y llegada a la planta (ubicada en Ajustes) y llegada, salida y tiempo en sitio de cada parada (ubicación de
    la sede en Clientes), por geocerca;
  - ✅ recorrido real y kilómetros de cada ruta, guardados como evidencia (solo en las etapas con rastreo);
  - ✅ alertas a Logística: paradas no programadas con RESPEL (15 min, ajustable) y desvíos (más de 5 km del trayecto,
    ajustable); quedan como evidencia, no se borran y se revisan con una explicación;
  - ✅ si Wialon falla, la operación sigue y hay alerta; al volver se pone al día solo;
  - el token real quedó el 20-11-2026 solo en el `.env` del API (la cuenta entra por hosting.wialon.us: la API es
    `hst-api.wialon.us`); 14 unidades. Con varias unidades de la misma placa (los equipos viejos 2G siguen en la cuenta)
    se enlaza la única que reportó en los últimos 30 días;
  - falta: ubicar la planta en Ajustes (lo hará la gerencia) y las sedes que no tengan coordenadas.
  98 pruebas de reglas y 460 e2e OK (con un Wialon simulado: las pruebas nunca tocan una cuenta real).
- Módulo Comercial (20-11-2026), reemplaza a Bigin:
  - ✅ prospectos con sus contactos, oportunidades por etapas (embudo), actividades y tareas con fecha;
  - ✅ cotizaciones en PDF con número (COT-AAAA-NNNN) y código QR de verificación; enviada, ya no cambia;
  - ✅ ganar una oportunidad crea el cliente con su sede principal y sus declaraciones con la tarifa cotizada (los
    residuos quedan en borrador hasta completar su caracterización);
  - ✅ formulario del sitio web: crea el prospecto y la tarea de responder, y avisa por correo a Comercial;
  - ✅ importación de los CSV de Bigin (empresas, contactos y negocios) con vista previa y sin duplicar;
  - ✅ alertas: solicitudes web por responder, tareas vencidas y cotizaciones sin respuesta;
  - falta: exportar de Bigin los CSV reales e importarlos, y poner el formulario en el sitio web (ver docs/DESPLIEGUE.md).
  111 pruebas de reglas y 474 e2e OK.
- Terry-App · Gestión de Residuos (20-11-2026), pedido de la gerencia:
  - marca del ecosistema: «Terry-App» con el módulo debajo, el logo de Terra Viva y Terry. Ingreso en pantalla dividida
    igual al de Terry-App Mantenimiento, con el carrusel en `public/carrusel/carrusel.json` (se cambia sin código). Paleta
    y letras del manual de identidad: #1F5E3B, #7BC043, #1F4E5F, #D2FFAE; Montserrat y Open Sans;
  - tablero de inicio al estilo de Wialon: paneles con números grandes, anillos, toneladas por mes y accesos rápidos
    (ICONTEC, PESV, MinAmbiente · IDEAM, Seguros) que se cambian en Ajustes;
  - Súper Informe: el único informe de auditoría. Un Excel para licencias 0632 y 0235, PDC, ICONTEC, MinAmbiente / IDEAM
    y PESV. Su hoja «Informe general V2» repite el consolidado de Residuos más reciente (informe de AVSA, enero a 18 de
    noviembre de 2026); el PDC sigue el formato PDC-RE-F-01;
  - avisos push en el celular y el computador (solicitudes nuevas, manifiestos por firmar, inspecciones de la flota y
    alertas del día), con permiso al entrar;
  - correo en pausa: se conecta con SMTP_HOST, SMTP_USER y SMTP_PASS (Gmail con contraseña de aplicación) sin tocar
    código; mientras tanto, las invitaciones vuelven al administrador como enlace para WhatsApp.
  111 pruebas de reglas y 481 e2e OK.
- Publicación (20-11-2026, decisión de la gerencia): todo en la cuenta de Cloudflare de Terra Viva (plan Workers Paid),
  dominio `terravivasas.net` con el DNS en Hostinger. TERRY-GO queda en `residuos.terravivasas.net`:
  - las pantallas en Pages (`terra-residuos`); `/api` pasa al Worker `terra-residuos-api`;
  - ese Worker enciende el servidor de siempre en un contenedor de Cloudflare, siempre encendido y cerca de la base;
  - la base en Neon (PostgreSQL, Virginia), porque D1 no sirve;
  - GitHub publica solo cuando las pruebas pasan en `main`.
  Pasos en docs/DESPLIEGUE.md. `mantenimiento.terravivasas.net` es de otra aplicación (TV Mantenimiento), no de TERRY-GO.
- Licencia propia de celda de seguridad, autoclave y biorremediación (lista antes de febrero de 2027; Exp. CAS
  210.40.00113.2026): ese día se registra en Permisos con su PDF y se ajusta la regla de la base que hoy impide recibir
  peligrosos en Los Pinos (`fn_item_peligroso_destino`), según lo que autorice.
- Docker no se probó en el entorno de Claude: el usuario lo levanta en su equipo.
