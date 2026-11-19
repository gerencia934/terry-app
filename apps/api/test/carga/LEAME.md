# Prueba de carga: 400 usuarios concurrentes

Requisito de la gerencia (`docs/REQUISITOS_PRODUCCION.md` §6): **400 usuarios concurrentes** en hora pico, con las
pantallas respondiendo en **menos de 1 segundo (p95)** y las **descargas sin errores**.

La prueba se corre **solo en staging**, nunca en producción, con [k6](https://k6.io).

## Antes de empezar

1. **Staging con volumen real.** Use una copia de la estructura de producción con datos de volumen: 2.000 clientes y
   varios meses de solicitudes, manifiestos, conciliaciones y certificados emitidos. Si la base está vacía, la prueba
   no dice nada.
2. **Usuarios de prueba** (400, con el rol Logística):

   ```bash
   CONFIRMAR=staging CANTIDAD=400 CLAVE_CARGA='…' DATABASE_URL='postgresql://…staging…' node apps/api/test/carga/usuarios-carga.mjs
   ```

3. **Límite de ingresos.** Mientras dure la prueba, en el API de staging ponga `LIMITE_INGRESOS_IP_MIN=1000`.
   Los 400 usuarios entran desde la misma máquina, y el límite normal es de 60 ingresos por minuto por IP.
   El resto de los límites cuenta por usuario y no hay que tocarlo.

## Correr la prueba

```bash
k6 run -e API=https://staging.ejemplo/api/v1 -e CLAVE_CARGA='…' apps/api/test/carga/k6-400-usuarios.js
```

La prueba sube a 400 usuarios en 3 minutos y los sostiene 10 minutos. Cada usuario entra con su propia sesión, acepta
la política de datos la primera vez y va de pantalla en pantalla, con 2 a 5 segundos para mirar cada una.

Cada visita es a una de estas pantallas, con este peso:

| Pantalla | Peso |
|---|---|
| Certificados, con descarga del PDF | 30 % |
| Manifiestos (a veces descarga el PDF) | 15 % |
| Solicitudes | 15 % |
| Conciliaciones | 10 % |
| Declaraciones | 10 % |
| Buscador de clientes | 10 % |
| Consolidado | 10 % |

Además, la campana de alertas se consulta en el 30 % de las visitas.

Para un ensayo corto: `-e VUS=50 -e SUBIDA=30s -e DURACION=2m`.

## Cómo leer el resultado

k6 marca la prueba como fallida si no se cumple alguno de los umbrales:

- `http_req_duration{tipo:pantalla}`: el p95 debe ser menor que 1.000 ms.
- `http_req_failed{tipo:pantalla}`: menos del 1 % de errores.
- `http_req_failed{tipo:descarga}` y `checks{tipo:descarga}`: descargas prácticamente sin errores.

Si fallan las descargas o el p95 de certificados sube, el siguiente ajuste ya está identificado: generar los PDF en
una cola de trabajos y servirlos con enlace firmado desde el almacenamiento (`docs/REVISION_REQUISITOS_PRODUCCION.md`).

## Al terminar

```bash
CONFIRMAR=staging CANTIDAD=400 DATABASE_URL='postgresql://…staging…' node apps/api/test/carga/usuarios-carga.mjs --desactivar
```

Vuelva a poner `LIMITE_INGRESOS_IP_MIN` en su valor normal (60).
