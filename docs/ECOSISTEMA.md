# Ecosistema Terry-App: «todo junto pero no unido»

Un solo portal (`https://app.terravivasas.net`) da la entrada y el menú de módulos. Cada módulo sigue siendo su propia
aplicación: sus pantallas, su servidor y su base de datos. Si un módulo falla, los demás siguen trabajando.

| Módulo | Dirección | Código | Base de datos |
|---|---|---|---|
| Portal (Cuenta Terry-App) | `app.terravivasas.net` | `apps/portal` (este repositorio) | Neon, proyecto `terry-portal` |
| Residuos | `residuos.terravivasas.net` | `apps/api` + `apps/web` (este repositorio) | Neon, proyecto `terra-residuos` |
| Mantenimiento | `mantenimiento.terravivasas.net` (acepta el pase desde el 20-11-2026) | repositorio `terra-mantenimiento` | la suya |
| HSEQ y Talento Humano | (por publicar; módulo `hseq` del pase) | repositorio `terra-hseq-rrhh` (iniciado el 21-11-2026) | la suya |
| CRM comercial | (próximamente) | — | la suya |
| Planta | (próximamente) | — | la suya |

## Reglas

1. **Nadie comparte tablas.** Un módulo no lee la base de otro: consulta la API del dueño del dato (estándar 5) o
   recibe su aviso. Si necesita trabajar aunque el otro esté caído, guarda una copia de solo lectura que el dueño
   mantiene al día. Por ejemplo, Residuos guarda las coordenadas de la sede que capturó el CRM, para que el conductor
   llegue aunque el CRM esté caído.
2. **Los avisos se reintentan.** Quien envía guarda el aviso en su cola (en Residuos, la tabla `trabajos`) y lo
   reintenta hasta que el otro responde. Quien recibe acepta el mismo aviso repetido sin duplicar nada (idempotencia
   por un identificador del aviso).
3. **Una consulta a otro módulo nunca bloquea.** Se espera como máximo 3 segundos. Si el otro módulo no responde, se
   sigue con un aviso visible («no se pudo consultar Mantenimiento»), no con un error. Única excepción, por regla de
   negocio: el preoperacional del Portal Logístico. Sin respuesta vale lo último confirmado; si nunca se confirmó, la
   ruta espera, y en una emergencia la oficina autoriza la salida con un motivo.
4. **El portal no es indispensable.** Cada módulo conserva su propia entrada como respaldo. Quien ya está adentro
   sigue trabajando aunque el portal se caiga.

## Estándares del ERP Terry-App

Fijados por la gerencia el 21-11-2026. Terry-App es el ERP de Terra Viva: cada módulo es una pieza del mismo sistema.
Todo módulo, de los actuales o de los que vengan, cumple estos siete estándares.

1. **La sesión no se cae.**
   - Queda abierta en el equipo hasta que la persona salga, el administrador la desactive, se cambie la contraseña o
     pase el tiempo sin uso que fije Ajustes (por defecto un año, como en Mantenimiento).
   - Si el servidor no responde o se está encendiendo, la app avisa «Reconectando…» y conserva la sesión. Solo la
     cierra cuando el servidor la rechaza.
   - Renueva una sola pestaña a la vez (Web Locks). El servidor acepta durante 60 segundos el token recién cambiado
     (sesión sucesora): una respuesta que se pierde en el camino no cierra la sesión.
   - Al volver la app al frente, renueva antes de que el token venza.
   - Las notificaciones push no dependen de la sesión: llegan con la app cerrada o en segundo plano.
2. **El ingreso es igual en todos.**
   - Botón para mostrar la contraseña.
   - Abajo, «Olvidé mi contraseña», con un flujo que funcione: si hay correo de salida, llega un enlace. Si no, el
     administrador ve la solicitud y envía el enlace por WhatsApp.
3. **Roles y funciones editables, como en Mantenimiento.**
   - Roles con nombre y descripción, y funciones finas agrupadas por tema, editables en Ajustes › Roles.
   - Cada menú, pantalla y botón obedece la función, también en el servidor.
   - El Administrador conserva el acceso total.
4. **Una sola identidad visual.**
   - Nombres: **Terry-App Residuos**, **Terry-App Mtto**, **Terry-App CRM**, **Terry-App HSEQ**. El portal es
     **Terry-App**.
   - La primera página sigue el modelo de Residuos: logo de Terra Viva arriba a la izquierda, tarjeta centrada con el
     sello Terry-App (Terry y el nombre del módulo), el saludo «Hola, soy Terry», el ingreso y el pie «© Terra Viva
     S.A.S. E.S.P. · Soluciones ambientales inteligentes».
   - Misma paleta, tipografía, componentes y palabras en todos los módulos.
5. **Cada dato tiene un solo dueño.**
   - Se crea y se edita solo en su módulo.
   - Los demás lo consultan por la API del dueño, con su token; nunca leyendo su base de datos. Así un cambio interno
     de un módulo no rompe a los demás.
   - Si un módulo necesita seguir trabajando cuando el dueño está caído, guarda una copia de solo lectura que el dueño
     mantiene al día. Esa copia no se edita.

   | Dato | Dueño | Lo consultan |
   |---|---|---|
   | Cuenta de la persona y su entrada | Portal | Todos |
   | Colaboradores, cargos, licencias de conducción, certificaciones y exámenes | HSEQ y Talento Humano | Residuos (conductores), Mtto (PESV) |
   | Vehículos y equipos: hoja de vida, SOAT, RTM, pólizas, capacidad y GPS | Mtto | Residuos (flota de las rutas) |
   | Preoperacionales y fallas | Mtto | Residuos (Portal Logístico) |
   | Clientes, contactos y oportunidades | Por acordar con el CRM | Residuos, CRM |
   | Servicios, rutas, manifiestos y certificados | Residuos | CRM (historial del cliente), Planta |

