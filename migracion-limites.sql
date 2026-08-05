-- Límites de tarjeta. Solo si la base ya existe y NO tiene las columnas de límite.
--
-- CORRER ESTA MIGRACIÓN ANTES DE PUSHEAR EL CÓDIGO. El Worker lee estas columnas al
-- listar los medios de pago; si se deploya primero, /api/state devuelve 500 y la app
-- queda inutilizable para los dos hasta que la migración corra.
--
-- 1. Backup obligatorio (ALTER TABLE no se deshace en SQLite sin reconstruir la tabla):
--      npx wrangler d1 export gastos --remote --output=backup-pre-limites.sql
--
-- 2. Correr:
--      npx wrangler d1 execute gastos --remote --file=./migracion-limites.sql
--
-- 3. Verificar ANTES de deployar — tienen que aparecer las cinco columnas:
--      npx wrangler d1 execute gastos --remote --command "PRAGMA table_info(cuenta);"
--
-- Si falla a la mitad (los ALTER TABLE no son transaccionales): mirar con el PRAGMA de
-- arriba cuáles columnas ya existen y correr a mano solo los ALTER que falten, no el
-- archivo completo — reintentarlo entero falla en el primero con "duplicate column name".

ALTER TABLE cuenta ADD COLUMN limite_pago   REAL;
ALTER TABLE cuenta ADD COLUMN limite_cuotas REAL;
ALTER TABLE cuenta ADD COLUMN base_pago     REAL NOT NULL DEFAULT 0;
ALTER TABLE cuenta ADD COLUMN base_cuotas   REAL NOT NULL DEFAULT 0;
ALTER TABLE cuenta ADD COLUMN pagado_hasta  TEXT;
