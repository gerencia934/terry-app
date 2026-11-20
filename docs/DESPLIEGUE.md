# Publicar TERRY-GO (producción)

Guía paso a paso para dejar TERRY-GO funcionando en internet. Los valores secretos (claves, tokens, conexiones) nunca van
en este repositorio: se escriben solo en Render, en Neon o en el `.env` local.

## 1. Cómo queda

| Pieza | Dónde | Dirección |
|---|---|---|
| Pantallas (web y app del conductor) | Cloudflare Pages | `https://terrygo.terravivasas.net` |
| Servidor (API) | Render: contenedor siempre encendido, región Virginia (`render.yaml`) | `https://api-terrygo.terravivasas.net` |
| Base de datos | Neon: PostgreSQL 16 administrado, región AWS US East (Virginia) | — |
| Archivos (PDF, fotos, firmas) | Cloudflare R2 (ya configurado) | — |
| Correo de salida | Un buzón con SMTP (por ejemplo, uno de Hostinger en `terravivasas.net`) | — |

**Por qué no Cloudflare Workers ni D1:**
- El servidor de TERRY-GO trabaja todo el tiempo, no solo cuando alguien abre una pantalla: consulta Wialon cada minuto,
  sincroniza Siigo a diario, envía el correo de alertas y prepara PDF y ZIP en una cola. Además usa librerías de Node
  (PDF, cifrado de contraseñas) y Prisma. Workers solo atiende peticiones cortas: habría que reescribir el servidor.
- D1 es SQLite. Las reglas de TERRY-GO viven en PostgreSQL (disparadores, la barrera RLS del portal de clientes) y no
  funcionan en D1. Neon sí es PostgreSQL: funciona tal como está.
- Pages sí sirve para las pantallas: son archivos estáticos.

El costo total queda dentro del presupuesto aprobado (hasta US$150 al mes). Los precios exactos, en la calculadora de cada
proveedor.

## 2. Lo que hace la gerencia (cuentas a nombre de la empresa, con doble factor)

1. **Neon** (base de datos):
   - crear la cuenta y un proyecto `terry-go` con PostgreSQL 16 en la región **AWS US East (N. Virginia)**;
   - plan pago: el gratuito no guarda historial suficiente para volver a un punto en el tiempo con datos reales;
   - en **Connect**, copiar la conexión del dueño del proyecto (la directa, no la *pooled*) y entregarla de forma segura.
2. **Render** (servidor):
   - crear la cuenta entrando con GitHub;
   - **New → Blueprint** → repositorio `terry-app`. Render lee `render.yaml` y pide los valores secretos.
3. **Cloudflare Pages** (pantallas), en la misma cuenta de Cloudflare:
   - **Workers & Pages → Create → Pages → Connect to Git** → repositorio `terry-app`;
   - rama de producción: `main`;
   - comando de compilación: `npm ci && npm run build -w @terraviva/shared && npm run build -w @terraviva/web`;
   - carpeta de salida: `apps/web/dist`;
   - variables: `VITE_API_URL` = `https://api-terrygo.terravivasas.net/api/v1` y `NODE_VERSION` = `22`;
   - **Custom domains** → `terrygo.terravivasas.net`.
4. **Hostinger** (DNS de `terravivasas.net`), dos registros CNAME:
   - `terrygo` → el `….pages.dev` que muestre Pages;
   - `api-terrygo` → el `….onrender.com` que muestre Render. En Render: **Settings → Custom Domains** →
     `api-terrygo.terravivasas.net`.
5. **Correo de salida:** un buzón (por ejemplo `notificaciones@terravivasas.net`) con su servidor SMTP, usuario y clave.
   Sin él no llegan las invitaciones, la recuperación de contraseña ni las alertas.
6. **Política de tratamiento de datos (Ley 1581):** publicar el texto en una página (por ejemplo
   `https://terravivasas.net/politica-datos`) y fijar su versión (`1.0`). Sin ella el servidor no arranca en producción.
7. **GitHub:** aprobar que la rama de trabajo se una a `main`. Producción sale de `main` y Render publica solo cuando las
   pruebas automáticas pasan.

## 3. Lo que hace el desarrollo (con la conexión de Neon)

1. Crear en Neon el usuario de la aplicación, **sin** permiso para saltarse la RLS, y su base de datos (en el editor SQL
   de Neon, como dueño del proyecto):
   ```sql
   CREATE ROLE terraviva_app LOGIN PASSWORD '<clave larga y aleatoria>' NOBYPASSRLS;
   GRANT terraviva_app TO neondb_owner; -- el dueño del proyecto, con el nombre que muestre Neon
   CREATE DATABASE terrygo OWNER terraviva_app;
   ```
2. Con la conexión de `terraviva_app` (directa, con `?sslmode=require&connect_timeout=15`): `npm run db:migrate` y
   `npm run db:seed` con `SEED_ADMIN_EMAIL` (el correo de Gerencia) y `SEED_ADMIN_PASSWORD`. Así quedan los catálogos, los
   roles, las etapas y el usuario administrador.
3. Llenar en Render los valores secretos: `DATABASE_URL` (la de `terraviva_app`), R2, Siigo, Wialon, SMTP y la política
   de datos. `JWT_SECRET` lo genera Render y no se cambia después (también cifra la verificación en dos pasos).
4. Revisar:
   - `https://api-terrygo.terravivasas.net/api/v1/salud`;
   - el ingreso del administrador con doble factor (obligatorio en producción);
   - Wialon, Siigo, un correo de prueba y un PDF guardado en R2.
5. Cargar los datos reales (clientes, sedes y declaraciones) desde Excel o desde lo que se exporte de Grinclic.

## 4. Formulario del sitio web (prospectos)

El formulario de contacto del sitio web crea el prospecto, su contacto, la oportunidad y la tarea de responder en
TERRY-GO, y avisa por correo a Comercial. Para que el navegador lo permita, la dirección del sitio debe estar en
`CORS_ORIGINS` del servidor (por ejemplo `https://terrygo.terravivasas.net,https://terravivasas.net`). Ejemplo para la
página del sitio:

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
    const r = await fetch('https://api-terrygo.terravivasas.net/api/v1/comercial/formulario-web', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    alert(r.ok ? 'Gracias: lo contactaremos pronto.' : (await r.json()).mensaje);
  });
</script>
```

## 5. Después de publicar

- **Ambiente de pruebas (staging):** una rama de Neon y un segundo servicio en Render. Nunca con datos reales.
- **Copias:** Neon permite volver a un punto en el tiempo. Además, una copia semanal fuera de Neon (en R2).
- **Monitoreo externo:** un revisor de disponibilidad (por ejemplo UptimeRobot) contra `/api/v1/salud`. Los errores del
  servidor ya llegan por correo al administrador.
- Si algún día el servidor queda detrás del proxy de Cloudflare (nube naranja), hay que ajustar `trust proxy` en
  `apps/api/src/main.ts`: hoy cuenta un solo salto (el de Render).
