# Revisión: requisitos de producción frente a lo construido

Revisión del 19-11-2026 de `docs/REQUISITOS_PRODUCCION.md` contra la rama `fase-3-operacion`. Para cada requisito dice si
**ya se cumple (✅)**, **se cumple en parte (⚠️)** o **falta (❌)**, y cómo se ajusta. Al final está el orden propuesto.

> **Actualización del 19-11-2026:** ya están hechos los ajustes 1, 4, 5, 6 (verificación en dos pasos), 7, 8 (portal de
> clientes con RLS) y 9 de la lista de abajo, más el cierre de sesión en todos los dispositivos, el aviso de ingreso
> nuevo y el límite de peticiones por usuario. Detalle y pendientes en la sección 9.

## Resumen para la gerencia

**Lo que ya está bien hecho:**
- El API no guarda estado: la sesión viaja en un token firmado, así que se pueden correr varias copias.
- Las URL usan identificadores UUID, no consecutivos adivinables.
- Contraseñas argon2id, bloqueo por intentos y recuperación con token de un solo uso.
- Permisos por rol y aislamiento entre empresas, con pruebas automáticas.
- Auditoría de cambios.
- Los manifiestos y certificados emitidos se anulan con causa, nunca se borran.
- QR de verificación pública.
- Reglas del negocio en la base de datos, que no se saltan ni con cargue masivo.

**Lo que hay que ajustar antes de cargar datos reales:**
1. **Listados para 2.000 clientes.** Hoy algunas pantallas cargan hasta 500 clientes en una lista: deben pasar a
   buscadores y páginas.
2. **Descargas.** Deben salir del almacenamiento con enlace firmado de 5 minutos, no a través del API.
3. **Trabajos pesados en cola:** ZIP, Excel e informes.
4. **Nada legal se borra:** hay dos borrados automáticos al anular un manifiesto que deben ser anulaciones.
5. **Auditoría con IP, ingresos y exportaciones.**
6. **Doble factor (2FA)** para el personal interno.
7. **Aceptación de la política de datos** en el primer ingreso (Ley 1581).
8. **Rol de cliente y barrera en la base (RLS)** para el portal de clientes.
9. **Pruebas automáticas en GitHub** con cada cambio.

**Lo que necesita decisión o contratación de la gerencia** (no se puede hacer solo con código):
- Nube administrada.
- Cloudflare.
- Copias en otra región.
- Monitoreo (Sentry o similar).
- Prueba de penetración.
- Llaves de Siigo y Wialon.
- Textos de la política de datos.
- Proteger la rama `main` y exigir 2FA en GitHub: lo hace el dueño de la cuenta.

## 1. Alcance y escala

| Requisito | Estado | Ajuste |
|---|---|---|
| API sin estado, varias copias detrás de un balanceador | ⚠️ El token es sin estado. Pero el límite de peticiones vive en la memoria de cada copia, y los archivos en el disco del servidor | Límite de peticiones en un almacén compartido (Redis); archivos en S3 |
| Índices y paginación en todos los listados | ⚠️ El API pagina (máximo 500 por página), pero varias pantallas piden 200 a 500 registros de una vez y los selectores de cliente cargan los primeros 500. El consolidado de conciliaciones suma en memoria hasta 5.000 | Buscador de clientes con autocompletar; bandejas con «cargar más»; consolidado sumado en la base |
| PDF y reportes pesados en cola | ❌ El PDF del acta, el ZIP de actas y los Excel se generan durante la petición | Cola de trabajos en PostgreSQL (no exige Redis). El usuario recibe aviso y enlace cuando está listo |
| Archivos con URL firmada, no a través del API | ❌ Fotos, firmas y PDF pasan por el API | Almacenamiento privado tipo S3. El API verifica el permiso y entrega un enlace firmado de 5 minutos. En desarrollo, el enlace firmado lo sirve el propio API |

## 2. Aislamiento de datos de clientes (crítico)

