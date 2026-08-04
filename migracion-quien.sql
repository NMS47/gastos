-- Solo si la base ya existe y NO tiene la columna 'quien'.
-- Correr una sola vez:
--   npx wrangler d1 execute gastos --remote --file=./migracion-quien.sql
ALTER TABLE mov ADD COLUMN quien TEXT;
