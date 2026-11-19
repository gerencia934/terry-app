-- Descarga de certificados en el portal sujeta al pago (respuesta de la gerencia del 19-11-2026: «condicionar
-- sutilmente la descarga de las actas al pago de las facturas»). Mientras una factura del certificado esté vencida y
-- sin pagar, el cliente lo ve en su portal pero no lo descarga. La oficina puede liberar la descarga de un certificado
-- (acuerdo de pago, cliente con crédito especial): queda quién y cuándo. El certificado emitido no cambia (el trigger
-- trg_acta_transicion solo protege lo certificado), y la verificación pública por QR no depende del pago.
ALTER TABLE actas
  ADD COLUMN descarga_liberada_en TIMESTAMPTZ,
  ADD COLUMN descarga_liberada_por UUID REFERENCES usuarios(id),
  ADD CONSTRAINT chk_acta_liberada CHECK ((descarga_liberada_en IS NULL) = (descarga_liberada_por IS NULL));

-- Cartera por certificado: facturas vencidas y sin pagar de sus líneas
CREATE INDEX ix_conciliacion_items_cartera ON conciliacion_items (acta_id, factura_vencimiento)
  WHERE acta_id IS NOT NULL AND factura_numero IS NOT NULL AND estado_pago IN ('PENDIENTE', 'ABONADA');
