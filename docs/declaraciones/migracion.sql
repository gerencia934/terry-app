-- CreateEnum
CREATE TYPE "TipoCliente" AS ENUM ('DIRECTO', 'GESTOR');

-- CreateEnum
CREATE TYPE "ClasificacionSede" AS ENUM ('RESIDENCIAL', 'INDUSTRIAL', 'INSTITUCIONAL', 'COMERCIAL');

-- CreateEnum
CREATE TYPE "EstadoFisico" AS ENUM ('SOLIDO', 'SEMISOLIDO', 'LIQUIDO', 'GASEOSO');

-- CreateEnum
CREATE TYPE "AlcanceSedes" AS ENUM ('TODAS', 'PRINCIPAL', 'SELECCION');

-- CreateEnum
CREATE TYPE "UsoMetrica" AS ENUM ('PRECIO', 'DENSIDAD');

-- CreateEnum
CREATE TYPE "TipoCodigoClasificacion" AS ENUM ('A', 'Y');

-- CreateEnum
CREATE TYPE "TipoCargue" AS ENUM ('SUCURSALES', 'DECLARACIONES');

-- CreateEnum
CREATE TYPE "EstadoCargue" AS ENUM ('VALIDADO', 'CONFIRMADO', 'FALLIDO');

-- AlterEnum
BEGIN;
CREATE TYPE "EstadoDeclaracion_new" AS ENUM ('BORRADOR', 'PENDIENTE', 'AUTORIZADA', 'RECHAZADA');
ALTER TABLE "declaraciones" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "declaraciones" ALTER COLUMN "estado" TYPE "EstadoDeclaracion_new" USING ("estado"::text::"EstadoDeclaracion_new");
ALTER TYPE "EstadoDeclaracion" RENAME TO "EstadoDeclaracion_old";
ALTER TYPE "EstadoDeclaracion_new" RENAME TO "EstadoDeclaracion";
DROP TYPE "EstadoDeclaracion_old";
ALTER TABLE "declaraciones" ALTER COLUMN "estado" SET DEFAULT 'PENDIENTE';
COMMIT;

-- DropForeignKey
ALTER TABLE "catalogo_residuos" DROP CONSTRAINT "catalogo_residuos_linea_servicio_id_fkey";

-- DropForeignKey
ALTER TABLE "catalogo_residuos" DROP CONSTRAINT "catalogo_residuos_tipo_manejo_id_fkey";

-- DropForeignKey
ALTER TABLE "declaraciones" DROP CONSTRAINT "declaraciones_sucursal_id_fkey";

-- DropForeignKey
ALTER TABLE "declaraciones" DROP CONSTRAINT "declaraciones_residuo_id_fkey";

-- DropForeignKey
ALTER TABLE "declaraciones" DROP CONSTRAINT "declaraciones_tipo_manejo_id_fkey";

-- DropForeignKey
ALTER TABLE "declaraciones" DROP CONSTRAINT "declaraciones_embalaje_id_fkey";

-- DropForeignKey
ALTER TABLE "declaraciones" DROP CONSTRAINT "declaraciones_destino_id_fkey";

-- DropIndex
DROP INDEX "declaraciones_empresa_id_tipo_estado_idx";

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "tipo" "TipoCliente" NOT NULL DEFAULT 'DIRECTO';

-- AlterTable
ALTER TABLE "sucursales" DROP COLUMN "horario",
ADD COLUMN     "activa" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "atencion_fd_desde" TIME(0),
ADD COLUMN     "atencion_fd_hasta" TIME(0),
ADD COLUMN     "atencion_lv_desde" TIME(0),
ADD COLUMN     "atencion_lv_hasta" TIME(0),
ADD COLUMN     "celular" VARCHAR(20),
ADD COLUMN     "clasificacion" "ClasificacionSede",
ADD COLUMN     "codigo" VARCHAR(20),
ADD COLUMN     "emails" VARCHAR(200),
ADD COLUMN     "es_principal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "generador_nit" VARCHAR(15),
ADD COLUMN     "generador_nombre" VARCHAR(200),
ADD COLUMN     "observaciones" TEXT,
ALTER COLUMN "direccion" SET DATA TYPE VARCHAR(300);

-- AlterTable
ALTER TABLE "proveedores" ADD COLUMN     "licencia_vence" DATE;

