-- Certificado comercial del cliente (gerencia, 19-11-2026; modelo PD-GG-F-01 de Terra Viva, mejorado y dinámico).
-- El cliente lo descarga desde el portal y la oficina desde su ficha. Uno por cliente y día: si se pide otra vez el mismo
-- día, se entrega el mismo. Consecutivo propio (CC-AAAA-0001, configurable en Ajustes: no se cruza con la serie manual
-- ADM), PDF guardado en el almacenamiento (Cloudflare R2) con su huella SHA-256 y código de verificación para el QR.
CREATE TABLE certificados_comerciales (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES empresas(id),
  cliente_id          UUID NOT NULL REFERENCES clientes(id),
  numero              VARCHAR(20) NOT NULL,
  fecha               DATE NOT NULL,                -- día de expedición (hora de Colombia)
  contenido           JSONB NOT NULL,               -- lo que dice: copia fija con la que se armó el PDF
  pdf_url             TEXT NOT NULL,                -- clave del PDF en el almacenamiento
  pdf_sha256          CHAR(64) NOT NULL,
  codigo_verificacion VARCHAR(40) NOT NULL,
  solicitado_por_id   UUID REFERENCES usuarios(id), -- quien lo pidió (oficina o portal)
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX certificados_comerciales_empresa_id_numero_key ON certificados_comerciales (empresa_id, numero);
CREATE UNIQUE INDEX certificados_comerciales_cliente_id_fecha_key ON certificados_comerciales (cliente_id, fecha);
CREATE UNIQUE INDEX certificados_comerciales_codigo_verificacion_key ON certificados_comerciales (codigo_verificacion);

-- Nada legal se borra ni se cambia: el certificado expedido es una copia fija
CREATE OR REPLACE FUNCTION fn_certificado_comercial_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El certificado comercial % ya se expidió: no se modifica ni se borra', OLD.numero;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_certificado_comercial_inmutable BEFORE UPDATE OR DELETE ON certificados_comerciales
  FOR EACH ROW EXECUTE FUNCTION fn_certificado_comercial_inmutable();

-- Portal: cada cliente ve solo los suyos (misma doble barrera que los demás documentos) y nunca escribe en la tabla:
-- el certificado lo arma el API fuera de la sesión del portal, después de verificar al cliente.
ALTER TABLE certificados_comerciales ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificados_comerciales FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_portal_cliente ON certificados_comerciales USING (fn_rls_cliente() IS NULL OR cliente_id = fn_rls_cliente());
CREATE POLICY rls_portal_no_inserta ON certificados_comerciales AS RESTRICTIVE FOR INSERT WITH CHECK (fn_rls_cliente() IS NULL);
CREATE POLICY rls_portal_no_modifica ON certificados_comerciales AS RESTRICTIVE FOR UPDATE USING (fn_rls_cliente() IS NULL);
CREATE POLICY rls_portal_no_borra ON certificados_comerciales AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL);

-- Consecutivo del certificado comercial: CC-2026-0001 (reinicia cada año). Igual que antes para los demás documentos.
CREATE OR REPLACE FUNCTION fn_siguiente_consecutivo(p_empresa UUID, p_documento TEXT) RETURNS TEXT AS $$
DECLARE c consecutivos; anio_actual INT := EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Bogota'))::INT; n TEXT;
BEGIN
  INSERT INTO consecutivos (empresa_id, documento, prefijo, digitos, reinicio_anual, anio)
  VALUES (p_empresa, p_documento,
          CASE p_documento WHEN 'MANIFIESTO' THEN 'TV' WHEN 'INSPECCION' THEN 'INS-' WHEN 'ACTA' THEN 'PSAP' WHEN 'CERT_COMERCIAL' THEN 'CC-' ELSE '' END,
          CASE p_documento WHEN 'MANIFIESTO' THEN 4 WHEN 'ACTA' THEN 0 WHEN 'CERT_COMERCIAL' THEN 4 ELSE 5 END,
          p_documento <> 'MANIFIESTO', anio_actual)
  ON CONFLICT (empresa_id, documento) DO NOTHING;
  -- La fila queda bloqueada hasta el fin de la transacción: no hay números repetidos ni saltos por concurrencia.
  UPDATE consecutivos
     SET ultimo = CASE WHEN reinicio_anual AND anio <> anio_actual THEN 1 ELSE ultimo + 1 END,
         anio = CASE WHEN reinicio_anual THEN anio_actual ELSE anio END
   WHERE empresa_id = p_empresa AND documento = p_documento
  RETURNING * INTO c;
  n := c.ultimo::TEXT;
  IF c.digitos > length(n) THEN n := lpad(n, c.digitos, '0'); END IF;
  RETURN c.prefijo || CASE WHEN c.reinicio_anual THEN c.anio || '-' ELSE '' END || n;
END $$ LANGUAGE plpgsql;
