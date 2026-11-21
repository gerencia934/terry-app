-- Conciliación (gerencia, 20-11-2026): lo que el cliente pidió, lo que se cargó y lo que se recibió en planta deben
-- coincidir. Con pesos casi nunca da exacto, así que TODA diferencia entre lo cargado y lo conciliado se justifica (antes
-- solo las de más de ±2 %), y la aprueba otra persona (lo exige el API). Lo que se certifica es lo de la báscula de planta.
ALTER TABLE conciliacion_items DROP CONSTRAINT IF EXISTS chk_justificacion_diferencia;
ALTER TABLE conciliacion_items ADD CONSTRAINT chk_justificacion_diferencia CHECK (
  cantidad_destino IS NULL
  OR cantidad_destino = cantidad_origen
  OR COALESCE(LENGTH(TRIM(justificacion)), 0) > 0) NOT VALID;
