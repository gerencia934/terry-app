# Requisitos de producción, seguridad e integraciones — Plataforma Terra Viva

Documento de la gerencia de Terra Viva S.A.S. E.S.P. para el equipo de desarrollo. Estos requisitos
**condicionan el diseño de todos los módulos**. Si algo ya construido no los cumple, se ajusta.

## 1. Alcance y escala

- **Portal de clientes.** **2.000 clientes** (empresas). Cada cliente tiene uno o varios usuarios con contraseña.
  El cliente consulta y descarga **solo lo suyo**:
  - declaraciones de residuos y solicitudes;
  - manifiestos y conciliaciones;
  - certificados de disposición final e informes.
- **Usuarios internos:** administración, comercial, logística, HSEQ, planta y facturación.
- **Conductores:** usan la app móvil.
- **Carga de diseño (mínimo obligatorio):**
  - **2.000 clientes** y hasta **6.000 usuarios** registrados (clientes + internos).
  - **400 usuarios concurrentes** en hora pico (fin de mes, cuando todos descargan certificados).
  - 100.000 certificados por año.
  - 10 años de historial (más de 1 millón de documentos).
- **El diseño debe crecer sin rehacerse** hasta el doble de esa carga, solo aumentando recursos:
  - API sin estado, con varias instancias detrás de un balanceador.
  - Índices y paginación en todos los listados; ningún listado devuelve todo.
  - PDF y reportes pesados generados en cola, no en la petición del usuario.
  - Archivos servidos desde el almacenamiento con URL firmada, no a través de la API.
- **Sistemas que se reemplazan:** Grinclic (operación de residuos) y Bigin (CRM).
- **Sistemas que se integran:** Siigo Nube (contabilidad y factura electrónica) y Wialon (GPS de la flota).

## 2. Aislamiento de datos de clientes (crítico)

1. **Rol `CLIENTE`**, ligado a un `cliente_id`. Opcionalmente se restringe a algunas sedes.
   Hay dos perfiles: «administrador del cliente», que crea los usuarios de su empresa, y «consulta».
2. **Doble barrera:**
   - Filtro por empresa y cliente en cada consulta de la API.
   - **Row Level Security (RLS) de PostgreSQL** en las tablas con datos de clientes. Si la API tiene un error,
     la base igual impide ver datos de otro cliente.
3. **Pruebas automáticas obligatorias:** el usuario de un cliente A recibe 403 o 404 en **cada** endpoint cuando
   pide datos del cliente B. Se cubren listados, detalle, descargas y filtros.
4. **Descargas:**
   - Solo con URL firmada de corta vida (5 minutos) generada después de verificar el permiso.
   - El almacenamiento de archivos nunca es público.
5. **Identificadores:** UUID en las URL, nunca consecutivos adivinables. El consecutivo es solo un dato visible.

## 3. Conservación e integridad de la información (obligación legal)

- **Retención mínima de 10 años** para manifiestos, certificados, conciliaciones, actas y facturas:
  - libros y papeles del comerciante (Ley 962 de 2005, art. 28);
  - certificaciones de gestión de RESPEL (Decreto 1076 de 2015).
- **Nada legal se borra:**
  - Los documentos emitidos solo se **anulan**, con causa, usuario y fecha.
  - Se usa borrado lógico.
  - La auditoría guarda quién cambió qué, cuándo y desde qué IP.
- **Integridad de los PDF emitidos:**
  - Hash SHA-256 guardado en la base.
  - Código QR con enlace de verificación pública, que muestra solo el número, la fecha y si es válido.
  - Almacenamiento con versionado y **bloqueo de objeto (WORM)**.
- **Copias de seguridad (regla 3-2-1):**
  - Base de datos administrada con respaldo diario y **recuperación a un punto en el tiempo** de 7 días o más.
  - Volcado diario cifrado en **otro proveedor u otra región**, guardado 35 días, más una copia mensual
    guardada 10 años.
  - Archivos (PDF y fotos) replicados en un segundo almacenamiento.
  - **Prueba de restauración mensual** documentada.
- **Objetivos:**
  - Pérdida máxima de datos (RPO): 15 minutos.
  - Tiempo máximo de recuperación (RTO): 4 horas.

## 4. Seguridad (estándar: OWASP ASVS nivel 2)

**Acceso**
- Contraseñas con argon2id, bloqueo por intentos y recuperación con token de un solo uso (ya hecho).
- **Doble factor (TOTP) obligatorio** para usuarios internos y opcional para clientes.
- Sesiones revocables y cierre de sesión en todos los dispositivos.
- Aviso por correo cuando hay un ingreso nuevo.

**Perímetro**
- Cloudflare delante de todo: WAF, protección DDoS y límite de peticiones.
- HTTPS con HSTS.
- La base de datos **sin acceso público**: solo la API puede llegar a ella.

**Mínimo privilegio**
- Permisos por rol.
- Exportaciones masivas solo para roles autorizados y registradas en la auditoría.
- Secretos en el gestor de secretos del proveedor, nunca en el código.

**Código**
- Cada cambio entra por pull request, con pruebas en GitHub Actions y revisión antes de unir.
- Dependabot y escaneo de dependencias y código (CodeQL).
- Rama `main` protegida.
- 2FA obligatorio en GitHub.