| Requisito | Estado | Ajuste |
|---|---|---|
| Rol `CLIENTE` ligado a un `cliente_id` (administrador del cliente y consulta; sedes opcionales) | ✅ Usuario del portal con `cliente_id`, perfil Administrador o Consulta y sedes opcionales. La oficina da el primer acceso desde la ficha del cliente y el administrador del cliente invita a los demás (un administrador limitado a unas sedes no da más acceso del que tiene) | — |
| Doble barrera: filtro en el API y RLS en la base | ✅ por cliente. API: el usuario del portal solo usa las rutas del portal y cada consulta filtra por el cliente del token y sus sedes. Base: RLS con `app.cliente_id` en cada transacción del portal (clientes, sedes, declaraciones, solicitudes, manifiestos, conciliaciones, actas, cargues, usuarios y sus tablas hijas, con FORCE) | Queda la RLS por empresa para el personal interno (hoy el API filtra la empresa en cada consulta, probado) |
| Pruebas: el cliente A recibe 403/404 en cada endpoint al pedir datos de B | ✅ e2e: el cliente B recibe 403 o 404 en el detalle, las descargas y los usuarios de A, y sus listados, filtros e informes no traen nada de A; el usuario del portal recibe 403 en las rutas de oficina; la RLS se prueba directo en la base (leer y escribir) | — |
| Descargas solo con URL firmada de corta vida; almacenamiento nunca público | ✅ en el portal: enlace firmado de 5 minutos, con clave propia, que se entrega después de verificar el permiso; en desarrollo lo sirve el API | Con S3 en producción, el enlace lo firma el almacenamiento (ver §1) |
| UUID en las URL; el consecutivo es solo un dato visible | ✅ | — |

## 3. Conservación e integridad

| Requisito | Estado | Ajuste |
|---|---|---|
| Retención de 10 años | ⚠️ Nada se depura, pero falta la política escrita y el almacenamiento con bloqueo | S3 con versionado y bloqueo de objeto (WORM) |
| Nada legal se borra; borrado lógico | ⚠️ Los documentos emitidos se anulan con causa, usuario y fecha. Pero al **anular un manifiesto la base borra su conciliación en borrador** y las solicitudes recurrentes que nadie ha tocado | Pasan a estado «anulada» y quedan en el historial. Los datos del módulo de declaraciones ya se conservan |
| Auditoría con quién, qué, cuándo **y desde qué IP** | ⚠️ Falta la IP. Tampoco registra ingresos ni exportaciones | Se agregan IP y navegador; se registran ingresos, descargas masivas y exportaciones |
| Hash SHA-256 de los PDF emitidos | ❌ | Se guarda al emitir el certificado (y al cargar el de un aliado) |
| QR público con **solo** número, fecha y validez | ⚠️ Muestra además tipo, periodo y emisor | Se deja solo lo pedido |
| Versionado y bloqueo (WORM) | ❌ (infraestructura) | S3 con *Object Lock* en modo cumplimiento |
| Copias 3-2-1, punto en el tiempo (PITR) de 7 días, RPO de 15 min, RTO de 4 h, restauración mensual | ❌ (infraestructura) | PostgreSQL administrado con PITR, volcado cifrado diario en otra región y guía de prueba mensual |

## 4. Seguridad (OWASP ASVS nivel 2)

| Requisito | Estado | Ajuste |
|---|---|---|
| argon2id, bloqueo por intentos, recuperación de un solo uso | ✅ | — |
| 2FA (TOTP) obligatorio para internos, opcional para clientes | ✅ TOTP (Google o Microsoft Authenticator, Authy) con 10 códigos de respaldo. Obligatorio para el personal en producción (y antes, si la empresa lo activa en Ajustes); opcional en el portal. Ver §9 | — |
| Sesiones revocables y cierre en todos los dispositivos | ✅ Ver §9 | — |
| Aviso por correo de ingreso nuevo | ✅ Ver §9 | — |
| Cloudflare, HSTS y base sin acceso público | ❌ (infraestructura) | En el despliegue |
| Permisos por rol | ✅ | — |
| Exportaciones solo para roles autorizados y registradas | ✅ Permiso propio y registro de cada exportación (§9) | — |
| Secretos en el gestor del proveedor | ⚠️ Hoy en `.env` local (bien para desarrollo) | En producción, gestor de secretos |
| Pull requests con pruebas en GitHub Actions, Dependabot, CodeQL | ✅ Flujos en `.github/` (§9) | — |
| Rama `main` protegida y 2FA en GitHub | ❌ | Lo configura el dueño de la cuenta en GitHub |
| Registro de errores, alertas y monitoreo | ❌ | Sentry opcional por variable de entorno; alertas por picos de ingresos fallidos, descargas masivas y errores 5xx |
| Prueba de penetración y prueba de carga (400 usuarios, p95 < 1 s) | ❌ | Guion k6 en el repositorio para correr en `staging`; la prueba de penetración la contrata la gerencia |

