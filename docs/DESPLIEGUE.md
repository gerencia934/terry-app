# Publicar TERRY-GO (producción)

Guía paso a paso para dejar TERRY-GO funcionando en internet con la cuenta de Cloudflare de Terra Viva (plan Workers
Paid). Los valores secretos (claves, tokens, conexiones) nunca van en este repositorio: viven solo en Cloudflare (claves
del Worker), en Neon o en el `.env` local.

## 1. Cómo queda

| Pieza | Dónde | Dirección |
|---|---|---|
| Pantallas (oficina, app del conductor y portal de clientes) | Cloudflare Pages, proyecto `terra-residuos` | `https://residuos.terravivasas.net` |
| Servidor (API) | Contenedor de Cloudflare (Workers Paid) con la imagen de siempre (`apps/api/Dockerfile`), controlado por el Worker `terra-residuos-api` | `https://residuos.terravivasas.net/api/v1` (la misma dirección) |
| Base de datos | Neon: PostgreSQL 16 administrado, región AWS US East (Virginia) | — |
| Archivos (PDF, fotos, firmas) | Cloudflare R2 (ya configurado) | — |
| Correo de salida | Un buzón con SMTP en `terravivasas.net` (Hostinger) | — |
| Publicación | GitHub Actions (`.github/workflows/publicar.yml`): cuando las pruebas pasan en `main` | — |

```
navegador ─► residuos.terravivasas.net   (CNAME en Hostinger → terra-residuos.pages.dev)
             Pages «terra-residuos»: pantallas + función /api/*
               └─ enlace de servicio ─► Worker «terra-residuos-api» (sin dirección pública)
                                          └─ Durable Object «principal» (oriente de Norteamérica)
                                               └─ contenedor con el API: 1 vCPU y 3 GiB
                                                    ├─ Neon (PostgreSQL, Virginia)
                                                    └─ R2, Siigo, Wialon y correo
```

- **Por qué Pages adelante:** el DNS de `terravivasas.net` sigue en Hostinger. Pages acepta un registro CNAME desde otro
  proveedor; un Worker solo, no (exige que el dominio esté en Cloudflare). Pages entrega las pantallas y pasa todo lo
  que empieza por `/api` al Worker del servidor. Pantallas y servidor quedan en la misma dirección.
- **Siempre encendido:** un aviso cada minuto (cron del Worker) mantiene el contenedor encendido. Así corren solas la
  consulta a Wialon, la sincronización con Siigo, el correo diario y la cola de trabajos. Si el contenedor se cae, el
  siguiente aviso o la siguiente petición lo vuelve a encender.
- **Cerca de la base:** el contenedor corre donde corre su Durable Object, que se crea en el oriente de Norteamérica, a
  pocos milisegundos de Neon (Virginia).
- **Versiones nuevas:** al publicar, o al cambiar una variable o clave del Worker, el contenedor anterior recibe la
  señal de apagado (SIGTERM), termina lo que está haciendo (hasta 60 s) y se enciende el nuevo. Durante ese momento las
  peticiones esperan. Conviene publicar fuera del horario de operación.
- **Por qué no D1:** es SQLite. Las reglas de TERRY-GO viven en PostgreSQL (disparadores, la barrera RLS del portal de
  clientes) y no funcionan en D1. Neon sí es PostgreSQL: funciona tal como está.

**Costo aproximado (precios de Cloudflare a noviembre de 2026):**
- plan Workers Paid: US$5 al mes;
- contenedor de 1 vCPU y 3 GiB encendido todo el mes: cerca de US$20. La memoria se cobra mientras está encendido; el
  procesador, solo cuando trabaja;
- Neon cobra por uso: con la base siempre activa, ver su calculadora;
- R2: centavos.

Todo queda dentro del presupuesto aprobado (hasta US$150 al mes).

## 2. Lo que hace la gerencia (cuentas a nombre de la empresa, con doble factor)

1. **Neon** (base de datos):
   - crear la cuenta y un proyecto `terry-go` con PostgreSQL 16 en la región **AWS US East (N. Virginia)**;
   - plan pago: el gratuito no guarda historial suficiente para volver a un punto en el tiempo con datos reales;
   - en **Connect**, copiar la conexión del dueño del proyecto (la directa, no la *pooled*) y entregarla;
   - cuando el desarrollo termine el paso 3.1, cambiar la clave del dueño en Neon (**Roles → Reset password**). Así la
     conexión entregada deja de servir.
