-- Certificado con el modelo oficial de Terra Viva y constancia de RCD (Anexo II de la Resolución 1257 de 2021, que
-- modifica la Resolución 0472 de 2017). El gestor de RCD entrega al generador las cantidades recibidas por tipo.

-- Tipo de RCD de una declaración, según los numerales del Anexo II
CREATE TYPE "TipoRcd" AS ENUM (
  'EXCAVACION',          -- 1.1 Productos de excavación y sobrantes de la adecuación del terreno
  'CIMENTACION',         -- 1.2 Productos de cimentaciones y pilotajes
  'PETREOS',             -- 1.3 Pétreos
  'NO_PETREOS',          -- 1.4 No pétreos
  'CONTAMINADO_RESPEL',  -- 2.1 Contaminados con residuos peligrosos
  'NO_APROVECHABLE',     -- 2.2 Los que por su estado no pueden ser aprovechados
  'PELIGROSO'            -- 2.3 Los que tengan características de peligrosidad
);
ALTER TABLE declaraciones ADD COLUMN tipo_rcd "TipoRcd";

-- Datos del generador que pide la constancia: el número único que le asigna la autoridad ambiental por proyecto
-- (va en la sede o el proyecto donde se generan los RCD) y el representante legal del cliente.
ALTER TABLE sucursales ADD COLUMN registro_rcd VARCHAR(50);
ALTER TABLE clientes ADD COLUMN representante_legal VARCHAR(150);