**Monitoreo**
- Registro centralizado de errores (Sentry o similar).
- Alertas por picos de ingresos fallidos, descargas masivas o errores 5xx.
- Monitoreo de disponibilidad.

**Antes de abrir el portal a clientes**
- Prueba de penetración externa por una firma independiente, y luego una vez al año.
- Prueba de carga con k6: **400 usuarios concurrentes** con respuesta de pantallas en menos de 1 segundo (p95)
  y descargas sin errores.

## 5. Datos personales (Ley 1581 de 2012)

- Política de tratamiento de datos.
- Autorización de los titulares (aceptación registrada al primer ingreso).
- Aviso de privacidad.
- Contrato de encargo de tratamiento con el proveedor de nube.
- Registro en el RNBD ante la SIC, si Terra Viva supera el umbral de activos que lo hace obligatorio.
- Exportar o corregir los datos de un titular cuando lo solicite.

## 6. Infraestructura

- **El sitio web sigue en Hostinger.** El hosting web compartido no sirve para la aplicación: no ejecuta
  Node.js con PostgreSQL de forma confiable ni ofrece copias a un punto en el tiempo.
- **Aplicación en nube administrada**, en `app.terravivasas.com`. El DNS se gestiona desde Hostinger o Cloudflare.
  - **Opción recomendada:** PostgreSQL administrado (DigitalOcean, AWS RDS o similar) y la API en contenedores.
  - Archivos en almacenamiento tipo S3.
  - Cola de trabajos para PDF, correos e integraciones.
- **Dos ambientes:** `staging` para pruebas y `produccion`. Nunca se prueba con datos reales en `staging`.
- **Infraestructura como código y despliegue automático** desde GitHub, con posibilidad de volver a la versión anterior.

## 7. Integraciones

Regla general:
- Toda integración corre en **segundo plano con cola y reintentos** (patrón outbox).
- Si Siigo o Wialon fallan, la operación no se detiene: queda «pendiente de sincronizar» con alerta.
- Cada intercambio queda registrado: qué se envió, qué respondió el sistema externo y cuándo.

### 7.1 Siigo Nube: contabilidad y factura electrónica (se integra, no se reemplaza)

Siigo sigue emitiendo la factura electrónica ante la DIAN. La plataforma **no** se vuelve facturador electrónico.

Flujo:
1. Conciliación o certificado cerrado → **prefactura** en la plataforma, revisada por Facturación.
2. La prefactura se envía a la API de Siigo y Siigo emite la factura electrónica.
3. La plataforma guarda el número, el CUFE y el PDF o enlace de la factura.

Sincronizaciones:
- **Clientes:** por NIT; la plataforma es la fuente.
- **Productos:** cada línea de servicio tiene su código de producto en Siigo.
- **Cartera:** saldo y estado de pago traídos de Siigo; sirven para alertas y para bloquear solicitudes por mora
  si la gerencia lo decide.

Prerrequisito: credenciales de API de Siigo (usuario y llave de acceso) en un plan que incluya la API.

### 7.2 Wialon: GPS de la flota (se integra, no se reemplaza)

- La integración usa la **API remota de Wialon** con un token de acceso y solo lectura.
- **Posición en vivo:** de cada vehículo en las pantallas de programación y seguimiento, con consulta cada 30–60 s.
- **Geocercas por sede y por la planta PSA Los Pinos:**
  - Al entrar a una geocerca se marcan automáticamente las horas de llegada y salida en la parada del recorrido.
  - Se registra cuánto tiempo estuvo el vehículo en la sede.
- **Recorrido real y kilómetros** de cada ruta, guardados como evidencia del manifiesto de transporte.
- **Alertas:** desvíos de ruta y paradas no programadas con carga RESPEL.
- Las placas de la plataforma se relacionan con las unidades de Wialon.

### 7.3 Bigin (CRM): se reemplaza por un módulo Comercial

- **Funciones:**
  - prospectos y oportunidades por etapas;
  - actividades y seguimiento;
  - cotizaciones en PDF.
- **Conversión:** al ganar una oportunidad se crean el cliente, sus sedes y las declaraciones con sus tarifas,
  sin volver a digitar.
- **Origen de prospectos:** el formulario del sitio web crea prospectos.
- **Migración:** se exportan contactos, empresas y negocios de Bigin a CSV y se importan.

### 7.4 Grinclic: se reemplaza

- **Antes de cancelar la suscripción:**
  - descargar **todo** el histórico: certificados, manifiestos, actas y exportes de Excel;
  - importar a la plataforma lo que sirva como historial.
- **Operación en paralelo:** al menos un mes, cuadrando cifras, antes de apagar Grinclic.

## 8. Orden sugerido

1. Terminar el módulo Declaraciones (fases A, B y C en curso).
2. Infraestructura de producción, copias de seguridad, RLS, 2FA y monitoreo, **antes de cargar datos reales**.
3. Portal de clientes, solo consulta y descarga.
4. Integración con Wialon.
5. Integración con Siigo (prefactura → factura).
6. Módulo Comercial (reemplazo de Bigin) y migración.
7. Prueba de penetración, prueba de carga, operación en paralelo y salida de Grinclic.
