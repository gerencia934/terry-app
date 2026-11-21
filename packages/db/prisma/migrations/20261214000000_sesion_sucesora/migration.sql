-- Estándar 1 del ERP Terry-App (gerencia, 21-11-2026): la sesión no se cae.
-- Al renovar, la sesión anterior anota cuál la reemplazó. Si la respuesta se perdió (señal en el celular, servidor
-- reiniciando) y el equipo vuelve con el token anterior, recibe una sesión nueva a partir del reemplazo que nunca usó.
ALTER TABLE sesiones ADD COLUMN reemplazada_por_id UUID;
CREATE INDEX ix_sesiones_reemplazada_por ON sesiones (reemplazada_por_id) WHERE reemplazada_por_id IS NOT NULL;

-- Estándar 2: «Olvidé mi contraseña» funciona sin correo de salida. La solicitud queda a la vista del administrador,
-- que envía el enlace por WhatsApp.
ALTER TABLE usuarios ADD COLUMN restablecer_pedido_en TIMESTAMPTZ;
