# Arquitectura — TERRY-GO (plataforma de Terra Viva)

## 1. Cadena de trazabilidad (núcleo del sistema)

```
Cliente → Sede → Declaración (+Tarifa) → Solicitud → Parada del recorrido
       → Manifiesto → Recepción y pesaje (PSA Los Pinos) → Certificado → Factura
```

Cada eslabón referencia al anterior. Si un registro rompe la cadena se pierde el soporte del
certificado ante la CAS o el cliente.

## 2. Stack

| Capa | Tecnología | Estado |
|---|---|---|
| Web + app del conductor | React 18 + Vite 6 + TypeScript + Tailwind 3 | Hecho (modo demostración y modo servidor) |
| API | NestJS 11 + Prisma 6 (monolito modular) | **Hecho — fase 1** |
| Base de datos | PostgreSQL 16 (imagen con PostGIS) | 64 tablas, 15 migraciones, reglas de toda la cadena en la base (ver `docs/operacion/MODELO_OPERACION.md`) |
| Reglas compartidas | `packages/shared` (validaciones e importación de Excel y CSV) | Hecho |
| Correo | Nodemailer (SMTP); sin SMTP escribe en la consola | Hecho |
| Usuarios | `GET/POST usuarios`, `PATCH usuarios/:id`, `POST usuarios/:id/invitacion`, `GET roles` (solo administración) | Nadie escribe contraseñas: el usuario nuevo recibe una invitación de 72 horas para crear la suya; nada se borra: inactivar cierra sus sesiones al instante; nadie se inactiva ni se cambia el rol a sí mismo; desbloquear tras intentos fallidos; matriz de permisos por rol |
| Archivos | Carpeta local (desarrollo) o S3 / Cloudflare R2 / MinIO (`ALMACENAMIENTO=s3`): fotos, firmas, PDF y lo que prepara la cola | Hecho (enlaces firmados de 5 minutos) |
| PDF | Gotenberg (HTML → PDF) | Fase 2 |
| Integraciones | Factura electrónica DIAN, RNDC | Fase 3 |

## 3. API (`apps/api`, prefijo `/api/v1`)