## 5. Datos personales (Ley 1581)

| Requisito | Estado | Ajuste |
|---|---|---|
| Autorización registrada en el primer ingreso | ❌ | Se registra fecha, IP y versión de la política aceptada; sin aceptarla no se entra |
| Política, aviso de privacidad, contrato de encargo y RNBD | ❌ (gerencia) | Los textos los da la gerencia; el sistema enlaza la versión vigente |
| Exportar o corregir los datos de un titular | ❌ | Exportación de los datos de un usuario o conductor desde Ajustes |

## 6. Infraestructura

Hoy hay `Dockerfile` y `docker-compose.yml`, suficientes para desarrollo y para una primera instalación.

**Propuesta para producción:**
- Dirección: `app.terravivasas.com`.
- Base de datos: PostgreSQL administrado con PITR, por ejemplo DigitalOcean Managed Databases o AWS RDS.
- API: contenedores (dos copias como mínimo) detrás de un balanceador.
- Archivos: almacenamiento S3 privado con bloqueo de objeto.
- Perímetro: Cloudflare delante.
- Ambientes: dos, `staging` y `produccion`.
- Despliegue automático desde GitHub, con vuelta a la versión anterior.

El sitio web sigue en Hostinger.

## 7. Integraciones

Siigo, Wialon, el módulo Comercial (en reemplazo de Bigin) y la salida de Grinclic van en sus fases (pasos 4 a 7).
Todas usarán una tabla de envíos pendientes (patrón *outbox*) con reintentos y registro de cada intercambio. Así,
si Siigo o Wialon fallan, la operación sigue.

## 8. Orden propuesto

1. **Terminar lo pedido de los documentos reales:**
   - recepción en planta;
   - numeración TV y PSAP;
   - certificado por generador con textos legales condicionados y hash.
2. **Ajustes de código de esta revisión**, todos en esta rama y con pruebas:
   - auditoría con IP y de exportaciones;
   - QR mínimo;
   - anular en vez de borrar;
   - buscador de clientes y listados paginados;
   - consolidado sumado en la base;
   - aceptación de la política de datos;
   - cierre en todos los dispositivos;
   - flujos de GitHub (pruebas, Dependabot, CodeQL);
   - guion de carga k6.
3. **Declaraciones, fases B y C:**
   - formulario de 8 secciones (hecho el 19-11-2026);
   - CSV;
   - cargue desde el portal (hecho el 19-11-2026);
   - reversión de lotes.
4. **Antes de cargar datos reales** (infraestructura y seguridad):
   - nube;
   - copias;
   - S3 con URL firmada;
   - cola de trabajos;
   - RLS (hecha para el portal de clientes el 19-11-2026; falta la de empresa para el personal);
   - 2FA (hecha el 19-11-2026);
   - monitoreo.
5. **Siguientes pasos:**
   - portal de clientes (hecho el 19-11-2026: consulta, descarga, cargue de declaraciones y pedidos);
   - Wialon;
   - Siigo;
   - módulo Comercial;
   - pruebas de penetración y de carga;
   - operación en paralelo y salida de Grinclic.

## 9. Lo aplicado (19-11-2026)

Pasos 1 y 2 del orden, hechos en la rama `fase-3-operacion` con pruebas: 145 de punta a punta y 46 de reglas de la
base.

