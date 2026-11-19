-- =====================================================================
-- Módulo Declaraciones — migración ABIERTA: sirve con la base vacía o con
-- datos de la fase 1. Con datos, los convierte al modelo nuevo sin perder
-- información (ver bloque «Conversión 2/3» antes de las llaves foráneas).
-- Conversión 1/3: respaldo de lo que esta migración elimina o cambia.
-- =====================================================================
CREATE TABLE "_conv_decl" AS
SELECT d.id, d.empresa_id, d.cliente_id, d.numero, d.tipo::text AS tipo, d.estado::text AS estado, d.sucursal_id, d.residuo_id,
       d.frecuencia, d.cantidad_estimada, d.autorizacion,
       r.codigo AS residuo_codigo, r.nombre AS residuo_nombre, r.corriente, COALESCE(r.peligrosidad, '{}') AS peligrosidad,
       r.estado_fisico, r.numero_onu, r.unidad::text AS unidad,
       COALESCE(m.codigo, mr.codigo) AS manejo, l.nombre AS linea, e.nombre AS embalaje, p.razon_social AS destino
  FROM declaraciones d
  JOIN catalogo_residuos r ON r.id = d.residuo_id
  LEFT JOIN catalogo_items m  ON m.id  = d.tipo_manejo_id
  LEFT JOIN catalogo_items mr ON mr.id = r.tipo_manejo_id
  LEFT JOIN catalogo_items l  ON l.id  = r.linea_servicio_id
  LEFT JOIN catalogo_items e  ON e.id  = d.embalaje_id
  LEFT JOIN proveedores p     ON p.id  = d.destino_id;

CREATE TABLE "_conv_residuos" AS
SELECT r.id, r.empresa_id, l.nombre AS linea,
       jsonb_strip_nulls(jsonb_build_object('faseAnterior', jsonb_build_object('corriente', r.corriente, 'peligrosidad', r.peligrosidad,
         'numeroOnu', r.numero_onu, 'claseRiesgo', r.clase_riesgo, 'estadoFisico', r.estado_fisico, 'unidad', r.unidad::text, 'manejo', m.codigo))) AS valores
  FROM catalogo_residuos r
  LEFT JOIN catalogo_items l ON l.id = r.linea_servicio_id
  LEFT JOIN catalogo_items m ON m.id = r.tipo_manejo_id;

CREATE TABLE "_conv_manejos"  AS SELECT empresa_id, codigo, nombre, meta FROM catalogo_items WHERE tipo = 'TIPO_MANEJO';
CREATE TABLE "_conv_permisos" AS SELECT id, empresa_id, COALESCE(manejos_cubiertos, '{}') AS manejos FROM permisos_ambientales;
CREATE TABLE "_conv_sedes"    AS SELECT id, horario FROM sucursales WHERE COALESCE(TRIM(horario), '') <> '';

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
-- INACTIVA deja de ser un estado: pasa a AUTORIZADA con activa = false (conversión 2/3).
ALTER TABLE "declaraciones" ALTER COLUMN "estado" TYPE "EstadoDeclaracion_new" USING ((CASE WHEN "estado"::text = 'INACTIVA' THEN 'AUTORIZADA' ELSE "estado"::text END)::"EstadoDeclaracion_new");
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
ADD COLUMN     "categoria_id" UUID, -- NOT NULL al final, después de convertir
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
ADD COLUMN     "linea_servicio_id" UUID, -- NOT NULL al final
ADD COLUMN     "material_embalaje_id" UUID,
ADD COLUMN     "metrica_densidad_id" UUID,
ADD COLUMN     "mostrar_precio_app" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nombre" VARCHAR(200), -- NOT NULL al final
ADD COLUMN     "observaciones" TEXT,
ADD COLUMN     "olor" VARCHAR(120),
ADD COLUMN     "origen_fase1" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "otro_material" VARCHAR(80),
ADD COLUMN     "otro_tipo_embalaje" VARCHAR(80),
ADD COLUMN     "presentacion" VARCHAR(60),
ADD COLUMN     "responsabilidad_aceptada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serial" VARCHAR(60),
ADD COLUMN     "solicitud_automatica" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipo_embalaje_id" UUID,
ADD COLUMN     "tipo_residuo_id" UUID,
ADD COLUMN     "tipo_sellado" VARCHAR(80),
ADD COLUMN     "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP; -- el DEFAULT se quita al final (Prisma lo maneja)

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

