-- Regla de Terra Viva (gerencia, 20-11-2026): el acta de disposición final solo se libera cuando el manifiesto está
-- facturado. Los clientes nuevos arrancan con «Exigir factura» y los que tenían la regla amable de fábrica pasan a ella.
-- Las reglas más flexibles (retener al vencer, libre) quedan como excepciones con motivo de Facturación o Gerencia.
ALTER TABLE clientes ALTER COLUMN regla_certificado SET DEFAULT 'EXIGIR_FACTURA';
UPDATE clientes SET regla_certificado = 'EXIGIR_FACTURA' WHERE regla_certificado = 'AL_VENCER';
