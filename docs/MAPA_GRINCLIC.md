# Mapa Grinclic → Plataforma Terra Viva

Basado en las 34 capturas de pantalla de Grinclic (17-nov-2026). Se replica el **modelo funcional**
(módulos, flujos, columnas y filtros) con identidad, código y diseño propios de Terra Viva.

| Grinclic | Terra Viva (ruta) | Estado | Mejora sobre Grinclic |
|---|---|---|---|
| Login: usuario empresarial + contraseña | `#login` | ✅ | Recuperación de contraseña con enlace de un solo uso |
| Inicio: ficha empresa, accesos directos con conteos, pendientes, totales del mes, botones, recordatorio | `#inicio` | ✅ | Alertas de cumplimiento (permisos CAS, SOAT/RTM, licencias, curso MP) |
| Declaraciones: residuos y servicios, 7 filtros, 20 columnas | `#declaraciones` | ✅ | Validación automática contra permisos ambientales antes de autorizar |
| Declaraciones › Cargues masivos | `#cargues` | ✅ | Revisión fila a fila con errores en español antes de guardar; DV del NIT (DIAN) |
| Declaraciones › Exportable detallado | `#exportable` | ✅ | Exportable en formato de plantilla para editar y recargar |
| Declaraciones › Asignación masiva de precios | `#precios` | ✅ | Ajuste % o precio fijo, impacto estimado, historial de vigencias |
| Solicitudes: tabla + calendario de pendientes con leyenda de colores | `#solicitudes` | ✅ | Valor estimado por solicitud |
| Pre-solicitudes | `#pre-solicitudes` | ✅ | Conversión a solicitud formal en un clic |
| Rutas programadas: filtros + calendario por vehículo | `#rutas` | ✅ | Agenda por día en celular |
| Rastreo de rutas (vehículo/carga/descarga/estados) | `#rastreo` | ✅ (simulado) | Línea de tiempo de estados por ruta |
| Informe de programación | `#informe-rutas` | ✅ | — |
| Estado del recorrido (nombre, color, descripción, orden, rastreo continuo) | `#estados-recorrido` | ✅ | — |
| Chequeo: lista de chequeo interna | `#chequeo` + app `#campo-preop` | ✅ | Ítem crítico en «No» bloquea la ruta (trigger en BD) |
| Manifiesto + informe de anulados | `#manifiestos` | ✅ | Consecutivo RNDC |
| Conciliaciones + consolidado | `#conciliaciones` | ✅ | Origen vs. báscula con tolerancia ±2 % y justificación obligatoria (CHECK en BD) |
| Actas | `#actas` | ✅ | Bloqueadas hasta conciliar |
| Inventario | `#inventario` | ✅ básico | Días en almacenamiento con alerta |
| Reportes › Informes (general, cartera, correos) | `#informes` | ✅ (descarga simulada) | Informe para IDEAM/CAR y cumplimiento de permisos |
| Reportes › Indicadores generales y operativos | `#indicadores` | ✅ | Gráficos con paleta validada para daltonismo, modo oscuro |
| Configuraciones del sistema (25 opciones) | `#configuracion` | ✅ | Catálogos con un solo componente genérico |
| App móvil del conductor | `#campo` | ✅ | Funciona sin señal (fase 1), firma y fotos |

## Pendiente de las capturas
- **Inventario** completo (entradas/salidas por manifiesto, bodegas, residuos inventariables): solo se vio el aviso promocional.
- **Formularios de creación** (nueva declaración, nueva solicitud, nueva ruta): las capturas muestran los listados;
  se necesitan capturas de los formularios para replicar campo por campo.
- **Detalle de manifiesto / acta en PDF**: se necesita un PDF de ejemplo para replicar el formato oficial.