-- =====================================================================
-- Conversión 2/3: catálogos mínimos y traslado de los datos de la fase 1.
-- Solo actúa en empresas que ya tenían datos: con la base vacía no inserta nada.
-- Usa los mismos códigos del seed, que después completa nombres y demás catálogos.
-- =====================================================================
CREATE TABLE "_conv_empresas" AS
SELECT DISTINCT empresa_id AS id FROM (
  SELECT empresa_id FROM "_conv_decl" UNION SELECT empresa_id FROM "_conv_residuos"
  UNION SELECT empresa_id FROM "_conv_manejos" UNION SELECT empresa_id FROM "_conv_permisos" WHERE manejos <> '{}') x;

-- Equivalencias: manejo de la fase 1 → disposición (los demás conservan su código);
-- línea de la fase 1 → código de línea (las no listadas van a la 01, para revisar).
CREATE TABLE "_conv_mapa_manejo" (viejo TEXT PRIMARY KEY, nuevo TEXT NOT NULL);
INSERT INTO "_conv_mapa_manejo" VALUES ('ESC', 'RCD'), ('INC', 'INCH'), ('CEL', 'DF'), ('TRANS', 'TRA');
CREATE TABLE "_conv_mapa_linea" (viejo TEXT PRIMARY KEY, nuevo TEXT NOT NULL);
INSERT INTO "_conv_mapa_linea" VALUES ('rcd', '03'), ('hospitalarios y biomedicos', '02'), ('aprovechables', '08'),
  ('paisajismo', '05'), ('manejo integrado de plagas', '06'), ('lavado de tanques', '11'), ('unidades sanitarias portatiles', '12');

INSERT INTO categorias_declarado (id, empresa_id, codigo, nombre)
SELECT gen_random_uuid(), e.id, v.codigo, v.nombre FROM "_conv_empresas" e CROSS JOIN (VALUES
  ('RESPEL', 'Residuos peligrosos'), ('NOPEL', 'Residuos no peligrosos'), ('APROV', 'Aprovechables'),
  ('ESPEC', 'Especiales (RCD, ACU, posconsumo)'), ('SERV', 'Servicios')) v(codigo, nombre)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO unidades_negocio (id, empresa_id, codigo, nombre, sigla)
SELECT gen_random_uuid(), e.id, v.codigo, v.nombre, v.sigla FROM "_conv_empresas" e CROSS JOIN (VALUES
  ('01', 'Tratamiento de residuos', 'TTR'), ('02', 'Transporte', 'TPT'), ('03', 'Fumigación', 'FUM'),
  ('04', 'Obras civiles', 'CIV'), ('05', 'Aprovechamiento', 'APR'), ('11', 'Mantenimiento hidrosanitario', NULL)) v(codigo, nombre, sigla)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO lineas_servicio (id, empresa_id, unidad_negocio_id, codigo, nombre)
SELECT gen_random_uuid(), e.id, u.id, v.codigo, v.nombre FROM "_conv_empresas" e CROSS JOIN (VALUES
  ('01', '01', 'Operaciones propias de tratamiento y disposición'), ('02', '01', 'Tratamiento y disposición externa (tercerizada)'),
  ('03', '01', 'Gestión y disposición de residuos de construcción'), ('04', '02', 'Transporte de residuos y materiales peligrosos'),
  ('05', '04', 'Ejecución de obras civiles y ambientales'), ('06', '03', 'Saneamiento y fumigación especializada'),
  ('07', '05', 'Venta de aprovechables'), ('08', '05', 'Compra y retoma de materiales reciclables'),
  ('09', '01', 'Servicios especiales de gestión y limpieza'), ('10', '05', 'Lodos de procesos industriales de preparación de alimentos'),
  ('11', '11', 'Lavado de tanque'), ('12', '01', 'Mantenimiento de unidades sanitarias portátiles'),
  ('15', '11', 'Hidrolimpieza técnica de cajas'), ('19', '11', 'Mantenimiento preventivo con hidrolavadora'), ('20', '01', 'Isotanques')
  ) v(codigo, unidad, nombre)
  JOIN unidades_negocio u ON u.empresa_id = e.id AND u.codigo = v.unidad
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO metricas (id, empresa_id, codigo, nombre, abreviacion, uso, factor_a_kg)
SELECT gen_random_uuid(), e.id, v.codigo, v.nombre, v.abreviacion, 'PRECIO', v.factor FROM "_conv_empresas" e CROSS JOIN (VALUES
  ('kg', 'Kilogramo', 'kg', 1::numeric), ('ton', 'Tonelada', 'ton', 1000), ('m3', 'Metro cúbico', 'm³', NULL), ('gal', 'Galón', 'gal', NULL),
  ('L', 'Litro', 'L', NULL), ('und', 'Unidad', 'und', NULL), ('viaje', 'Viaje', 'viaje', NULL)) v(codigo, nombre, abreviacion, factor)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO disposiciones (id, empresa_id, codigo, nombre, requiere_permiso, propia, soporte_legal)