| Módulo | Rutas | Reglas |
|---|---|---|
| Auth | `POST auth/login · renovar · salir · salir-todos · aceptar-datos · recuperar · restablecer`, `GET auth/yo`; verificación en dos pasos: `POST auth/2fa/verificar · iniciar · confirmar · codigos · desactivar` y `POST usuarios/:id/2fa/restablecer` | argon2id; token de acceso 15 min; token de renovación rotativo (reuso ⇒ cierra todas las sesiones); bloqueo 15 min tras 5 intentos; respuestas que no revelan si un correo existe; aviso por correo de ingreso desde un equipo nuevo; Ley 1581: sin aceptar la versión vigente de la política de datos, el API responde 403 `ACEPTAR_DATOS` (fecha, IP y versión quedan registradas). Verificación en dos pasos (TOTP, RFC 6238): con ella activa, el login entrega un desafío de 5 minutos y la sesión sale de `2fa/verificar` con el código de la app o uno de respaldo; cada código sirve una vez (último paso usado en la base); clave cifrada con AES-256-GCM y códigos de respaldo como huella sha256 (claves derivadas de `CLAVE_2FA`). Obligatoria para el personal en producción o si `empresa.configuracion.dobleFactorObligatorio`: sin configurarla, el token lleva `c2f` y el API responde 403 `CONFIGURAR_2FA` salvo en las rutas `@SinDobleFactor()` |
| Clientes | `GET/POST clientes` (búsqueda, tipo, estado), `GET/PATCH clientes/:id`, `POST clientes/:id/sucursales`, `PATCH clientes/:id/sucursales/:sid`, `GET clientes/asesores · sectores`, `GET municipios?q=` | DV del NIT calculado (DIAN); el NIT no cambia; nada se borra: inactivar un cliente inactiva sus declaraciones (con motivo) e inactivar una sede, sus vínculos (no se le programan servicios); una sola sede principal; municipios de la DIVIPOLA completa (1.122, sin tildes ni mayúsculas) |
| Declaraciones | `GET/POST declaraciones` (filtros también por línea, negociación y forma de pago; precio vigente y programado), `GET declaraciones/ids` (seleccionar las filtradas, hasta 2.000), `PUT declaraciones/:id`, `GET declaraciones/catalogos`, `GET declaraciones/cobertura`, `PATCH :id/estado`, `PATCH :id/activa`, `POST tarifas/masivas`, `POST asignacion-masiva` | Una declaración por residuo y cliente, con N sedes y N disposiciones. No autoriza si alguna disposición no está cubierta por permiso de la CAS, licencia vigente del gestor aliado u objeto social (regla también en la base); peligroso exige FDS; tarifas con vigencias. Ver `docs/declaraciones/MODELO_DATOS.md` |
| Logística | `solicitudes` (+ `:id/aprobacion`, `:id/estado`, `items/:id/descartar`), `rutas` (código automático R-AAAAMMDD-NN), `PATCH rutas/:id`, `rutas/:id/items`, `rutas/:id/rastreo`, `programacion/pendientes`, `PATCH rutas/:id/estado`, `preoperacionales`, `GET inspecciones` (oficina: rango, vehículo y resultado) y `GET inspecciones/:id`, `PATCH paradas/:id` | Solo residuos autorizados (trigger); la ruta no inicia sin inspección aprobada (trigger); cancelar siempre se permite |
| Cumplimiento | `permisos-ambientales` (obligaciones con su último cumplimiento), `POST permisos-ambientales` (permiso o licencia propia nueva, con los tratamientos que ampara), `PATCH permisos-ambientales/:id` (vigencia, estado, documento), `POST/GET permisos-ambientales/:id/documento` (PDF del acto: subir y verlo con enlace firmado), `GET/POST obligaciones/:id/cumplimientos` (historial con radicado y soporte, que no se borra), `GET/POST/PATCH gestores-aliados` (licencia, vigencia o indefinida, exclusiones y los tratamientos que hace), `POST/GET gestores-aliados/:id/licencia` (PDF de la licencia), `alertas`, `catalogos`, `GET/POST vehiculos`, `PATCH vehiculos/:id` (vencimientos; se inactiva, no se borra), `personal`, `zonas`, `estados-recorrido`, `elementos-chequeo`, `salud` | Alertas de obligaciones, SOAT/RTM/póliza, licencias y curso MP, rutas sin inspección |
| Importación | `GET importacion/plantillas[/:id/archivo[?formato=csv]]`, `POST importacion/:id/vista-previa · confirmar` (Excel o CSV; campo opcional `delimitador`), `GET historial`, `GET importacion/cargues/:id/reversion`, `POST importacion/cargues/:id/revertir` | Revalida todo en servidor; guarda en una transacción; registra el cargue con su formato y separador. Deshacer un cargue de declaraciones las deja ANULADAS (nada se borra) si ninguna está en uso; lo hace quien lo cargó (sin autorizadas) o quien tenga `importacion.revertir` |
| Manifiestos | `manifiestos`, `desde-ruta`, `:id/items`, `:id/evidencias`, `:id/grabar`, `:id/anular`, `:id/pdf`, `:id/recibo` (80 mm) | Firma táctil, báscula, ARL/EPS de terceros; al grabar abre la conciliación (regla en la base) |
| Conciliaciones | `conciliaciones`, `consolidado`, `:id/items`, `:id/igualar · aprobar · reabrir`, `POST :id/excel` (cola de trabajos) | Totales por unidad (shared); ±2 % con justificación; aprobada solo cambia factura/pago |
| Actas | Los textos legales se apoyan en los permisos registrados: `{permiso:COD}` es el acto propio vigente del tratamiento COD y `{permisos}`, todo lo que ampara el certificado (una renovación o una licencia nueva sale sola). `actas`, `pendientes`, `:id/emitir`, `cargar`, `POST :id/enlace` (enlace firmado del PDF; `GET :id/pdf` redirige a él), `POST zip` (cola de trabajos), `POST :id/liberar-descarga` (`conciliaciones.gestionar`), `PATCH lineas/:id/certificado-aliado`, `verificar/:código` (pública; el QR abre `<web>/#verificar/<código>`) | Solo líneas aprobadas; soporte legal a la fecha del servicio; PDF con el modelo oficial de Terra Viva y QR (pdfkit); constancia de RCD del Anexo II de la Res. 1257 de 2021 cuando hay RCD (exige el representante legal del cliente). Cartera: con una factura vencida y sin pagar (más los días de gracia de Ajustes), el certificado se ve en el portal pero no se descarga (403 `PENDIENTE_PAGO`, mensaje amable) hasta que se pague o la oficina lo libere |
| Informes | `informes/inicio` (cadena del mes, operación de hoy, agenda, obligaciones; cifras de dinero solo con «informes.ver»), `informes/indicadores` (toneladas, facturado, comprado y servicios por mes; por cliente, destino, tratamiento, vehículo y conductor; inspecciones y diferencia de báscula), `informes/recepcion-planta` (lo que entró a Los Pinos por tratamiento), `informes/rutas/rendimiento`, `informes/rutas/costos`, `POST informes/rutas/costos/excel` (cola de trabajos) | Sobre las conciliaciones no anuladas; toneladas solo de líneas en masa (factor a kg); lo facturado coincide con el consolidado de conciliaciones; fletes en Excel |
| Empresa | `empresa`, `PATCH empresa/configuracion`, `PATCH empresa/consecutivos/:documento`, `empresa/textos-legales` (versiones) | Numeración TV/PSAP (el último número solo sube); textos legales con versión que salen según la disposición |
| Archivos | `GET archivos/enlace?clave=` (enlace firmado de 5 minutos), `GET archivos?clave=` (redirige al enlace), `GET archivos/d/:token` (público: el token es la autorización; solo almacén local) | Carpeta local por empresa o S3 / R2 / MinIO; tipo real validado al subir; en S3 el archivo no pasa por el API |
| Cola de trabajos | `GET trabajos` («Mis descargas»), `GET trabajos/:id`, `POST trabajos/:id/enlace` | ZIP y Excel se preparan aparte: la petición responde 202 y cada copia del API toma un trabajo con `FOR UPDATE SKIP LOCKED`; se reintenta hasta 3 veces lo inesperado (no la validación ni los permisos), se vuelve a exigir el permiso al preparar y el archivo preparado vence a los 7 días (`TRABAJOS_DIAS`). `TRABAJOS_PROCESAR=false` deja una copia del API sin preparar |
| Portal de clientes | Solo usuarios de un cliente: `GET portal/yo · resumen · declaraciones[/:id] · solicitudes · manifiestos · certificados · informe?anio=`, `POST portal/manifiestos/:id/enlace · certificados/:id/enlace`, `POST portal/declaraciones/cargue/:plantilla/vista-previa · confirmar`, `GET portal/solicitudes/opciones`, `POST portal/solicitudes`, `POST portal/solicitudes/:id/cancelar`, `GET/POST portal/usuarios`, `PATCH portal/usuarios/:id`, `POST portal/usuarios/:id/invitacion · 2fa/restablecer`. Oficina: `GET/POST clientes/:id/usuarios-portal`, `PATCH …/:uid`, `POST …/:uid/invitacion · …/:uid/2fa/restablecer` (`clientes.editar`). Pública: `GET descargas/:token` | Ver «Portal de clientes» abajo |