2. **Cloudflare: la llave con la que GitHub publica.**
   - **My Profile → API Tokens → Create Token → Custom token** (o *Manage Account → Account API Tokens*). Nombre:
     `GitHub TERRY-GO`.
   - Permisos, todos de la cuenta (*Account*):
     - **Workers Scripts: Edit**;
     - **Containers: Edit**;
     - **Cloudflare Pages: Edit**;
     - **Account Settings: Read**.
   - *Account Resources*: solo la cuenta de Terra Viva. **Create Token** y copiar la llave: se muestra una sola vez.
   - En GitHub, repositorio `terry-app` → **Settings → Secrets and variables → Actions → New repository secret**:
     - `CLOUDFLARE_API_TOKEN`: la llave;
     - `CLOUDFLARE_ACCOUNT_ID`: el *Account ID*. Aparece en Cloudflare, en **Workers & Pages**, a la derecha.
3. **Las claves del servidor:** abrir una terminal en este computador, carpeta `despliegue/cloudflare`, ejecutar
   `npx wrangler login` y aprobar en el navegador. Con eso el desarrollo carga las claves (sección 3) directo en
   Cloudflare, desde el archivo privado del servidor. No pasan por el chat ni por GitHub.
   Otra opción: escribirlas a mano en **Workers & Pages → terra-residuos-api → Settings → Variables and Secrets** (tipo
   *Secret*).
4. **GitHub:** aprobar que la rama de trabajo se una a `main`. Desde ahí, cada vez que las pruebas pasan en `main`,
   GitHub publica solo. La primera vez crea el Worker, el contenedor y el proyecto de Pages `terra-residuos`.
5. **Dominio (después de la primera publicación).** El orden importa: primero Cloudflare, luego Hostinger.
   - Cloudflare: **Workers & Pages → terra-residuos → Custom domains → Set up a domain** → `residuos.terravivasas.net` →
     **Continue**.
   - Hostinger, DNS de `terravivasas.net`: registro **CNAME**, nombre `residuos`, destino `terra-residuos.pages.dev`.
   - En unos minutos Cloudflare emite el certificado y la dirección queda con candado.
6. **Correo de salida:** un buzón (por ejemplo `notificaciones@terravivasas.net`) con su servidor SMTP, usuario y clave.
   Sin él no llegan las invitaciones, la recuperación de contraseña ni las alertas.
7. **Política de tratamiento de datos (Ley 1581):** publicar el texto en una página (por ejemplo
   `https://terravivasas.net/politica-datos`) y fijar su versión (`1.0`). Sin ella el servidor no arranca en producción.

## 3. Lo que hace el desarrollo

1. **Base de datos.** Crear en Neon el usuario de la aplicación, **sin** permiso para saltarse la RLS, y su base. Se hace
   en el editor SQL de Neon, como dueño del proyecto:
   ```sql
   CREATE ROLE terraviva_app LOGIN PASSWORD '<clave larga y aleatoria>' NOBYPASSRLS;
   GRANT terraviva_app TO neondb_owner; -- el dueño del proyecto, con el nombre que muestre Neon
   CREATE DATABASE terrygo OWNER terraviva_app;
   ```
2. **Datos iniciales.** Con la conexión de `terraviva_app` (directa, con `?sslmode=require&connect_timeout=15`), correr
   `npm run db:migrate` y `npm run db:seed` con `SEED_ADMIN_EMAIL` (el correo de Gerencia) y `SEED_ADMIN_PASSWORD`.
   Así quedan los catálogos, los roles, las etapas y el usuario administrador. Después, el contenedor aplica solo las
   migraciones nuevas cada vez que arranca.
3. **Claves del Worker** `terra-residuos-api`: con `npx wrangler secret bulk`, desde `despliegue/cloudflare/api`.
   Cambiar una clave reinicia el contenedor solo. Lo que no es secreto ya está en
   `despliegue/cloudflare/api/wrangler.jsonc` («vars»).

   | Clave | Qué es |
   |---|---|
   | `DATABASE_URL` | Conexión de `terraviva_app` en Neon |
   | `JWT_SECRET` | Aleatoria, de 64 caracteres o más. No se cambia después: también cifra la verificación en dos pasos |
   | `POLITICA_DATOS_URL`, `POLITICA_DATOS_VERSION` | Ley 1581 |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Correo de salida |
   | `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Archivos |
   | `SIIGO_USERNAME`, `SIIGO_ACCESS_KEY`, `SIIGO_PARTNER_ID` | Siigo Nube |
   | `WIALON_TOKEN` | Wialon (solo lectura) |

4. **Publicar:** se une la rama a `main` (pruebas → publicación). Para volver a publicar sin cambios: GitHub → **Actions
   → Publicar → Run workflow**.
5. **Revisar:**
   - `https://terra-residuos.pages.dev/api/v1/salud` y luego `https://residuos.terravivasas.net/api/v1/salud`. La
     respuesta trae `latenciaMs`, el tiempo hasta la base, que debe ser de pocos milisegundos;
   - el ingreso del administrador con doble factor (obligatorio en producción);
   - Wialon, Siigo, un correo de prueba y un PDF guardado en R2;
   - los registros, en Cloudflare: **Workers & Pages → terra-residuos-api → Logs** y **Containers**.
