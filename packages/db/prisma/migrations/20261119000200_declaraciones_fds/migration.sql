-- Pregunta n.º 3 de la fase A (aprobada): la ficha de datos de seguridad es obligatoria para
-- AUTORIZAR un residuo peligroso (Decreto 1079 de 2015, transporte de mercancías peligrosas).
-- Se puede enviar sin ella (PENDIENTE); Terra Viva no la autoriza hasta tenerla.
ALTER TABLE declaraciones
  ADD CONSTRAINT chk_decl_fds_peligroso CHECK (
        NOT es_peligroso OR estado <> 'AUTORIZADA'
        OR COALESCE(LENGTH(TRIM(ficha_seguridad_url)), 0) > 0);