| Requisito | Qué quedó |
|---|---|
| Listados para 2.000 clientes | Buscador de clientes con autocompletar en solicitudes, declaraciones, conciliación, certificados y asignación masiva. Bandejas de declaraciones, solicitudes, manifiestos, recepción, conciliación y certificados que cargan de 50 en 50 («Cargar más»). Probado con 2.000 clientes ficticios |
| Consolidado | Sumado en la base; antes se sumaba en memoria, hasta 5.000 registros |
| Nada legal se borra | Al anular un manifiesto, su conciliación queda «anulada» y las solicitudes automáticas, «retiradas». No se borra nada |
| Auditoría | IP y navegador en cada evento. Registra ingresos, aceptaciones de la política y exportaciones. Nadie la modifica ni la borra: lo impide un trigger en la base |
| Exportaciones | Permiso propio `exportar.masivo` y registro de cada exportación |
| Hash y QR | SHA-256 del PDF emitido o cargado. El QR público muestra solo número, fecha, emisor y validez |
| Sesiones | «Cerrar sesión en todos los dispositivos» en el menú de la cuenta. Correo de aviso al ingresar desde un equipo o IP nuevos |
| Ley 1581 | Pantalla de aceptación en el primer ingreso y cada vez que cambia la versión. Queda registrada la fecha, la IP y la versión. Sin aceptar, el API no deja hacer nada más |
| Verificación en dos pasos | Código de 6 dígitos de una app de autenticación (TOTP, cada 30 segundos) además de la contraseña. Se activa leyendo un código QR y entrega 10 códigos de respaldo de un solo uso (para cuando no se tiene el celular). Cada código sirve una sola vez; cinco errados bloquean la cuenta 15 minutos. La clave se guarda cifrada (AES-256-GCM) y los códigos de respaldo, solo como huella. **Obligatoria para el personal** en producción, y antes si la empresa lo activa en Ajustes › Empresa: mientras no la configure, el API solo le deja configurarla (403 `CONFIGURAR_2FA`). Opcional en el portal de clientes. Si alguien pierde el celular y los códigos, la restablece otro administrador (nadie la suya): se cierran sus sesiones y le llega un correo. En el portal la restablece el administrador del cliente o la oficina |
| Límite de peticiones | Ahora cuenta por usuario cuando hay sesión. Antes contaba por IP: con 300 por minuto, una oficina que sale a internet por una sola IP se habría bloqueado entera en hora pico. En el ingreso, 10 intentos por correo y un techo de 60 por IP. Todo es configurable |
| GitHub | Pruebas automáticas en cada cambio, CodeQL y Dependabot (`.github/`) |
| Prueba de carga | Guion k6 de 400 usuarios, con su guía (`apps/api/test/carga/LEAME.md`). Se corre en staging |
| Librerías | Actualizadas las que tenían arreglo compatible: NestJS 11.2.11 (arregla `multer`), nodemailer 10, Vite 6.4, PostCSS, esbuild, NestJS CLI y uuid. Hoy las librerías de producción no tienen vulnerabilidades críticas |

**Pendientes que salieron en este trabajo:**
- **zod 3 → 4.** Tiene un aviso alto: consumo de memoria al validar listas enormes. El riesgo está acotado, porque el
  API acepta cuerpos de máximo 1 MB y limita las peticiones. La migración toca todas las validaciones, así que va como
  tarea propia con sus pruebas.
- **Prisma 6 → 7.** Los avisos son de la herramienta de migraciones, que solo corre al desplegar y con archivos
  propios. Es un cambio mayor y va como tarea propia.
- **El repositorio de GitHub es público.** Cualquiera puede ver el código y los documentos. Revisado: no hay
  contraseñas ni datos personales. Aun así, la gerencia debe decidir si lo pasa a privado. Si lo hace:
  - CodeQL deja de ser gratis (exige la licencia «GitHub Code Security»);
  - las pruebas y Dependabot siguen funcionando.
- **PDF en cola y descargas con enlace firmado.** Siguen pendientes (paso 4 del orden). La prueba de carga dirá qué tan
  urgentes son.

La historia de cada fase está en `docs/CONTEXTO_PROYECTO.md`.
