-- =====================================================================
-- TERRY-GO · Fase 3-A — Núcleo operativo:
-- Solicitud → Ruta (+ inspección) → Manifiesto → Conciliación → Acta.
-- Migración ABIERTA: funciona con la base vacía o con datos anteriores, que convierte.
-- Las reglas de cambio de estado están en la migración «operacion_reglas».
-- Detalle y decisiones: docs/operacion/MODELO_OPERACION.md
-- =====================================================================

-- CreateEnum
CREATE TYPE "AprobacionSolicitud" AS ENUM ('PENDIENTE', 'APROBADA', 'NO_APROBADA');

-- CreateEnum
CREATE TYPE "EstadoItemSolicitud" AS ENUM ('PENDIENTE', 'PROGRAMADO', 'REALIZADO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "Jornada" AS ENUM ('AM', 'PM', 'DIA');

-- CreateEnum
CREATE TYPE "TipoSeguridadSocial" AS ENUM ('ARL', 'EPS');

-- CreateEnum
CREATE TYPE "TipoManifiesto" AS ENUM ('CARGUE', 'DESCARGUE');

-- CreateEnum
CREATE TYPE "EstadoManifiesto" AS ENUM ('PENDIENTE', 'REALIZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "TipoConciliacion" AS ENUM ('INTERNA', 'EXTERNA');

-- CreateEnum
CREATE TYPE "TipoEvidencia" AS ENUM ('FOTO', 'PDF');

-- CreateEnum
CREATE TYPE "EstadoConciliacion" AS ENUM ('BORRADOR', 'APROBADA');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PENDIENTE', 'ABONADA', 'PAGADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "EstadoActa" AS ENUM ('BORRADOR', 'EMITIDA', 'ANULADA');

-- CreateEnum
CREATE TYPE "OrigenActa" AS ENUM ('GENERADA', 'CARGADA');

-- DropForeignKey
ALTER TABLE "conciliacion_items" DROP CONSTRAINT "conciliacion_items_acta_id_fkey";

-- DropForeignKey
ALTER TABLE "manifiesto_items" DROP CONSTRAINT "manifiesto_items_solicitud_item_id_fkey";

-- DropForeignKey
ALTER TABLE "manifiestos" DROP CONSTRAINT "manifiestos_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "manifiestos" DROP CONSTRAINT "manifiestos_sucursal_id_fkey";

-- DropForeignKey
ALTER TABLE "manifiestos" DROP CONSTRAINT "manifiestos_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "ruta_paradas" DROP CONSTRAINT "ruta_paradas_solicitud_id_fkey";

-- DropForeignKey
ALTER TABLE "rutas" DROP CONSTRAINT "rutas_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "rutas" DROP CONSTRAINT "rutas_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "solicitudes" DROP CONSTRAINT "solicitudes_sucursal_id_fkey";


-- ---------- Tablas nuevas ----------
-- CreateTable
CREATE TABLE "especificaciones_adicionales" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "abreviatura" VARCHAR(10),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "especificaciones_adicionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_item_especificaciones" (
    "solicitud_item_id" UUID NOT NULL,
    "especificacion_id" UUID NOT NULL,

    CONSTRAINT "solicitud_item_especificaciones_pkey" PRIMARY KEY ("solicitud_item_id","especificacion_id")
);

-- CreateTable
CREATE TABLE "entidades_seguridad_social" (
    "id" UUID NOT NULL,
    "tipo" "TipoSeguridadSocial" NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "nit" VARCHAR(15),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "entidades_seguridad_social_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transportes_terceros" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "empresa_transportadora" VARCHAR(200) NOT NULL,
    "tipo_vehiculo" VARCHAR(40),
    "placa" VARCHAR(7),
    "conductor_nombre" VARCHAR(150),
    "conductor_documento" VARCHAR(20),
    "conductor_arl_id" UUID,
    "conductor_eps_id" UUID,
    "auxiliar_nombre" VARCHAR(150),
    "auxiliar_documento" VARCHAR(20),
    "auxiliar_arl_id" UUID,
    "auxiliar_eps_id" UUID,
    "telefono" VARCHAR(20),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transportes_terceros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consecutivos" (
    "empresa_id" UUID NOT NULL,
    "documento" VARCHAR(20) NOT NULL,
    "prefijo" VARCHAR(10) NOT NULL DEFAULT '',
    "digitos" SMALLINT NOT NULL DEFAULT 5,
    "reinicio_anual" BOOLEAN NOT NULL DEFAULT true,
    "anio" SMALLINT NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "consecutivos_pkey" PRIMARY KEY ("empresa_id","documento")
);

-- CreateTable
CREATE TABLE "ruta_items" (
    "id" UUID NOT NULL,
    "ruta_id" UUID NOT NULL,
    "parada_id" UUID NOT NULL,
    "solicitud_item_id" UUID NOT NULL,
    "liberado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ruta_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ruta_rastreo" (
    "id" BIGSERIAL NOT NULL,
    "ruta_id" UUID NOT NULL,
    "vehiculo_id" UUID,
    "latitud" DECIMAL(9,6) NOT NULL,
    "longitud" DECIMAL(9,6) NOT NULL,
    "precision_m" DECIMAL(7,1),
    "velocidad_kmh" DECIMAL(5,1),
    "registrado_en" TIMESTAMPTZ NOT NULL,
    "recibido_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ruta_rastreo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifiesto_item_especificaciones" (
    "manifiesto_item_id" UUID NOT NULL,
    "especificacion_id" UUID NOT NULL,

    CONSTRAINT "manifiesto_item_especificaciones_pkey" PRIMARY KEY ("manifiesto_item_id","especificacion_id")
);

-- CreateTable
CREATE TABLE "manifiesto_evidencias" (
    "id" UUID NOT NULL,
    "manifiesto_id" UUID NOT NULL,
    "tipo" "TipoEvidencia" NOT NULL,
    "url" TEXT NOT NULL,
    "nombre_archivo" VARCHAR(200),
    "bytes" INTEGER,
    "tomada_en" TIMESTAMPTZ,
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "subida_por" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifiesto_evidencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conciliaciones" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "manifiesto_id" UUID NOT NULL,
    "estado" "EstadoConciliacion" NOT NULL DEFAULT 'BORRADOR',
    "aprobada_por" UUID,
    "aprobada_en" TIMESTAMPTZ,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conciliaciones_pkey" PRIMARY KEY ("id")
);


-- =====================================================================
-- Tablas existentes: cambios con conversión de datos (migración abierta).
-- Con la base vacía, los UPDATE e INSERT de conversión no afectan filas.
-- =====================================================================

-- ---------- Maestros ----------
ALTER TABLE "clientes" ADD COLUMN "asesor_id" UUID;
ALTER TABLE "usuarios" ADD COLUMN "arl_id" UUID, ADD COLUMN "eps_id" UUID;
ALTER TABLE "vehiculos" ADD COLUMN "proveedor_id" UUID, ADD COLUMN "volumen_m3" DECIMAL(8,2);
ALTER TABLE "proveedores" ADD COLUMN "es_transportador" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "estados_recorrido"
  ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cancela" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "descripcion" VARCHAR(200),
  ADD COLUMN "rastreo" BOOLEAN NOT NULL DEFAULT false;
-- Conversión: la etapa final «Cancelada» de la fase 1 cancela la ruta
UPDATE estados_recorrido SET cancela = true WHERE es_final AND lower(nombre) LIKE 'cancel%';

-- ---------- Solicitudes: aprobación y sede por línea ----------
ALTER TABLE "solicitudes"
  ADD COLUMN "adjunto_url" TEXT,
  ADD COLUMN "aprobacion" "AprobacionSolicitud" NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "aprobada_en" TIMESTAMPTZ,
  ADD COLUMN "aprobada_por" UUID,
  ADD COLUMN "destino_id" UUID,
  ADD COLUMN "fecha_activacion" DATE,
  ADD COLUMN "manifiesto_origen_id" UUID,
  ADD COLUMN "notificar_cliente" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "observaciones" TEXT,
  ADD COLUMN "orden_compra" VARCHAR(40),
  ADD COLUMN "telefono_contacto" VARCHAR(20),
  ADD COLUMN "transporte_id" UUID;
-- Conversión: las solicitudes de la fase 1 ya estaban en operación ⇒ aprobadas
UPDATE solicitudes SET aprobacion = 'APROBADA', aprobada_en = created_at;

ALTER TABLE "solicitud_items"
  ADD COLUMN "causal_descarte_id" UUID,
  ADD COLUMN "estado" "EstadoItemSolicitud" NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "jornada" "Jornada",
  ADD COLUMN "observaciones" VARCHAR(300),
  ADD COLUMN "sucursal_id" UUID; -- NOT NULL después de convertir
-- Conversión: la sede de la solicitud pasa a cada línea; el avance de la línea sale del estado de la solicitud
UPDATE solicitud_items i SET
  sucursal_id = s.sucursal_id,
  estado = (CASE s.estado WHEN 'RECOLECTADA' THEN 'REALIZADO' WHEN 'PROGRAMADA' THEN 'PROGRAMADO' WHEN 'EN_CURSO' THEN 'PROGRAMADO'
                          WHEN 'CANCELADA' THEN 'DESCARTADO' ELSE 'PENDIENTE' END)::"EstadoItemSolicitud",
  causal_descarte_id = CASE WHEN s.estado = 'CANCELADA' THEN s.causal_cancelacion_id END,
  jornada = (CASE upper(TRIM(s.franja_horaria)) WHEN 'AM' THEN 'AM' WHEN 'PM' THEN 'PM' END)::"Jornada"
  FROM solicitudes s WHERE s.id = i.solicitud_id;
ALTER TABLE "solicitud_items" ALTER COLUMN "sucursal_id" SET NOT NULL;

-- ---------- Paradas por sede y programación por línea ----------
ALTER TABLE "ruta_paradas" ADD COLUMN "sucursal_id" UUID; -- NOT NULL después de convertir
UPDATE ruta_paradas p SET
  sucursal_id = s.sucursal_id,
  observaciones = NULLIF(concat_ws(E'\n', p.observaciones, 'Firma (fase 1): ' || p.firma_url,
                    CASE WHEN cardinality(p.fotos) > 0 THEN 'Fotos (fase 1): ' || array_to_string(p.fotos, ', ') END), '')
  FROM solicitudes s WHERE s.id = p.solicitud_id;
-- Cada línea de la solicitud de la parada queda programada en esa parada.
-- Una línea solo puede quedar vigente en una ruta: la más reciente que no esté cancelada.
INSERT INTO ruta_items (id, ruta_id, parada_id, solicitud_item_id, liberado, created_at)
SELECT gen_random_uuid(), x.ruta_id, x.parada_id, x.item_id, x.cancelada OR x.n > 1, CURRENT_TIMESTAMP
  FROM (SELECT p.ruta_id, p.id AS parada_id, i.id AS item_id, COALESCE(e.cancela, false) AS cancelada,
               ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY COALESCE(e.cancela, false), r.fecha_programada DESC, p.id) AS n
          FROM ruta_paradas p
          JOIN rutas r ON r.id = p.ruta_id
          LEFT JOIN estados_recorrido e ON e.id = r.estado_recorrido_id
          JOIN solicitud_items i ON i.solicitud_id = p.solicitud_id) x;
ALTER TABLE "ruta_paradas" DROP COLUMN "firma_url", DROP COLUMN "fotos", DROP COLUMN "solicitud_id",
  ALTER COLUMN "sucursal_id" SET NOT NULL;
ALTER TABLE "solicitudes" DROP COLUMN "sucursal_id";

-- ---------- Rutas ----------
ALTER TABLE "rutas"
  ADD COLUMN "frecuencia_dias" INTEGER,
  ADD COLUMN "hora_programada" TIME(0),
  ADD COLUMN "interna" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "observaciones" TEXT,
  ADD COLUMN "recurrente_activa" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ruta_base_id" UUID,
  ADD COLUMN "valor_flete" DECIMAL(14,2),
  ALTER COLUMN "vehiculo_id" DROP NOT NULL,
  ALTER COLUMN "conductor_id" DROP NOT NULL;

-- ---------- Inspección del vehículo ----------
ALTER TABLE "preop_respuestas" ADD COLUMN "observacion" VARCHAR(300);
ALTER TABLE "preoperacionales" ADD COLUMN "numero" VARCHAR(20) NOT NULL DEFAULT ''; -- se llena en «operacion_reglas»

-- ---------- Manifiestos ----------
ALTER TABLE "manifiestos"
  ADD COLUMN "anulado_en" TIMESTAMPTZ,
  ADD COLUMN "anulado_por" UUID,
  ADD COLUMN "auxiliar_id" UUID,
  ADD COLUMN "causal_anulacion_id" UUID,
  ADD COLUMN "creado_por" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "fecha_servicio" DATE, -- NOT NULL después de convertir
  ADD COLUMN "firma_documento" VARCHAR(20),
  ADD COLUMN "firma_nombre" VARCHAR(150),
  ADD COLUMN "firma_url" TEXT,
  ADD COLUMN "hora_llegada" TIMESTAMPTZ,
  ADD COLUMN "hora_salida" TIMESTAMPTZ,
  ADD COLUMN "manifiesto_cliente" VARCHAR(40),
  ADD COLUMN "motivo_anulacion" VARCHAR(300),
  ADD COLUMN "observaciones" TEXT,
  ADD COLUMN "orden_compra" VARCHAR(40),
  ADD COLUMN "peso_entrada" DECIMAL(12,2),
  ADD COLUMN "peso_neto" DECIMAL(12,2),
  ADD COLUMN "peso_salida" DECIMAL(12,2),
  ADD COLUMN "realizado_en" TIMESTAMPTZ,
  ADD COLUMN "realizado_por" UUID,
  ADD COLUMN "tipo" "TipoManifiesto" NOT NULL DEFAULT 'CARGUE',
  ADD COLUMN "tipo_conciliacion" "TipoConciliacion" NOT NULL DEFAULT 'INTERNA',
  ADD COLUMN "transporte_id" UUID,
  ALTER COLUMN "numero" SET DEFAULT '',
  ALTER COLUMN "vehiculo_id" DROP NOT NULL,
  ALTER COLUMN "conductor_id" DROP NOT NULL;
-- Conversión: fecha de emisión → fecha de servicio y fecha de creación
UPDATE manifiestos SET fecha_servicio = (fecha_emision AT TIME ZONE 'America/Bogota')::date, created_at = fecha_emision;
ALTER TABLE "manifiestos" ALTER COLUMN "fecha_servicio" SET NOT NULL;
-- Conversión del estado (EstadoDocumento → EstadoManifiesto), sin perder el valor
ALTER TABLE "manifiestos" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "manifiestos" ALTER COLUMN "estado" TYPE "EstadoManifiesto" USING ((CASE "estado"::text
  WHEN 'ANULADO' THEN 'ANULADO' WHEN 'RECIBIDO' THEN 'REALIZADO' WHEN 'CERRADO' THEN 'REALIZADO' ELSE 'PENDIENTE' END)::"EstadoManifiesto");
ALTER TABLE "manifiestos" ALTER COLUMN "estado" SET DEFAULT 'PENDIENTE';
UPDATE manifiestos SET motivo_anulacion = 'Anulado en la fase 1', anulado_en = created_at WHERE estado = 'ANULADO';

ALTER TABLE "manifiesto_items"
  ADD COLUMN "declaracion_id" UUID, -- NOT NULL después de convertir
  ADD COLUMN "disposicion_id" UUID,
  ADD COLUMN "metrica_id" UUID,
  ADD COLUMN "observaciones" VARCHAR(300),
  ADD COLUMN "precio_unitario" DECIMAL(14,2),
  ADD COLUMN "sucursal_id" UUID, -- NOT NULL después de convertir
  ADD COLUMN "tipo_embalaje_id" UUID,
  ALTER COLUMN "solicitud_item_id" DROP NOT NULL;
-- Conversión: declaración, generador y precio salen de la línea de la solicitud; disposición y métrica, de la declaración
UPDATE manifiesto_items mi SET declaracion_id = si.declaracion_id, precio_unitario = si.precio_unitario,
       sucursal_id = COALESCE(si.sucursal_id, m.sucursal_id)
  FROM manifiestos m, solicitud_items si WHERE m.id = mi.manifiesto_id AND si.id = mi.solicitud_item_id;
UPDATE manifiesto_items mi SET disposicion_id = dd.disposicion_id
  FROM declaracion_disposiciones dd WHERE dd.declaracion_id = mi.declaracion_id AND dd.principal;
UPDATE manifiesto_items mi SET metrica_id = t.metrica_id
  FROM (SELECT DISTINCT ON (declaracion_id) declaracion_id, metrica_id FROM tarifas ORDER BY declaracion_id, vigente_desde DESC) t
 WHERE t.declaracion_id = mi.declaracion_id;
ALTER TABLE "manifiesto_items" ALTER COLUMN "declaracion_id" SET NOT NULL, ALTER COLUMN "sucursal_id" SET NOT NULL;
ALTER TABLE "manifiestos" DROP COLUMN "fecha_emision", DROP COLUMN "sucursal_id";

-- ---------- Actas ----------
ALTER TABLE "actas"
  ADD COLUMN "anulada_en" TIMESTAMPTZ,
  ADD COLUMN "archivo_url" TEXT,
  ADD COLUMN "cargada_por" UUID,
  ADD COLUMN "codigo_verificacion" VARCHAR(32) NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'), -- uno distinto por fila
  ADD COLUMN "contenido" JSONB,
  ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "emitida_en" TIMESTAMPTZ,
  ADD COLUMN "emitida_por" UUID,
  ADD COLUMN "motivo_anulacion" VARCHAR(300),
  ADD COLUMN "origen" "OrigenActa" NOT NULL DEFAULT 'GENERADA',
  ALTER COLUMN "numero" SET DEFAULT '';
UPDATE actas SET archivo_url = certificado_url WHERE certificado_url IS NOT NULL;
ALTER TABLE "actas" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "actas" ALTER COLUMN "estado" TYPE "EstadoActa" USING ((CASE "estado"::text
  WHEN 'BORRADOR' THEN 'BORRADOR' WHEN 'ANULADO' THEN 'ANULADA' ELSE 'EMITIDA' END)::"EstadoActa");
ALTER TABLE "actas" ALTER COLUMN "estado" SET DEFAULT 'BORRADOR';
UPDATE actas SET emitida_en = created_at WHERE estado = 'EMITIDA';
UPDATE actas SET motivo_anulacion = 'Anulada en la fase 1', anulada_en = created_at WHERE estado = 'ANULADA';
ALTER TABLE "actas" DROP COLUMN "certificado_url";

-- ---------- Conciliación: pasa a ser por manifiesto, antes del acta ----------
ALTER TABLE "conciliacion_items"
  ADD COLUMN "conciliacion_id" UUID, -- NOT NULL después de convertir
  ADD COLUMN "disposicion_id" UUID,
  ADD COLUMN "estado_pago" "EstadoPago" NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "factura_emision" DATE,
  ADD COLUMN "factura_numero" VARCHAR(30),
  ADD COLUMN "factura_vencimiento" DATE,
  ADD COLUMN "forma_pago" "FormaPago",
  ADD COLUMN "metrica_id" UUID,
  ADD COLUMN "orden_compra" VARCHAR(40),
  ADD COLUMN "precio_unitario" DECIMAL(14,2),
  ADD COLUMN "tipo_negociacion" "TipoNegociacion",
  ALTER COLUMN "acta_id" DROP NOT NULL,
  ALTER COLUMN "cantidad_destino" DROP NOT NULL;
-- Conversión: una conciliación por manifiesto con líneas conciliadas; aprobada si sus actas ya estaban emitidas
INSERT INTO conciliaciones (id, empresa_id, manifiesto_id, estado, aprobada_en, created_at)
SELECT gen_random_uuid(), m.empresa_id, m.id,
       (CASE WHEN bool_and(a.estado = 'EMITIDA') THEN 'APROBADA' ELSE 'BORRADOR' END)::"EstadoConciliacion",
       CASE WHEN bool_and(a.estado = 'EMITIDA') THEN CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP
  FROM conciliacion_items ci
  JOIN manifiesto_items mi ON mi.id = ci.manifiesto_item_id
  JOIN manifiestos m ON m.id = mi.manifiesto_id
  LEFT JOIN actas a ON a.id = ci.acta_id
 GROUP BY m.empresa_id, m.id;
UPDATE conciliacion_items ci SET conciliacion_id = c.id, precio_unitario = mi.precio_unitario, metrica_id = mi.metrica_id,
       disposicion_id = mi.disposicion_id, tipo_negociacion = cl.tipo_negociacion, forma_pago = cl.forma_pago
  FROM manifiesto_items mi
  JOIN manifiestos m ON m.id = mi.manifiesto_id
  JOIN clientes cl ON cl.id = m.cliente_id
  JOIN conciliaciones c ON c.manifiesto_id = m.id
 WHERE mi.id = ci.manifiesto_item_id;
ALTER TABLE "conciliacion_items" ALTER COLUMN "conciliacion_id" SET NOT NULL;
-- Un manifiesto con conciliación ya se había realizado; todo manifiesto realizado lleva su fecha
UPDATE manifiestos m SET estado = 'REALIZADO'
 WHERE estado = 'PENDIENTE' AND EXISTS (SELECT 1 FROM conciliaciones c WHERE c.manifiesto_id = m.id);
UPDATE manifiestos SET realizado_en = created_at WHERE estado = 'REALIZADO' AND realizado_en IS NULL;

-- El tipo de estado de la fase 1 ya no se usa
DROP TYPE "EstadoDocumento";

-- CreateIndex
CREATE UNIQUE INDEX "especificaciones_adicionales_empresa_id_codigo_key" ON "especificaciones_adicionales"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "entidades_seguridad_social_tipo_nombre_key" ON "entidades_seguridad_social"("tipo", "nombre");

-- CreateIndex
CREATE INDEX "ruta_items_solicitud_item_id_idx" ON "ruta_items"("solicitud_item_id");

-- CreateIndex
CREATE INDEX "ruta_rastreo_ruta_id_registrado_en_idx" ON "ruta_rastreo"("ruta_id", "registrado_en");

-- CreateIndex
CREATE INDEX "manifiesto_evidencias_manifiesto_id_idx" ON "manifiesto_evidencias"("manifiesto_id");

-- CreateIndex
CREATE UNIQUE INDEX "conciliaciones_manifiesto_id_key" ON "conciliaciones"("manifiesto_id");

-- CreateIndex
CREATE INDEX "conciliaciones_empresa_id_estado_idx" ON "conciliaciones"("empresa_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "actas_codigo_verificacion_key" ON "actas"("codigo_verificacion");

-- CreateIndex
CREATE UNIQUE INDEX "conciliacion_items_manifiesto_item_id_key" ON "conciliacion_items"("manifiesto_item_id");

-- CreateIndex
CREATE INDEX "conciliacion_items_conciliacion_id_idx" ON "conciliacion_items"("conciliacion_id");

-- CreateIndex
CREATE INDEX "conciliacion_items_acta_id_idx" ON "conciliacion_items"("acta_id");

-- CreateIndex
CREATE INDEX "manifiesto_items_manifiesto_id_idx" ON "manifiesto_items"("manifiesto_id");

-- CreateIndex
CREATE INDEX "manifiestos_empresa_id_estado_fecha_servicio_idx" ON "manifiestos"("empresa_id", "estado", "fecha_servicio");

-- CreateIndex
CREATE INDEX "solicitud_items_solicitud_id_idx" ON "solicitud_items"("solicitud_id");

-- CreateIndex
CREATE INDEX "solicitud_items_estado_idx" ON "solicitud_items"("estado");

-- CreateIndex
CREATE INDEX "solicitudes_empresa_id_aprobacion_estado_idx" ON "solicitudes"("empresa_id", "aprobacion", "estado");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_arl_id_fkey" FOREIGN KEY ("arl_id") REFERENCES "entidades_seguridad_social"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_eps_id_fkey" FOREIGN KEY ("eps_id") REFERENCES "entidades_seguridad_social"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_asesor_id_fkey" FOREIGN KEY ("asesor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_aprobada_por_fkey" FOREIGN KEY ("aprobada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_transporte_id_fkey" FOREIGN KEY ("transporte_id") REFERENCES "transportes_terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_manifiesto_origen_id_fkey" FOREIGN KEY ("manifiesto_origen_id") REFERENCES "manifiestos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_items" ADD CONSTRAINT "solicitud_items_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_items" ADD CONSTRAINT "solicitud_items_causal_descarte_id_fkey" FOREIGN KEY ("causal_descarte_id") REFERENCES "catalogo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "especificaciones_adicionales" ADD CONSTRAINT "especificaciones_adicionales_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_item_especificaciones" ADD CONSTRAINT "solicitud_item_especificaciones_solicitud_item_id_fkey" FOREIGN KEY ("solicitud_item_id") REFERENCES "solicitud_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_item_especificaciones" ADD CONSTRAINT "solicitud_item_especificaciones_especificacion_id_fkey" FOREIGN KEY ("especificacion_id") REFERENCES "especificaciones_adicionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transportes_terceros" ADD CONSTRAINT "transportes_terceros_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transportes_terceros" ADD CONSTRAINT "transportes_terceros_conductor_arl_id_fkey" FOREIGN KEY ("conductor_arl_id") REFERENCES "entidades_seguridad_social"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transportes_terceros" ADD CONSTRAINT "transportes_terceros_conductor_eps_id_fkey" FOREIGN KEY ("conductor_eps_id") REFERENCES "entidades_seguridad_social"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transportes_terceros" ADD CONSTRAINT "transportes_terceros_auxiliar_arl_id_fkey" FOREIGN KEY ("auxiliar_arl_id") REFERENCES "entidades_seguridad_social"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transportes_terceros" ADD CONSTRAINT "transportes_terceros_auxiliar_eps_id_fkey" FOREIGN KEY ("auxiliar_eps_id") REFERENCES "entidades_seguridad_social"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consecutivos" ADD CONSTRAINT "consecutivos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_ruta_base_id_fkey" FOREIGN KEY ("ruta_base_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_paradas" ADD CONSTRAINT "ruta_paradas_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_items" ADD CONSTRAINT "ruta_items_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_items" ADD CONSTRAINT "ruta_items_parada_id_fkey" FOREIGN KEY ("parada_id") REFERENCES "ruta_paradas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_items" ADD CONSTRAINT "ruta_items_solicitud_item_id_fkey" FOREIGN KEY ("solicitud_item_id") REFERENCES "solicitud_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_rastreo" ADD CONSTRAINT "ruta_rastreo_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_rastreo" ADD CONSTRAINT "ruta_rastreo_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_auxiliar_id_fkey" FOREIGN KEY ("auxiliar_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_transporte_id_fkey" FOREIGN KEY ("transporte_id") REFERENCES "transportes_terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_realizado_por_fkey" FOREIGN KEY ("realizado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_causal_anulacion_id_fkey" FOREIGN KEY ("causal_anulacion_id") REFERENCES "catalogo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_solicitud_item_id_fkey" FOREIGN KEY ("solicitud_item_id") REFERENCES "solicitud_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_declaracion_id_fkey" FOREIGN KEY ("declaracion_id") REFERENCES "declaraciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_metrica_id_fkey" FOREIGN KEY ("metrica_id") REFERENCES "metricas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_disposicion_id_fkey" FOREIGN KEY ("disposicion_id") REFERENCES "disposiciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_tipo_embalaje_id_fkey" FOREIGN KEY ("tipo_embalaje_id") REFERENCES "tipos_embalaje"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_item_especificaciones" ADD CONSTRAINT "manifiesto_item_especificaciones_manifiesto_item_id_fkey" FOREIGN KEY ("manifiesto_item_id") REFERENCES "manifiesto_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_item_especificaciones" ADD CONSTRAINT "manifiesto_item_especificaciones_especificacion_id_fkey" FOREIGN KEY ("especificacion_id") REFERENCES "especificaciones_adicionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_evidencias" ADD CONSTRAINT "manifiesto_evidencias_manifiesto_id_fkey" FOREIGN KEY ("manifiesto_id") REFERENCES "manifiestos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_evidencias" ADD CONSTRAINT "manifiesto_evidencias_subida_por_fkey" FOREIGN KEY ("subida_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones" ADD CONSTRAINT "conciliaciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones" ADD CONSTRAINT "conciliaciones_manifiesto_id_fkey" FOREIGN KEY ("manifiesto_id") REFERENCES "manifiestos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones" ADD CONSTRAINT "conciliaciones_aprobada_por_fkey" FOREIGN KEY ("aprobada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacion_items" ADD CONSTRAINT "conciliacion_items_conciliacion_id_fkey" FOREIGN KEY ("conciliacion_id") REFERENCES "conciliaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacion_items" ADD CONSTRAINT "conciliacion_items_acta_id_fkey" FOREIGN KEY ("acta_id") REFERENCES "actas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacion_items" ADD CONSTRAINT "conciliacion_items_metrica_id_fkey" FOREIGN KEY ("metrica_id") REFERENCES "metricas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacion_items" ADD CONSTRAINT "conciliacion_items_disposicion_id_fkey" FOREIGN KEY ("disposicion_id") REFERENCES "disposiciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas" ADD CONSTRAINT "actas_emitida_por_fkey" FOREIGN KEY ("emitida_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas" ADD CONSTRAINT "actas_cargada_por_fkey" FOREIGN KEY ("cargada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

