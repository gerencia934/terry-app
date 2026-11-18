-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "TipoDeclaracion" AS ENUM ('RESIDUO', 'SERVICIO');

-- CreateEnum
CREATE TYPE "EstadoDeclaracion" AS ENUM ('BORRADOR', 'PENDIENTE', 'AUTORIZADA', 'RECHAZADA', 'INACTIVA');

-- CreateEnum
CREATE TYPE "TipoNegociacion" AS ENUM ('COBRO', 'COMPRA', 'SIN_COSTO');

-- CreateEnum
CREATE TYPE "FormaPago" AS ENUM ('CONTADO', 'CREDITO_30', 'CREDITO_60', 'CREDITO_90');

-- CreateEnum
CREATE TYPE "ClaseSolicitud" AS ENUM ('PRE', 'FORMAL');

-- CreateEnum
CREATE TYPE "Operacion" AS ENUM ('CARGA', 'DESCARGA');

-- CreateEnum
CREATE TYPE "EstadoSolicitud" AS ENUM ('PENDIENTE', 'PROGRAMADA', 'EN_CURSO', 'RECOLECTADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoParada" AS ENUM ('PENDIENTE', 'ATENDIDA', 'NO_ATENDIDA');

-- CreateEnum
CREATE TYPE "ResultadoChequeo" AS ENUM ('OK', 'NO_OK', 'NA');

-- CreateEnum
CREATE TYPE "EstadoDocumento" AS ENUM ('BORRADOR', 'EMITIDO', 'EN_TRANSITO', 'RECIBIDO', 'CERRADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "TipoActa" AS ENUM ('DISPOSICION', 'CONCILIACION', 'APROVECHAMIENTO');

-- CreateEnum
CREATE TYPE "EstadoPermiso" AS ENUM ('VIGENTE', 'POR_VENCER', 'VENCIDO', 'EN_TRAMITE');

-- CreateEnum
CREATE TYPE "UnidadMedida" AS ENUM ('KG', 'TON', 'M3', 'GAL', 'L', 'UND', 'SERVICIO');

-- CreateTable
CREATE TABLE "empresas" (
    "id" UUID NOT NULL,
    "nit" VARCHAR(15) NOT NULL,
    "razon_social" VARCHAR(200) NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rol_permisos" (
    "rol_id" UUID NOT NULL,
    "permiso_id" UUID NOT NULL,

    CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "rol_id" UUID NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "documento" VARCHAR(20) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "telefono" VARCHAR(20),
    "es_conductor" BOOLEAN NOT NULL DEFAULT false,
    "es_auxiliar" BOOLEAN NOT NULL DEFAULT false,
    "licencia_cat" VARCHAR(5),
    "licencia_vence" DATE,
    "curso_mp_vence" DATE,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMPTZ,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" VARCHAR(300),
    "ip" VARCHAR(64),
    "creada_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMPTZ NOT NULL,
    "revocada_en" TIMESTAMPTZ,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_en" TIMESTAMPTZ NOT NULL,
    "usado_en" TIMESTAMPTZ,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nit" VARCHAR(15) NOT NULL,
    "dv" CHAR(1),
    "razon_social" VARCHAR(200) NOT NULL,
    "sector" VARCHAR(60),
    "tipo_negociacion" "TipoNegociacion" NOT NULL DEFAULT 'COBRO',
    "forma_pago" "FormaPago" NOT NULL DEFAULT 'CONTADO',
    "email_facturacion" VARCHAR(150),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "campos_extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sucursales" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "zona_id" UUID,
    "nombre" VARCHAR(150) NOT NULL,
    "direccion" VARCHAR(250),
    "municipio_dane" CHAR(5),
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "registro_respel" VARCHAR(50),
    "contacto" VARCHAR(150),
    "telefono" VARCHAR(20),
    "horario" VARCHAR(100),

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nit" VARCHAR(15) NOT NULL,
    "razon_social" VARCHAR(200) NOT NULL,
    "es_destino" BOOLEAN NOT NULL DEFAULT true,
    "es_propio" BOOLEAN NOT NULL DEFAULT false,
    "licencia" VARCHAR(120),
    "municipio" VARCHAR(80),

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zonas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "color" VARCHAR(7) NOT NULL DEFAULT '#15803D',

    CONSTRAINT "zonas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bodegas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,

    CONSTRAINT "bodegas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "bodega_id" UUID,
    "placa" VARCHAR(7) NOT NULL,
    "marca" VARCHAR(40),
    "color" VARCHAR(7) NOT NULL DEFAULT '#1E7838',
    "tipo" VARCHAR(40) NOT NULL,
    "capacidad" DECIMAL(10,2) NOT NULL,
    "unidad_cap" "UnidadMedida" NOT NULL DEFAULT 'KG',
    "soat_vence" DATE,
    "rtm_vence" DATE,
    "poliza_rc_vence" DATE,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogo_items" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "color" VARCHAR(7),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "catalogo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos_ambientales" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "acto" VARCHAR(60) NOT NULL,
    "autoridad" VARCHAR(80) NOT NULL,
    "alcance" TEXT NOT NULL,
    "expedicion" DATE,
    "vence" DATE,
    "estado" "EstadoPermiso" NOT NULL DEFAULT 'VIGENTE',
    "manejos_cubiertos" TEXT[],
    "documento_url" TEXT,

    CONSTRAINT "permisos_ambientales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligaciones_permiso" (
    "id" UUID NOT NULL,
    "permiso_id" UUID NOT NULL,
    "descripcion" TEXT NOT NULL,
    "periodicidad" VARCHAR(30) NOT NULL,
    "proxima_fecha" DATE NOT NULL,
    "responsable" VARCHAR(120),
    "cumplida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "obligaciones_permiso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogo_residuos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "TipoDeclaracion" NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "corriente" VARCHAR(10),
    "peligrosidad" TEXT[],
    "numero_onu" VARCHAR(10),
    "clase_riesgo" VARCHAR(5),
    "estado_fisico" VARCHAR(10),
    "unidad" "UnidadMedida" NOT NULL DEFAULT 'KG',
    "linea_servicio_id" UUID,
    "tipo_manejo_id" UUID,

    CONSTRAINT "catalogo_residuos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaraciones" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "tipo" "TipoDeclaracion" NOT NULL,
    "cliente_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "residuo_id" UUID NOT NULL,
    "estado" "EstadoDeclaracion" NOT NULL DEFAULT 'PENDIENTE',
    "autorizacion" VARCHAR(50),
    "causal_id" UUID,
    "tipo_manejo_id" UUID,
    "destino_id" UUID,
    "embalaje_id" UUID,
    "cantidad_estimada" DECIMAL(12,2),
    "frecuencia" VARCHAR(15),
    "ficha_seguridad_url" TEXT,
    "vigente_hasta" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "declaraciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifas" (
    "id" UUID NOT NULL,
    "declaracion_id" UUID NOT NULL,
    "precio_unitario" DECIMAL(14,2) NOT NULL,
    "tipo_negociacion" "TipoNegociacion" NOT NULL,
    "forma_pago" "FormaPago" NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "vigente_hasta" DATE,
    "lote_asignacion_id" UUID,
    "asignado_por" UUID,

    CONSTRAINT "tarifas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "clase" "ClaseSolicitud" NOT NULL,
    "operacion" "Operacion" NOT NULL DEFAULT 'CARGA',
    "cliente_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "fecha_solicitada" DATE NOT NULL,
    "franja_horaria" VARCHAR(20),
    "estado" "EstadoSolicitud" NOT NULL DEFAULT 'PENDIENTE',
    "causal_cancelacion_id" UUID,
    "total_estimado" DECIMAL(14,2),
    "creado_por" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_items" (
    "id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "declaracion_id" UUID NOT NULL,
    "cantidad_estimada" DECIMAL(12,2),
    "cantidad_real" DECIMAL(12,2),
    "cantidad_embalajes" INTEGER,
    "precio_unitario" DECIMAL(14,2),

    CONSTRAINT "solicitud_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estados_recorrido" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nombre" VARCHAR(40) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "orden" INTEGER NOT NULL,
    "es_final" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "estados_recorrido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rutas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "fecha_programada" DATE NOT NULL,
    "zona_id" UUID,
    "vehiculo_id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "auxiliar_id" UUID,
    "estado_recorrido_id" UUID,
    "km_inicial" INTEGER,
    "km_final" INTEGER,
    "hora_salida" TIMESTAMPTZ,
    "hora_llegada_planta" TIMESTAMPTZ,

    CONSTRAINT "rutas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ruta_paradas" (
    "id" UUID NOT NULL,
    "ruta_id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "orden" SMALLINT NOT NULL,
    "hora_llegada" TIMESTAMPTZ,
    "lat_checkin" DECIMAL(9,6),
    "lng_checkin" DECIMAL(9,6),
    "estado" "EstadoParada" NOT NULL DEFAULT 'PENDIENTE',
    "firma_url" TEXT,
    "fotos" TEXT[],
    "observaciones" TEXT,

    CONSTRAINT "ruta_paradas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elementos_chequeo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "grupo" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "critico" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "elementos_chequeo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preoperacionales" (
    "id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "ruta_id" UUID,
    "conductor_id" UUID NOT NULL,
    "auxiliar_id" UUID,
    "fecha_programada" DATE NOT NULL,
    "fecha_real" TIMESTAMPTZ,
    "km" INTEGER,
    "aprobado" BOOLEAN,
    "observaciones" TEXT,
    "firma_url" TEXT,

    CONSTRAINT "preoperacionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preop_respuestas" (
    "preoperacional_id" UUID NOT NULL,
    "elemento_id" UUID NOT NULL,
    "resultado" "ResultadoChequeo" NOT NULL,
    "foto_url" TEXT,

    CONSTRAINT "preop_respuestas_pkey" PRIMARY KEY ("preoperacional_id","elemento_id")
);

-- CreateTable
CREATE TABLE "manifiestos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "ruta_id" UUID,
    "cliente_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "fecha_emision" TIMESTAMPTZ NOT NULL,
    "estado" "EstadoDocumento" NOT NULL DEFAULT 'EMITIDO',
    "consecutivo_rndc" VARCHAR(30),
    "pdf_url" TEXT,

    CONSTRAINT "manifiestos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifiesto_items" (
    "id" UUID NOT NULL,
    "manifiesto_id" UUID NOT NULL,
    "solicitud_item_id" UUID NOT NULL,
    "cantidad_origen" DECIMAL(12,2) NOT NULL,
    "embalajes" INTEGER,

    CONSTRAINT "manifiesto_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "tipo" "TipoActa" NOT NULL,
    "cliente_id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "periodo_desde" DATE NOT NULL,
    "periodo_hasta" DATE NOT NULL,
    "estado" "EstadoDocumento" NOT NULL DEFAULT 'BORRADOR',
    "pdf_url" TEXT,
    "certificado_url" TEXT,

    CONSTRAINT "actas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conciliacion_items" (
    "id" UUID NOT NULL,
    "acta_id" UUID NOT NULL,
    "manifiesto_item_id" UUID NOT NULL,
    "cantidad_origen" DECIMAL(12,2) NOT NULL,
    "cantidad_destino" DECIMAL(12,2) NOT NULL,
    "justificacion" TEXT,

    CONSTRAINT "conciliacion_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" UUID,
    "entidad" VARCHAR(60) NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "accion" VARCHAR(20) NOT NULL,
    "antes" JSONB,
    "despues" JSONB,
    "fecha" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargues_masivos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "plantilla" VARCHAR(40) NOT NULL,
    "archivo" VARCHAR(200) NOT NULL,
    "archivo_url" TEXT,
    "filas_leidas" INTEGER NOT NULL,
    "filas_ok" INTEGER NOT NULL,
    "filas_error" INTEGER NOT NULL,
    "errores" JSONB NOT NULL DEFAULT '[]',
    "usuario_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cargues_masivos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_nit_key" ON "empresas"("nit");

-- CreateIndex
CREATE UNIQUE INDEX "roles_empresa_id_nombre_key" ON "roles"("empresa_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_codigo_key" ON "permisos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_empresa_id_idx" ON "usuarios"("empresa_id");

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_idx" ON "sesiones"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_empresa_id_nit_key" ON "clientes"("empresa_id", "nit");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_placa_key" ON "vehiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "catalogo_items_empresa_id_tipo_codigo_key" ON "catalogo_items"("empresa_id", "tipo", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "catalogo_residuos_empresa_id_codigo_key" ON "catalogo_residuos"("empresa_id", "codigo");

-- CreateIndex
CREATE INDEX "declaraciones_empresa_id_tipo_estado_idx" ON "declaraciones"("empresa_id", "tipo", "estado");

-- CreateIndex
CREATE INDEX "declaraciones_cliente_id_idx" ON "declaraciones"("cliente_id");

-- CreateIndex
CREATE INDEX "tarifas_declaracion_id_vigente_desde_idx" ON "tarifas"("declaracion_id", "vigente_desde");

-- CreateIndex
CREATE INDEX "solicitudes_empresa_id_fecha_solicitada_idx" ON "solicitudes"("empresa_id", "fecha_solicitada");

-- CreateIndex
CREATE INDEX "rutas_fecha_programada_vehiculo_id_idx" ON "rutas"("fecha_programada", "vehiculo_id");

-- CreateIndex
CREATE UNIQUE INDEX "rutas_empresa_id_codigo_key" ON "rutas"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ruta_paradas_ruta_id_orden_key" ON "ruta_paradas"("ruta_id", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "manifiestos_empresa_id_numero_key" ON "manifiestos"("empresa_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "actas_empresa_id_numero_key" ON "actas"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "auditoria_entidad_entidad_id_idx" ON "auditoria"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "cargues_masivos_empresa_id_creado_en_idx" ON "cargues_masivos"("empresa_id", "creado_en");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zonas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zonas" ADD CONSTRAINT "zonas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bodegas" ADD CONSTRAINT "bodegas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_bodega_id_fkey" FOREIGN KEY ("bodega_id") REFERENCES "bodegas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogo_items" ADD CONSTRAINT "catalogo_items_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permisos_ambientales" ADD CONSTRAINT "permisos_ambientales_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligaciones_permiso" ADD CONSTRAINT "obligaciones_permiso_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos_ambientales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogo_residuos" ADD CONSTRAINT "catalogo_residuos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogo_residuos" ADD CONSTRAINT "catalogo_residuos_linea_servicio_id_fkey" FOREIGN KEY ("linea_servicio_id") REFERENCES "catalogo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogo_residuos" ADD CONSTRAINT "catalogo_residuos_tipo_manejo_id_fkey" FOREIGN KEY ("tipo_manejo_id") REFERENCES "catalogo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_residuo_id_fkey" FOREIGN KEY ("residuo_id") REFERENCES "catalogo_residuos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_causal_id_fkey" FOREIGN KEY ("causal_id") REFERENCES "catalogo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_tipo_manejo_id_fkey" FOREIGN KEY ("tipo_manejo_id") REFERENCES "catalogo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_embalaje_id_fkey" FOREIGN KEY ("embalaje_id") REFERENCES "catalogo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaraciones" ADD CONSTRAINT "declaraciones_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_declaracion_id_fkey" FOREIGN KEY ("declaracion_id") REFERENCES "declaraciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_asignado_por_fkey" FOREIGN KEY ("asignado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_causal_cancelacion_id_fkey" FOREIGN KEY ("causal_cancelacion_id") REFERENCES "catalogo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_items" ADD CONSTRAINT "solicitud_items_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_items" ADD CONSTRAINT "solicitud_items_declaracion_id_fkey" FOREIGN KEY ("declaracion_id") REFERENCES "declaraciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estados_recorrido" ADD CONSTRAINT "estados_recorrido_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zonas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_auxiliar_id_fkey" FOREIGN KEY ("auxiliar_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_estado_recorrido_id_fkey" FOREIGN KEY ("estado_recorrido_id") REFERENCES "estados_recorrido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_paradas" ADD CONSTRAINT "ruta_paradas_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_paradas" ADD CONSTRAINT "ruta_paradas_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elementos_chequeo" ADD CONSTRAINT "elementos_chequeo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_auxiliar_id_fkey" FOREIGN KEY ("auxiliar_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preop_respuestas" ADD CONSTRAINT "preop_respuestas_preoperacional_id_fkey" FOREIGN KEY ("preoperacional_id") REFERENCES "preoperacionales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preop_respuestas" ADD CONSTRAINT "preop_respuestas_elemento_id_fkey" FOREIGN KEY ("elemento_id") REFERENCES "elementos_chequeo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_manifiesto_id_fkey" FOREIGN KEY ("manifiesto_id") REFERENCES "manifiestos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_solicitud_item_id_fkey" FOREIGN KEY ("solicitud_item_id") REFERENCES "solicitud_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas" ADD CONSTRAINT "actas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas" ADD CONSTRAINT "actas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas" ADD CONSTRAINT "actas_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacion_items" ADD CONSTRAINT "conciliacion_items_acta_id_fkey" FOREIGN KEY ("acta_id") REFERENCES "actas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacion_items" ADD CONSTRAINT "conciliacion_items_manifiesto_item_id_fkey" FOREIGN KEY ("manifiesto_item_id") REFERENCES "manifiesto_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

