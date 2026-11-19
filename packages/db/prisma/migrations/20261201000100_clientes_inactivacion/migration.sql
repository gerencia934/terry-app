-- Clientes (gerencia, 19-11-2026): se inactivan con su motivo (pagos pendientes, entregas no autorizadas u otra
-- eventualidad) y el sector económico sale de una lista.
CREATE TYPE "MotivoInactivacion" AS ENUM ('PAGOS_PENDIENTES', 'ENTREGAS_NO_AUTORIZADAS', 'OTRO');

ALTER TABLE clientes
  ADD COLUMN motivo_inactivacion "MotivoInactivacion",
  ADD COLUMN nota_inactivacion VARCHAR(500),
  ADD COLUMN inactivado_en TIMESTAMPTZ;

-- Los que ya estaban inactivos quedan con «otra eventualidad» y una nota que lo explica (la auditoría guarda cuándo fue)
UPDATE clientes SET motivo_inactivacion = 'OTRO', nota_inactivacion = 'Inactivado antes de que se registrara el motivo', inactivado_en = now()
 WHERE NOT activo;

-- Un cliente inactivo siempre tiene su motivo y la fecha (y si es «otra eventualidad», la nota que la describe); uno activo, no
ALTER TABLE clientes ADD CONSTRAINT clientes_motivo_inactivacion CHECK (
  (activo AND motivo_inactivacion IS NULL AND nota_inactivacion IS NULL AND inactivado_en IS NULL)
  OR (NOT activo AND motivo_inactivacion IS NOT NULL AND inactivado_en IS NOT NULL
      AND (motivo_inactivacion <> 'OTRO' OR LENGTH(TRIM(COALESCE(nota_inactivacion, ''))) >= 5)));

-- Sectores escritos a mano antes de la lista: los que coinciden (sin tildes ni mayúsculas) o son sinónimos claros pasan
-- al nombre de la lista; los demás se conservan y se corrigen al editar el cliente.
UPDATE clientes c SET sector = m.canon
  FROM (VALUES
    ('hidrocarburos', 'Hidrocarburos'), ('petrolero', 'Hidrocarburos'), ('petroleo', 'Hidrocarburos'), ('oil & gas', 'Hidrocarburos'),
    ('domestico', 'Doméstico'), ('residencial', 'Doméstico'), ('hogar', 'Doméstico'),
    ('industrial', 'Industrial'), ('industria', 'Industrial'),
    ('agricola', 'Agrícola'), ('agricultura', 'Agrícola'), ('agroindustria', 'Agrícola'), ('agroindustrial', 'Agrícola'),
    ('palma', 'Agrícola'), ('palma de aceite', 'Agrícola'), ('agropecuario', 'Agrícola'),
    ('minero', 'Minero'), ('mineria', 'Minero'),
    ('alimenticio', 'Alimenticio'), ('alimentos', 'Alimenticio'),
    ('salud', 'Salud'), ('hospitalario', 'Salud'),
    ('construccion', 'Construcción'),
    ('comercio y servicios', 'Comercio y servicios'), ('comercio', 'Comercio y servicios'), ('servicios', 'Comercio y servicios'),
    ('transporte', 'Transporte'),
    ('entidad publica', 'Entidad pública'), ('publico', 'Entidad pública'), ('gobierno', 'Entidad pública'),
    ('educativo', 'Educativo'), ('educacion', 'Educativo'),
    ('otro', 'Otro')
  ) AS m(clave, canon)
 WHERE lower(translate(trim(c.sector), 'ÁÉÍÓÚáéíóúÜü', 'AEIOUaeiouUu')) = m.clave AND c.sector IS DISTINCT FROM m.canon;
