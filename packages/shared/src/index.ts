// Código compartido entre la aplicación web y el API: las reglas de negocio viven en un solo lugar.
export * from './importacion/definiciones';
export { construirPlantilla, leerArchivo, exportarErrores } from './importacion/excel';