Detalle de la cadena operativa: `docs/operacion/MODELO_OPERACION.md`.

Transversal: guard global (toda ruta exige token salvo `@Publico()`), permisos por rol con `@Permiso()`,
**aislamiento por empresa** en cada consulta (`empresa_id` del token), auditoría de cada cambio,
Helmet, CORS solo para la web y errores en español (los RAISE de la base se traducen a 409 con el mensaje de la regla).

La auditoría guarda la IP y el navegador de cada petición. Nadie la modifica ni la borra: un trigger lo impide incluso
escribiendo directo en la base. Las exportaciones a Excel y las descargas en bloque exigen el permiso `exportar.masivo`
y quedan registradas.

**Límite de peticiones.** Con sesión válida cuenta **por usuario**: en la oficina todos salen a internet por la misma
IP pública, y un límite por IP los bloquearía a todos. Sin sesión cuenta por IP. Es de `LIMITE_PETICIONES_MIN` (300)
por minuto en cada ruta. En ingreso, recuperar y restablecer la contraseña hay dos límites:
- 10 o 5 intentos por minuto para cada correo desde una IP;
- un techo por IP para todos los correos juntos, `LIMITE_INGRESOS_IP_MIN` (60), contra el rociado de contraseñas.

Roles iniciales: Administrador, Logística, HSEQ, Comercial, Facturación, Conductor, Auxiliar y Cliente (portal).

