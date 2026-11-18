# Plantillas de cargue masivo

| Archivo | Para cargar | Orden |
|---|---|---|
| TV_plantilla_clientes.xlsx | Clientes directos (generadores) | 1 |
| TV_plantilla_sucursales.xlsx | Sucursales de cada cliente | 2 |
| TV_plantilla_vehiculos.xlsx | Flota | 2 |
| TV_plantilla_usuarios.xlsx | Personal y conductores | 2 |
| TV_plantilla_declaraciones_residuos.xlsx | Residuos por sucursal | 3 |
| TV_plantilla_declaraciones_servicios.xlsx | Servicios por sucursal | 3 |
| TV_plantilla_precios.xlsx | Nuevas tarifas por Nº de declaración | 4 |
| TV_plantilla_solicitudes.xlsx | Programación de recolecciones en bloque | 4 |

**Respete el orden**: una sucursal solo se carga si su cliente ya existe; una declaración, si la sucursal existe.

Cada archivo trae:
- Hoja **Plantilla**: diligencie desde la fila 3. La fila 2 es un ejemplo y no se carga. Las columnas con `*` son obligatorias.
  Las columnas de lista tienen menú desplegable.
- Hoja **Instrucciones**: formato y valores permitidos de cada columna.

Al subir el archivo, el sistema revisa cada fila (campos obligatorios, NIT y dígito de verificación DIAN, correos,
fechas AAAA-MM-DD, listas, corrientes Y/A, placas, duplicados, cruce con clientes/sucursales existentes y con los
permisos ambientales) y muestra los errores por fila **antes** de guardar. Las filas con error se pueden descargar,
corregir y volver a subir.

Regenerar las plantillas (después de cambiar `apps/web/src/cargues/definiciones.ts`):

```bash
cd apps/web && npm run plantillas
```