6. **Datos reales:** cargar clientes, sedes y declaraciones desde Excel o desde lo que se exporte de Grinclic.

## 4. Formulario del sitio web (prospectos)

El formulario de contacto del sitio web crea en TERRY-GO el prospecto, su contacto, la oportunidad y la tarea de
responder, y avisa por correo a Comercial. El navegador lo permite porque `terravivasas.net` y `www.terravivasas.net` ya
están en `CORS_ORIGINS` (`despliegue/cloudflare/api/wrangler.jsonc`). Si el sitio usa otra dirección, hay que agregarla
ahí. Ejemplo para la página del sitio:

```html
<form id="contacto-terrygo">
  <input name="empresa" placeholder="Empresa" required>
  <input name="nit" placeholder="NIT (opcional)">
  <input name="nombre" placeholder="Su nombre" required>
  <input name="correo" type="email" placeholder="Correo">
  <input name="telefono" placeholder="Teléfono">
  <input name="servicio" placeholder="¿Qué necesita?">
  <textarea name="mensaje" placeholder="Mensaje"></textarea>
  <input name="sitio" style="display:none" tabindex="-1" autocomplete="off"> <!-- trampa para robots: no lo quite -->
  <label><input name="aceptaDatos" type="checkbox" required> Acepto la política de tratamiento de datos</label>
  <button>Enviar</button>
</form>
<script>
  document.getElementById('contacto-terrygo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.aceptaDatos = e.target.aceptaDatos.checked;
    const r = await fetch('https://residuos.terravivasas.net/api/v1/comercial/formulario-web', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    alert(r.ok ? 'Gracias: lo contactaremos pronto.' : (await r.json()).mensaje);
  });
</script>
```

## 5. Después de publicar

- **Claves que pasaron por el chat** (R2, Siigo, Wialon): generar unas nuevas en cada servicio y cambiarlas en las claves
  del Worker. El contenedor se reinicia solo con las nuevas.
- **Ambiente de pruebas (staging):** una rama de Neon y otro Worker y otro proyecto de Pages (por ejemplo
  `terra-residuos-pruebas`). Nunca con datos reales.
- **Copias:** Neon permite volver a un punto en el tiempo. Además, una copia semanal fuera de Neon (en R2).
- **Monitoreo externo:** un revisor de disponibilidad (por ejemplo UptimeRobot) contra
  `https://residuos.terravivasas.net/api/v1/salud`. Los errores del servidor ya llegan por correo al administrador.

## 6. Cómo funciona por dentro (desarrollo)

- **Archivos.** Todo está en `despliegue/cloudflare`, que tiene su propio `package.json` con Wrangler (no es parte de
  los espacios de trabajo de npm ni entra en la imagen):
  - `api/`: Worker, Durable Object y contenedor (`wrangler.jsonc`, `src/index.ts`);
  - `web/`: proyecto de Pages (`wrangler.jsonc`) y la función `functions/api/[[ruta]].ts`.
- **Contenedor.** Política `durable_object`: el Durable Object `ServidorApi` enciende el contenedor con la imagen
  publicada (`ctx.container.images.api`), tamaño 1 vCPU / 3 GiB (el menor tamaño a la medida) y salida a internet.
  También le pasa todas las variables y claves del Worker.
  - Guarda la versión en uso: la imagen más una huella SHA-256 de las variables; las claves no se guardan tal cual. Si
    la versión cambia, apaga con SIGTERM (hasta 60 s; luego a la fuerza) y enciende la nueva.
  - En la imagen, `tini` es el proceso 1 y el API recibe las señales.
- **IP de quien entra:** la función de Pages pone en `X-Forwarded-For` solo la dirección que vio Cloudflare
  (`CF-Connecting-IP`), sin aceptar la que mande el navegador. El API confía en un salto (`trust proxy` = 1). Esa
  dirección queda en la auditoría y cuenta para los límites de intentos de ingreso.
- **Service worker:** nunca guarda nada de `/api`. Los datos de cada persona no quedan en la copia del teléfono.
- **Pruebas en cada cambio** (trabajo «Publicación en Cloudflare» de `pruebas.yml`):
  - tipos del Worker y de la función;
  - la lógica del Durable Object con un contenedor simulado (`npm run prueba`);
  - la imagen: construirla, encenderla como en producción contra PostgreSQL y apagarla con SIGTERM sin forzar;
  - `wrangler deploy --dry-run` y la compilación de la función de Pages.
- **En un computador sin Docker** no se puede construir la imagen. `npm run prueba` y `npm run revisar` sí corren, y
  GitHub construye la imagen al publicar.