SELECT gen_random_uuid(), e.id, v.codigo, v.nombre, v.requiere, v.propia, v.soporte FROM "_conv_empresas" e CROSS JOIN (VALUES
  ('APR', 'Aprovechamiento', false, true, 'Objeto social — Certificado de existencia y representación legal'),
  ('REC', 'Reciclaje o valorización', false, true, 'Objeto social — Certificado de existencia y representación legal'),
  ('BIO', 'Biorremediación (landfarming)', true, true, 'Res. CAS 0632-2023'),
  ('ASP', 'Tratamiento y vertimiento a suelo de aguas residuales, lodos, cortes y salmueras', true, true, 'Res. CAS 0632-2023'),
  ('RCD', 'Gestión integral de RCD (aprovechamiento y disposición final)', true, true, 'Res. CAS 0235-2024'),
  ('ACU', 'Aprovechamiento de ACU (biodiésel)', true, true, 'OF-311-21 y Res. CAS 316 de 2018'),
  ('TRA', 'Transporte de RESPEL, hidrocarburos y sustancias nocivas', true, true, 'Auto SAA 0244-21 (Plan de contingencia)'),
  ('LAV', 'Lavado y reúso', true, true, 'VERIFICAR'),
  ('INCH', 'Incineración (hospitalarios y similares)', true, false, 'Res. 0144 de 2000 CDMB (gestor aliado)'),
  ('INCO', 'Incineración y celda ordinaria', true, false, 'Res. 0144 de 2000 CDMB (gestor aliado)'),
  ('RS', 'Relleno sanitario', true, false, 'Res. CAS 0001121 de 2014 (gestor aliado)'),
  ('COP', 'Coprocesamiento', true, false, 'Licencia del gestor aliado'),
  ('DES', 'Desensamble y aprovechamiento (RAEE)', true, false, 'Licencia del gestor aliado'),
  ('DF', 'Disposición final (celda de seguridad)', true, false, 'Licencia del gestor aliado'),
  ('POS', 'Posconsumo', true, false, 'Programa posconsumo del fabricante')) v(codigo, nombre, requiere, propia, soporte)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Manejos de la fase 1 sin equivalente (p. ej. FQ, REG): se conservan como disposición con su código y nombre.
INSERT INTO disposiciones (id, empresa_id, codigo, nombre, requiere_permiso, propia, soporte_legal)
SELECT gen_random_uuid(), m.empresa_id, m.codigo, LEFT(m.nombre, 150),
       COALESCE(m.meta ->> 'requierePermiso', 'true') <> 'false', COALESCE(m.meta ->> 'propio', 'true') <> 'false', 'Convertida de la fase 1: VERIFICAR'
  FROM "_conv_manejos" m
 WHERE m.codigo <> 'SRV' AND NOT EXISTS (SELECT 1 FROM "_conv_mapa_manejo" x WHERE x.viejo = m.codigo)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Permisos: manejos_cubiertos (texto) → permiso_disposiciones
INSERT INTO permiso_disposiciones (permiso_id, disposicion_id)
SELECT p.id, d.id
  FROM "_conv_permisos" p CROSS JOIN LATERAL unnest(p.manejos) AS m(codigo)
  LEFT JOIN "_conv_mapa_manejo" x ON x.viejo = m.codigo
  JOIN disposiciones d ON d.empresa_id = p.empresa_id AND d.codigo = COALESCE(x.nuevo, m.codigo)
ON CONFLICT DO NOTHING;