**Portal de clientes (requisitos de producción §2).** Un usuario del portal está ligado a un cliente (`usuarios.cliente_id`),
con perfil **Administrador** (además carga sus declaraciones, pide y cancela servicios, e invita y gestiona a los de su
empresa) o **Consulta** (solo consulta y descarga), y opcionalmente limitado a algunas sedes (`usuario_sucursales`).
Consulta, descarga y escribe solo lo suyo, con doble barrera:
1. **API.** El token lleva el cliente y el perfil. El guard global le responde 403 (`codigo: PORTAL`) en toda ruta que no
   sea del portal, y el personal de Terra Viva recibe 403 en las del portal. Cada consulta filtra por el cliente del token
   (nunca por un id que mande el navegador) y por sus sedes; un documento de otro cliente responde 404.
2. **Base de datos (RLS).** Las consultas del portal corren en una transacción con `app.cliente_id`; las políticas
   `rls_portal_cliente` (clientes, sedes, declaraciones, solicitudes, manifiestos, conciliaciones, actas, cargues,
   usuarios y sus tablas hijas, con FORCE) solo dejan ver y escribir las filas de ese cliente, aunque el API tuviera
   un error. Sin `app.cliente_id` (personal de Terra Viva) todo se ve como antes. PostgreSQL no aplica la RLS a un
   superusuario ni a un usuario con BYPASSRLS: el API debe conectarse con un usuario sin esos privilegios (en producción
   no arranca si no, y las pruebas automáticas lo verifican). FORCE hace que aplique también al dueño de las tablas.
   Además, políticas RESTRICTIVE (migración `20261127000000_portal_escritura`) limitan qué escribe una sesión del
   portal: declaraciones solo nuevas y en revisión (sin tarifas), solicitudes solo «por confirmar» y su cancelación
   mientras nadie las confirme, cargues solo de declaraciones, usuarios solo de su empresa; nada más (clientes, sedes,
   manifiestos, conciliaciones, actas).

**Lo que escribe el cliente (perfil Administrador).**
- **Cargar sus declaraciones** con la misma plantilla de la oficina, sin NIT (es el de su empresa) ni precio (lo fija
  Terra Viva), y las mismas validaciones. Solo en sus sedes; quien ve algunas sedes no usa TODAS ni PRINCIPAL. Revisar no
  guarda; confirmar exige aceptar la declaración de responsabilidad del generador. Todo queda PENDIENTE para que Terra
  Viva fije la tarifa y lo autorice; el cargue queda con su cliente y se deshace desde la oficina.
- **Pedir un servicio** en una de sus sedes, con lo autorizado y activo allí, la fecha (de hoy a un año), la cantidad
  aproximada y la jornada. Queda «por confirmar», con la tarifa vigente a esa fecha; la oficina lo ve marcado como
  pedido del portal.
- **Cancelar** un pedido que nadie ha confirmado ni programado, con el motivo: la base descarta sus líneas.