6. **Los ajustes se editan sin tocar código.**
   - Las listas desplegables y los parámetros de la operación (plazos, metas, horarios, tiempos de sesión…) se editan
     en Ajustes, y cada cambio queda en la auditoría.
   - En el código solo quedan los estados que mueven reglas (su nombre visible sí se edita) y las claves secretas.
7. **El norte es un ERP.** Cada pieza se conecta con las demás por contratos (avisos y consultas con token) y cumple
   estos estándares desde el primer día.

## Entrada única: el «pase»

El portal autentica a la persona (contraseña y verificación en dos pasos obligatoria) y, cuando ella abre un módulo,
le entrega un pase firmado que vale 60 segundos y sirve una sola vez.

**Formato:** JWS compacto con firma Ed25519.
- Encabezado: `{"alg":"EdDSA","typ":"JWT","kid":"portal-1"}`.
- Contenido:

| Campo | Valor |
|---|---|
| `iss` | `https://app.terravivasas.net` (en pruebas, la dirección del portal de pruebas) |
| `aud` | el módulo: `residuos`, `mantenimiento`, `crm`, `planta` |
| `sub` | correo de la persona, en minúsculas |
| `nom` | nombre de la persona |
| `amr` | `["pwd","otp"]`: entró con contraseña y con código de verificación |
| `iat`, `exp` | emitido y vencimiento, en segundos; `exp = iat + 60` |
| `jti` | UUID del pase |

**Entrega:** el portal lleva el navegador a `https://<módulo>/#sso=<pase>`. El pase viaja en el fragmento, que el
navegador no envía a ningún servidor ni deja en los registros.

**Qué hace el módulo:**
1. Lee `#sso=`, lo borra de la barra de direcciones y lo envía a su propio servidor. Residuos usa `POST /api/v1/auth/portal` con `{ "pase": "..." }`.
2. El servidor verifica la firma con la clave pública del portal. La clave está en su configuración (`PORTAL_CLAVE_PUBLICA`, la «x» del JWK en base64url): no se descarga en cada ingreso.
3. Revisa los campos: `iss` igual a `PORTAL_URL`, `aud` igual a su nombre, que no esté vencido (60 s, con 5 s de holgura) y `exp - iat ≤ 120`.
4. Guarda el `jti` para no aceptar dos veces el mismo pase.
5. Busca a su usuario local por el correo (`sub`). Debe estar activo. Los permisos y el rol siguen siendo los del módulo.
6. Si el módulo exige verificación en dos pasos, acepta `amr` con `otp` como cumplida: no la vuelve a pedir en esa sesión, ni al renovarla.
7. Crea su propia sesión, igual que con su ingreso normal. La política de datos de cada módulo se sigue aceptando dentro del módulo.

Si el correo no existe en el módulo, responde 403: «Su cuenta Terry-App no tiene acceso a este módulo».

**Claves:**
- La privada vive solo como secreto del portal (`PORTAL_CLAVE_PRIVADA`, JWK).
- La pública también se publica en `GET https://app.terravivasas.net/api/v1/clave-publica` (JWKS), por comodidad.
- Cambiar la clave obliga a actualizar `PORTAL_CLAVE_PUBLICA` en cada módulo.
- Las pruebas usan un par de claves propio que no sirve en producción.

## Avisos entre módulos (contratos)

| Aviso | De → a | Cómo |
|---|---|---|
| Vehículo en mantenimiento (bloqueo) | Mantenimiento → Residuos | `PUT/DELETE /api/v1/integraciones/mantenimiento/bloqueos/{id}` con `x-integracion-token` |
| Disponibilidad del vehículo antes de programar | Residuos → Mantenimiento | `GET /api/v1/mto/integraciones/terrygo/vehiculos/:placa/disponibilidad` |
| Preoperacional del día (Portal Logístico: sin él no hay ruta) | Residuos → Mantenimiento | `GET /api/v1/mto/integraciones/terrygo/vehiculos/:placa/preoperacional?fecha=AAAA-MM-DD` |
| Ítems NO OK del preoperacional | Residuos → Mantenimiento | Retirado el 21-11-2026: el preoperacional ya se hace en Mantenimiento |
| Kilómetros de una ruta o tanqueo | Residuos → Mantenimiento | `POST /api/v1/mto/integraciones/terrygo/lecturas` |
| Coordenadas de la sede (check-in comercial) | CRM → Residuos | (se define con el CRM) |
| Vehículo que llega a planta (F-09) | Residuos → Planta | (se define con Planta) |

Los contratos con Mantenimiento ya existen de su lado (ver su `docs/DESPLIEGUE.md`). Cada integración se autentica con
su propio token, guardado solo en las variables de los dos servidores.

## Salud

- Cada módulo responde `GET /api/v1/salud` sin sesión.
- El portal la consulta desde su servidor (3 s como máximo, con 30 s de memoria) para pintar cada cuadro del menú: disponible, sin respuesta o próximamente.
- Un módulo caído sale en gris. Los demás siguen igual.