-- Catálogos normativos usados por los datos anteriores
INSERT INTO riesgos (id, codigo, nombre)
SELECT gen_random_uuid(), v.codigo, v.nombre FROM (VALUES ('C', 'Corrosivo'), ('R', 'Reactivo'), ('E', 'Explosivo'), ('T', 'Tóxico'),
  ('I', 'Inflamable'), ('B', 'Biológico-infeccioso'), ('RAD', 'Radiactivo')) v(codigo, nombre)
 WHERE EXISTS (SELECT 1 FROM "_conv_decl")
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO codigos_clasificacion (id, tipo, codigo, descripcion)
SELECT gen_random_uuid(), LEFT(c, 1)::"TipoCodigoClasificacion", c, 'Descripción por completar (dato de la fase 1)'
  FROM (SELECT DISTINCT UPPER(TRIM(corriente)) AS c FROM "_conv_decl") x
 WHERE c ~ '^Y([1-9]|[1-3][0-9]|4[0-5])$' OR c ~ '^A[1-4][0-9]{3}$'
ON CONFLICT (codigo) DO NOTHING;
-- Municipios ya usados en sedes (la FK a la lista DIVIPOLA no debe rechazarlos; el seed completa los nombres conocidos)
INSERT INTO municipios (codigo_dane, nombre, departamento)
SELECT DISTINCT municipio_dane, 'Por completar', 'Por completar' FROM sucursales WHERE municipio_dane IS NOT NULL
ON CONFLICT (codigo_dane) DO NOTHING;

-- Sedes: horario (texto) → observaciones; la sede con más declaraciones queda como principal
UPDATE sucursales s SET observaciones = 'Horario: ' || h.horario FROM "_conv_sedes" h WHERE h.id = s.id;
UPDATE sucursales s SET es_principal = true
  FROM (SELECT DISTINCT ON (s2.cliente_id) s2.id FROM sucursales s2
          LEFT JOIN "_conv_decl" c ON c.sucursal_id = s2.id
         GROUP BY s2.id, s2.cliente_id, s2.nombre
         ORDER BY s2.cliente_id, COUNT(c.id) DESC, s2.nombre) p
 WHERE p.id = s.id AND NOT EXISTS (SELECT 1 FROM sucursales x WHERE x.cliente_id = s.cliente_id AND x.es_principal);

-- Catálogo de residuos: línea vieja → línea nueva; columnas eliminadas → «valores» (no se pierde nada)
UPDATE catalogo_residuos r SET valores = cr.valores,
       linea_servicio_id = CASE WHEN cr.linea IS NULL THEN NULL ELSE (
         SELECT l.id FROM lineas_servicio l WHERE l.empresa_id = cr.empresa_id AND l.codigo = COALESCE(
           (SELECT x.nuevo FROM "_conv_mapa_linea" x WHERE x.viejo = lower(trim(translate(cr.linea, 'ÁÉÍÓÚÜáéíóúüÑñ', 'AEIOUUaeiouuNn')))), '01')) END
  FROM "_conv_residuos" cr WHERE cr.id = r.id;