Las descargas usan un **enlace firmado de 5 minutos** (`/descargas/<token>`, clave propia distinta de la de las
sesiones), que el API entrega solo después de verificar que el documento es del cliente y de sus sedes; al servirlo
vuelve a verificar con RLS y deja la descarga en la auditoría. Un administrador limitado a unas sedes solo ve y gestiona
usuarios de esas mismas sedes: no puede dar (ni darse con otro correo) más acceso del que tiene. La oficina da el primer
acceso desde la ficha del cliente. Las pruebas automáticas (e2e y de reglas) verifican que un cliente reciba 403 o 404
en cada listado, detalle, descarga, filtro e informe de otro.

## 4. Base de datos (`packages/db`)

- `prisma/schema.prisma` + `prisma/migrations/` (inicial y reglas de negocio).
- Reglas en la base: tolerancia de báscula ±2 % con explicación obligatoria (CHECK), ruta sin
  inspección aprobada no inicia (trigger), ítem de solicitud solo con declaración autorizada (trigger).
- `prisma/seed.mjs`: idempotente. Empresa (NIT 901.089.780-8), roles, permisos ambientales de la CAS
  (con sus obligaciones reales, código OB-xx), gestores aliados, textos legales, catálogos, zonas, etapas, elementos de inspección,
  flota y usuario administrador.

## 5. Web (`apps/web`)

- `lib/api.ts`: cliente HTTP con renovación automática del token. `VITE_API_URL` activa el modo servidor.
- Conectado al servidor: ingreso, recuperar/restablecer contraseña, Inicio, Clientes y sedes, Declaraciones, Tarifas,
  Importar datos, alertas, la app del conductor (`pages/CampoServidor.tsx`), la torre de control (`pages/torre/`:
  Solicitudes, Por confirmar, Programación, Seguimiento, Manifiestos, Conciliación y Certificados), Inspecciones, Flota,
  Permisos y gestores aliados, Inventario (recepción en Los Pinos), Indicadores, Usuarios y roles, Catálogos, Etapas y
  Datos de la empresa. La página pública `#verificar/<código>` no pide sesión. Siguen de ejemplo Exportar e Informes
  (descargas), con el aviso de «datos de ejemplo» en modo servidor.
- Navegación lateral por procesos (Comercial, Logística, Campo y HSEQ, Planta, Cumplimiento, Análisis,
  Ajustes) y buscador con Ctrl + K.
- Portal de clientes (`pages/portal/`, rutas `#portal…`): inicio con su resumen y próximos servicios, declaraciones,
  solicitudes, manifiestos (cargado en la sede y pesado en planta), certificados con su verificación pública, informe
  del año por residuo y por mes (Excel) y usuarios (solo el administrador del cliente). El administrador también carga
  declaraciones (`pages/portal/Escritura.tsx`: plantilla, revisión fila por fila y aceptación de responsabilidad), pide
  servicios y cancela los que nadie ha confirmado. Un usuario del portal no ve la oficina, y la oficina no entra al portal.
- Móvil: tablas que se vuelven tarjetas, filtros en hoja inferior, calendario que pasa a agenda,
  app del conductor con botones grandes.

## 6. Fases

| Fase | Alcance | Estado |
|---|---|---|
| 0 | Esquema, prototipo, importación de Excel | ✅ |
| 1 | API con autenticación, declaraciones, logística, cumplimiento, importación; web conectada en ingreso, declaraciones e importación | ✅ |
| 1b / 3 | Núcleo operativo: modelo y reglas (3-A), API (3-B), app del conductor sin señal (3-C) y torre de control (3-D) | ✅ |
| 1c | Conectar a la API lo que aún era de ejemplo: clientes, tarifas, permisos, inspecciones, flota, usuarios, inicio, indicadores, inventario (entradas) y catálogos | ✅ (falta el saldo de inventario y editar catálogos: preguntas F1 y F2) |
| 2 | PDF de manifiestos y certificados, fotos y firmas en S3, tarea diaria de alertas por correo | |
| 3 | Portal de clientes: consulta y descarga con doble barrera (API + RLS), usuarios del cliente, informe anual, cargue de sus declaraciones y pedidos de servicio | ✅ |
| 3+ | Factura electrónica DIAN, RNDC | |
