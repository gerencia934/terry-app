-- Por qué se cerró cada sesión. Solo el reuso de un token ya rotado («ROTACION») hace sospechar un robo y cierra todas
-- las sesiones de la persona. Usar el token de una sesión que simplemente se cerró (salida, entrada desde el portal en
-- otra pestaña, cambio de contraseña…) solo responde «la sesión fue cerrada».
ALTER TABLE sesiones ADD COLUMN cerrada_por VARCHAR(20);
