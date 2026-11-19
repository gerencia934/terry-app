# Requisitos funcionales — TERRY-GO (plataforma de Terra Viva)

Documento de requisitos redactado por Terra Viva S.A.S. E.S.P. a partir de su propia operación
(planta PSA Los Pinos, flota, permisos de la CAS y obligaciones del Decreto 1076 de 2015).

## Constancia de desarrollo independiente

- Antes de diseñar se revisó la **funcionalidad** de software del mercado que Terra Viva usa como
  cliente, como referencia de qué procesos debe cubrir un sistema del sector.
- No se copió código fuente, bases de datos, diseño gráfico, textos, logotipos ni la organización
  visual de ningún producto de terceros.
- La interfaz, el vocabulario, la navegación (organizada por la cadena de trazabilidad de Terra Viva),
  el modelo de datos, las reglas de negocio y las plantillas de importación son creación propia.
- El historial de cambios del repositorio (git) documenta la evolución del desarrollo con fechas.

## Proceso que soporta: cadena de trazabilidad

```
Cliente y sede → Declaración (+ tarifa) → Solicitud → Recorrido (inspección vehicular)
   → Manifiesto de transporte → Recepción y pesaje en PSA Los Pinos → Certificado → Factura
```

## Módulos

| Área | Módulo | Requisito principal |
|---|---|---|
| Acceso | Ingreso | Correo y contraseña; bloqueo por intentos; recuperación por enlace de un solo uso |
| Comercial | Clientes y sedes | NIT con dígito de verificación DIAN; sedes con registro de generador RESPEL |
| Comercial | Declaraciones | Residuo o servicio por sede; corriente Y/A y CRETIB; **no se autoriza si ningún permiso cubre el tratamiento** |
| Comercial | Tarifas | Ajuste % o valor fijo desde una fecha; el precio anterior se conserva |
| Logística | Solicitudes / Por confirmar | Recolección en sede, por frecuencia o entrega en planta; solo residuos autorizados |
| Logística | Programación y seguimiento | Recorridos por vehículo con color propio; etapas reportadas desde la app |
| Campo y HSEQ | Inspección vehicular | Ítems críticos bloquean la salida (PESV, Res. 40595 de 2022) |
| Campo y HSEQ | Manifiestos | Emisión en campo con firma; consecutivo RNDC |
| Planta | Recepción y pesaje | Diferencia sede/báscula > ±2 % exige explicación (regla en la base de datos) |
| Planta | Inventario y certificados | Antigüedad en bodega; certificado solo con recepción confirmada |
| Cumplimiento | Permisos ambientales | Obligaciones con fecha y alertas |
| Análisis | Indicadores e informes | Negocio y operación; exportación a Excel |
| Ajustes | Importar datos | 8 plantillas de Excel con revisión fila a fila antes de guardar |

## Pendiente de definir con Terra Viva

- Formatos oficiales (PDF) de manifiesto y certificado.
- Obligaciones reales y fechas de cada acto administrativo de la CAS.
- Inventario por bodega: reglas de entrada/salida y tiempos máximos según licencia.