-- Declaraciones: una por cada declaración anterior (se conservan id, número, tarifas y solicitudes).
-- Si el mismo código se repetía en varias sedes del cliente, las siguientes llevan sufijo (-2, -3…).
UPDATE declaraciones d SET
  nombre = c.residuo_nombre,
  codigo_interno = CASE WHEN c.n = 1 THEN c.residuo_codigo ELSE LEFT(c.residuo_codigo, 35) || '-' || c.n END,
  catalogo_id = c.residuo_id,
  categoria_id = (SELECT k.id FROM categorias_declarado k WHERE k.empresa_id = c.empresa_id AND k.codigo =
    CASE WHEN c.tipo = 'SERVICIO' THEN 'SERV' WHEN cardinality(c.peligrosidad) > 0 THEN 'RESPEL'
         WHEN c.manejo = 'APR' THEN 'APROV' WHEN c.manejo IN ('ESC', 'ACU') THEN 'ESPEC' ELSE 'NOPEL' END),
  linea_servicio_id = (SELECT l.id FROM lineas_servicio l WHERE l.empresa_id = c.empresa_id AND l.codigo = COALESCE(
    (SELECT x.nuevo FROM "_conv_mapa_linea" x WHERE x.viejo = lower(trim(translate(c.linea, 'ÁÉÍÓÚÜáéíóúüÑñ', 'AEIOUUaeiouuNn')))), '01')),
  es_peligroso = cardinality(c.peligrosidad) > 0,
  inflamable = CASE WHEN c.tipo = 'RESIDUO' THEN 'I' = ANY (c.peligrosidad) END,
  codigo_y_id = (SELECT k.id FROM codigos_clasificacion k WHERE k.tipo = 'Y' AND k.codigo = UPPER(TRIM(c.corriente))),
  codigo_a_id = (SELECT k.id FROM codigos_clasificacion k WHERE k.tipo = 'A' AND k.codigo = UPPER(TRIM(c.corriente))),
  codigo_un = CASE WHEN UPPER(REPLACE(c.numero_onu, ' ', '')) ~ '^UN[0-9]{4}$' THEN UPPER(REPLACE(c.numero_onu, ' ', ''))
                   WHEN TRIM(c.numero_onu) ~ '^[0-9]{4}$' THEN 'UN' || TRIM(c.numero_onu) END,
  estado_fisico = (CASE LEFT(lower(translate(c.estado_fisico, 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')), 4)
                     WHEN 'soli' THEN 'SOLIDO' WHEN 'semi' THEN 'SEMISOLIDO' WHEN 'liqu' THEN 'LIQUIDO' WHEN 'gase' THEN 'GASEOSO' END)::"EstadoFisico",
  frecuencia_dias = CASE lower(TRIM(c.frecuencia)) WHEN 'diaria' THEN 1 WHEN 'semanal' THEN 7 WHEN 'quincenal' THEN 15
                      WHEN 'mensual' THEN 30 WHEN 'bimestral' THEN 60 WHEN 'trimestral' THEN 90 END,
  cantidad_frecuencia = CASE WHEN c.cantidad_estimada > 0 THEN c.cantidad_estimada END,
  activa = (c.estado = 'AUTORIZADA'), -- las INACTIVA quedan AUTORIZADA y activa = false
  origen_fase1 = true,
  datos_extras = concat_ws(E'\n', 'Convertida de la fase 1. Complete los datos nuevos antes de modificarla.',
    'Autorización anterior: ' || c.autorizacion, 'Estado anterior: ' || NULLIF(c.estado, d.estado::text), 'Embalaje: ' || c.embalaje,
    'Destino: ' || c.destino, 'Frecuencia: ' || c.frecuencia, CASE WHEN c.n > 1 THEN 'Código interno original: ' || c.residuo_codigo END)
  FROM (SELECT cd.*, ROW_NUMBER() OVER (PARTITION BY cd.cliente_id, UPPER(cd.residuo_codigo) ORDER BY cd.numero) AS n FROM "_conv_decl" cd) c
 WHERE c.id = d.id;

INSERT INTO declaracion_sucursales (declaracion_id, sucursal_id)
SELECT id, sucursal_id FROM "_conv_decl" ON CONFLICT DO NOTHING;

INSERT INTO declaracion_disposiciones (declaracion_id, disposicion_id, principal)
SELECT c.id, d.id, true
  FROM "_conv_decl" c
  LEFT JOIN "_conv_mapa_manejo" x ON x.viejo = c.manejo
  JOIN disposiciones d ON d.empresa_id = c.empresa_id AND d.codigo = COALESCE(x.nuevo, c.manejo)
 WHERE c.tipo = 'RESIDUO' AND c.manejo IS NOT NULL AND c.manejo <> 'SRV'
ON CONFLICT DO NOTHING;

INSERT INTO declaracion_riesgos (declaracion_id, riesgo_id)
SELECT c.id, r.id FROM "_conv_decl" c CROSS JOIN LATERAL unnest(c.peligrosidad) AS p(codigo) JOIN riesgos r ON r.codigo = p.codigo
ON CONFLICT DO NOTHING;

-- Tarifas: la unidad del residuo pasa a ser la métrica del precio
UPDATE tarifas t SET metrica_id = m.id
  FROM "_conv_decl" c
  JOIN metricas m ON m.empresa_id = c.empresa_id AND m.codigo = CASE c.unidad WHEN 'KG' THEN 'kg' WHEN 'TON' THEN 'ton' WHEN 'M3' THEN 'm3'
                                                                  WHEN 'GAL' THEN 'gal' WHEN 'L' THEN 'L' WHEN 'UND' THEN 'und' END
 WHERE t.declaracion_id = c.id;

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

-- =====================================================================
-- Conversión 3/3: columnas ya llenas pasan a obligatorias; se borra el respaldo.
-- =====================================================================
ALTER TABLE "declaraciones"
  ALTER COLUMN "nombre" SET NOT NULL,
  ALTER COLUMN "categoria_id" SET NOT NULL,
  ALTER COLUMN "linea_servicio_id" SET NOT NULL,
  ALTER COLUMN "updated_at" DROP DEFAULT;

DROP TABLE "_conv_decl", "_conv_residuos", "_conv_manejos", "_conv_permisos", "_conv_sedes",
           "_conv_empresas", "_conv_mapa_manejo", "_conv_mapa_linea";

