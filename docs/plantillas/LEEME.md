# Plantillas de importación de datos

| Archivo | Para cargar | Orden |
|---|---|---|
| TV_plantilla_clientes.xlsx | Clientes (generadores) | 1 |
| TV_plantilla_sedes.xlsx | Sedes de cada cliente | 2 |
| TV_plantilla_vehiculos.xlsx | Flota | 2 |
| TV_plantilla_usuarios.xlsx | Personal y conductores | 2 |
| TV_plantilla_declaraciones_residuos.xlsx | Residuos por cliente y sus sedes | 3 |
| TV_plantilla_declaraciones_servicios.xlsx | Servicios por cliente y sus sedes | 3 |
| TV_plantilla_precios.xlsx | Nuevas tarifas por Nº de declaración | 4 |
| TV_plantilla_solicitudes.xlsx | Programación de recolecciones en bloque | 4 |

**Respete el orden**: una sede solo se carga si su cliente ya existe; una declaración, si sus sedes existen.

En las declaraciones, los catálogos se escriben con su **código** (no con números internos):
`RESPEL`, `IND`, `01`, `CANECA`, `MET`, `Y9`, `T;I`, `ONU;SGA`, `BIO;ASP`, `kg`. La hoja **Instrucciones** trae los
códigos de cada columna. En **Sedes** se escribe `TODAS`, `PRINCIPAL` o los códigos de sede separados por punto y coma
(`C001;C002`). Cada lote queda registrado en el historial de cargues, con la huella del archivo para avisar si se sube dos veces.

Cada archivo trae:
- Hoja **Plantilla**: diligencie desde la fila 3. La fila 2 es un ejemplo y no se carga. Las columnas con `*` son obligatorias.
  Las columnas de lista tienen menú desplegable.
- Hoja **Instrucciones**: formato y valores permitidos de cada columna.

Al subir el archivo, el sistema revisa cada fila (campos obligatorios, NIT y dígito de verificación DIAN, correos,
fechas AAAA-MM-DD, listas, corrientes Y/A, placas, duplicados, cruce con clientes/sedes existentes y con los
permisos ambientales) y muestra los errores por fila **antes** de guardar. Las filas con error se pueden descargar,
corregir y volver a subir.

Las plantillas se generan desde `packages/shared/src/importacion/definiciones.ts` (columnas) y
`packages/shared/src/declaraciones/catalogos.ts` (códigos). También se descargan siempre actualizadas desde
Ajustes › Importar datos.