-- AlterTable
ALTER TABLE "permisos_ambientales" DROP COLUMN "manejos_cubiertos";

-- AlterTable
ALTER TABLE "catalogo_residuos" DROP COLUMN "clase_riesgo",
DROP COLUMN "corriente",
DROP COLUMN "estado_fisico",
DROP COLUMN "numero_onu",
DROP COLUMN "peligrosidad",
DROP COLUMN "tipo_manejo_id",
DROP COLUMN "unidad",
ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "valores" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "declaraciones" DROP COLUMN "autorizacion",
DROP COLUMN "cantidad_estimada",
DROP COLUMN "destino_id",
DROP COLUMN "embalaje_id",
DROP COLUMN "frecuencia",
DROP COLUMN "residuo_id",
DROP COLUMN "sucursal_id",
DROP COLUMN "tipo_manejo_id",
ADD COLUMN     "aceptada_en" TIMESTAMPTZ,
ADD COLUMN     "aceptada_por" UUID,
ADD COLUMN     "activa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "alcance_sedes" "AlcanceSedes" NOT NULL DEFAULT 'SELECCION',
ADD COLUMN     "aprobada_en" TIMESTAMPTZ,
ADD COLUMN     "aprobada_por" UUID,
ADD COLUMN     "cantidad_frecuencia" DECIMAL(12,2),
ADD COLUMN     "cargue_id" UUID,
ADD COLUMN     "catalogo_id" UUID,
ADD COLUMN     "categoria_id" UUID NOT NULL,
ADD COLUMN     "codigo_a_id" UUID,
ADD COLUMN     "codigo_interno" VARCHAR(40),
ADD COLUMN     "codigo_un" VARCHAR(6),
ADD COLUMN     "codigo_y_id" UUID,
ADD COLUMN     "color" VARCHAR(60),
ADD COLUMN     "composicion" TEXT,
ADD COLUMN     "controlada_estupefacientes" BOOLEAN,
ADD COLUMN     "creado_por" UUID,
ADD COLUMN     "datos_extras" TEXT,
ADD COLUMN     "densidad" DECIMAL(12,4),
ADD COLUMN     "descripcion_proceso" TEXT,
ADD COLUMN     "descripcion_servicio" VARCHAR(1000),
ADD COLUMN     "es_peligroso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estado_fisico" "EstadoFisico",
ADD COLUMN     "frecuencia_dias" INTEGER,
ADD COLUMN     "inflamable" BOOLEAN,
ADD COLUMN     "linea_servicio_id" UUID NOT NULL,
ADD COLUMN     "material_embalaje_id" UUID,
ADD COLUMN     "metrica_densidad_id" UUID,
ADD COLUMN     "mostrar_precio_app" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nombre" VARCHAR(200) NOT NULL,
ADD COLUMN     "observaciones" TEXT,
ADD COLUMN     "olor" VARCHAR(120),
ADD COLUMN     "otro_material" VARCHAR(80),
ADD COLUMN     "otro_tipo_embalaje" VARCHAR(80),
ADD COLUMN     "presentacion" VARCHAR(60),
ADD COLUMN     "responsabilidad_aceptada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serial" VARCHAR(60),
ADD COLUMN     "solicitud_automatica" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipo_embalaje_id" UUID,
ADD COLUMN     "tipo_residuo_id" UUID,
ADD COLUMN     "tipo_sellado" VARCHAR(80),
ADD COLUMN     "updated_at" TIMESTAMPTZ NOT NULL;

-- AlterTable
ALTER TABLE "tarifas" ADD COLUMN     "metrica_id" UUID;

-- AlterTable
ALTER TABLE "cargues_masivos" ADD COLUMN     "archivo_hash" CHAR(64),
ADD COLUMN     "cliente_id" UUID,
ADD COLUMN     "delimitador" CHAR(1),
ADD COLUMN     "estado" "EstadoCargue" NOT NULL DEFAULT 'VALIDADO',
ADD COLUMN     "formato" VARCHAR(4) NOT NULL DEFAULT 'XLSX',
ADD COLUMN     "tipo_cargue" "TipoCargue";

-- CreateTable
CREATE TABLE "declaracion_sucursales" (
    "declaracion_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "declaracion_sucursales_pkey" PRIMARY KEY ("declaracion_id","sucursal_id")
);

-- CreateTable
CREATE TABLE "declaracion_disposiciones" (
    "declaracion_id" UUID NOT NULL,
    "disposicion_id" UUID NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "declaracion_disposiciones_pkey" PRIMARY KEY ("declaracion_id","disposicion_id")
);

-- CreateTable
CREATE TABLE "declaracion_riesgos" (
    "declaracion_id" UUID NOT NULL,
    "riesgo_id" UUID NOT NULL,

    CONSTRAINT "declaracion_riesgos_pkey" PRIMARY KEY ("declaracion_id","riesgo_id")
);

-- CreateTable
CREATE TABLE "declaracion_etiquetados" (
    "declaracion_id" UUID NOT NULL,
    "sistema_id" UUID NOT NULL,

    CONSTRAINT "declaracion_etiquetados_pkey" PRIMARY KEY ("declaracion_id","sistema_id")
);

-- CreateTable
CREATE TABLE "permiso_disposiciones" (
    "permiso_id" UUID NOT NULL,
    "disposicion_id" UUID NOT NULL,

    CONSTRAINT "permiso_disposiciones_pkey" PRIMARY KEY ("permiso_id","disposicion_id")
);

-- CreateTable
CREATE TABLE "categorias_declarado" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_declarado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_residuo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipos_residuo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades_negocio" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "sigla" VARCHAR(10),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unidades_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineas_servicio" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "unidad_negocio_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lineas_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metricas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,
    "abreviacion" VARCHAR(20) NOT NULL,
    "uso" "UsoMetrica" NOT NULL,
    "factor_a_kg" DECIMAL(14,6),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "metricas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disposiciones" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" TEXT,
    "soporte_legal" TEXT,
    "requiere_permiso" BOOLEAN NOT NULL DEFAULT true,
    "propia" BOOLEAN NOT NULL DEFAULT true,
    "proveedor_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "disposiciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_embalaje" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "es_otro" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipos_embalaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materiales_embalaje" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "es_otro" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "materiales_embalaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigos_clasificacion" (
    "id" UUID NOT NULL,
    "tipo" "TipoCodigoClasificacion" NOT NULL,
    "codigo" VARCHAR(10) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "codigos_clasificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riesgos" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(10) NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "riesgos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sistemas_etiquetado" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(10) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,

    CONSTRAINT "sistemas_etiquetado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipios" (
    "codigo_dane" CHAR(5) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "departamento" VARCHAR(60) NOT NULL,

    CONSTRAINT "municipios_pkey" PRIMARY KEY ("codigo_dane")
);

-- CreateIndex
CREATE INDEX "declaracion_sucursales_sucursal_id_idx" ON "declaracion_sucursales"("sucursal_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_declarado_empresa_id_codigo_key" ON "categorias_declarado"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_residuo_empresa_id_codigo_key" ON "tipos_residuo"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_negocio_empresa_id_codigo_key" ON "unidades_negocio"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "lineas_servicio_empresa_id_codigo_key" ON "lineas_servicio"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "metricas_empresa_id_codigo_key" ON "metricas"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "disposiciones_empresa_id_codigo_key" ON "disposiciones"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_embalaje_empresa_id_codigo_key" ON "tipos_embalaje"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "materiales_embalaje_empresa_id_codigo_key" ON "materiales_embalaje"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "codigos_clasificacion_codigo_key" ON "codigos_clasificacion"("codigo");

-- CreateIndex
CREATE INDEX "codigos_clasificacion_tipo_idx" ON "codigos_clasificacion"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "riesgos_codigo_key" ON "riesgos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "sistemas_etiquetado_codigo_key" ON "sistemas_etiquetado"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_cliente_id_codigo_key" ON "sucursales"("cliente_id", "codigo");

-- CreateIndex
CREATE INDEX "declaraciones_empresa_id_tipo_estado_activa_idx" ON "declaraciones"("empresa_id", "tipo", "estado", "activa");

-- CreateIndex
CREATE INDEX "declaraciones_linea_servicio_id_idx" ON "declaraciones"("linea_servicio_id");

-- CreateIndex
CREATE UNIQUE INDEX "declaraciones_empresa_id_numero_key" ON "declaraciones"("empresa_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "declaraciones_cliente_id_codigo_interno_key" ON "declaraciones"("cliente_id", "codigo_interno");

-- CreateIndex
CREATE INDEX "cargues_masivos_empresa_id_archivo_hash_idx" ON "cargues_masivos"("empresa_id", "archivo_hash");

-- AddForeignKey
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_municipio_dane_fkey" FOREIGN KEY ("municipio_dane") REFERENCES "municipios"("codigo_dane") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogo_residuos" ADD CONSTRAINT "catalogo_residuos_linea_servicio_id_fkey" FOREIGN KEY ("linea_servicio_id") REFERENCES "lineas_servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_catalogo_id_fkey" FOREIGN KEY ("catalogo_id") REFERENCES "catalogo_residuos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_declarado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_tipo_residuo_id_fkey" FOREIGN KEY ("tipo_residuo_id") REFERENCES "tipos_residuo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_linea_servicio_id_fkey" FOREIGN KEY ("linea_servicio_id") REFERENCES "lineas_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_codigo_a_id_fkey" FOREIGN KEY ("codigo_a_id") REFERENCES "codigos_clasificacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_codigo_y_id_fkey" FOREIGN KEY ("codigo_y_id") REFERENCES "codigos_clasificacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_tipo_embalaje_id_fkey" FOREIGN KEY ("tipo_embalaje_id") REFERENCES "tipos_embalaje"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_material_embalaje_id_fkey" FOREIGN KEY ("material_embalaje_id") REFERENCES "materiales_embalaje"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_metrica_densidad_id_fkey" FOREIGN KEY ("metrica_densidad_id") REFERENCES "metricas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_aprobada_por_fkey" FOREIGN KEY ("aprobada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_aceptada_por_fkey" FOREIGN KEY ("aceptada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_cargue_id_fkey" FOREIGN KEY ("cargue_id") REFERENCES "cargues_masivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_metrica_id_fkey" FOREIGN KEY ("metrica_id") REFERENCES "metricas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargues_masivos" ADD CONSTRAINT "cargues_masivos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargues_masivos" ADD CONSTRAINT "cargues_masivos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion_sucursales" ADD CONSTRAINT "declaracion_sucursales_declaracion_id_fkey" FOREIGN KEY ("declaracion_id") REFERENCES "declaraciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion_sucursales" ADD CONSTRAINT "declaracion_sucursales_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion_disposiciones" ADD CONSTRAINT "declaracion_disposiciones_declaracion_id_fkey" FOREIGN KEY ("declaracion_id") REFERENCES "declaraciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion_disposiciones" ADD CONSTRAINT "declaracion_disposiciones_disposicion_id_fkey" FOREIGN KEY ("disposicion_id") REFERENCES "disposiciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion_riesgos" ADD CONSTRAINT "declaracion_riesgos_declaracion_id_fkey" FOREIGN KEY ("declaracion_id") REFERENCES "declaraciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion_riesgos" ADD CONSTRAINT "declaracion_riesgos_riesgo_id_fkey" FOREIGN KEY ("riesgo_id") REFERENCES "riesgos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion_etiquetados" ADD CONSTRAINT "declaracion_etiquetados_declaracion_id_fkey" FOREIGN KEY ("declaracion_id") REFERENCES "declaraciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracion_etiquetados" ADD CONSTRAINT "declaracion_etiquetados_sistema_id_fkey" FOREIGN KEY ("sistema_id") REFERENCES "sistemas_etiquetado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permiso_disposiciones" ADD CONSTRAINT "permiso_disposiciones_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos_ambientales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permiso_disposiciones" ADD CONSTRAINT "permiso_disposiciones_disposicion_id_fkey" FOREIGN KEY ("disposicion_id") REFERENCES "disposiciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_declarado" ADD CONSTRAINT "categorias_declarado_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipos_residuo" ADD CONSTRAINT "tipos_residuo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_negocio" ADD CONSTRAINT "unidades_negocio_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_servicio" ADD CONSTRAINT "lineas_servicio_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_servicio" ADD CONSTRAINT "lineas_servicio_unidad_negocio_id_fkey" FOREIGN KEY ("unidad_negocio_id") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metricas" ADD CONSTRAINT "metricas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposiciones" ADD CONSTRAINT "disposiciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposiciones" ADD CONSTRAINT "disposiciones_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipos_embalaje" ADD CONSTRAINT "tipos_embalaje_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materiales_embalaje" ADD CONSTRAINT "materiales_embalaje_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

