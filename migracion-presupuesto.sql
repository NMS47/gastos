-- Presupuesto familiar: topes por categoría, ingresos, compromisos con fecha de fin
-- y gasto personal opcional.
--
-- IMPORTANTE: esta migración tiene que aplicarse a producción ANTES de mergear esta
-- rama a main. Cloudflare buildea solo con cada push a main, y en cuanto este branch
-- llegue ahí GET /api/state y POST /api/movs van a tirar "no such table: ingreso" /
-- "no such column: ambito" — la app muestra "No se pudieron cargar los datos" y nadie
-- puede leer ni cargar nada hasta correr esto a mano. No se corrompe nada y es
-- recuperable, pero es una caída real para dos personas que usan la app todos los días.
--
-- Backup obligatorio antes de correr (ALTER TABLE no se deshace en SQLite sin
-- reconstruir la tabla):
--   npx wrangler d1 export gastos --remote --output=backup-pre-presupuesto.sql
--
-- Correr:
--   npx wrangler d1 execute gastos --remote --file=./migracion-presupuesto.sql
--
-- Verificación posterior:
--   npx wrangler d1 execute gastos --remote --command "SELECT name FROM sqlite_master WHERE name IN ('ingreso','tope')"
--   npx wrangler d1 execute gastos --remote --command "SELECT COUNT(*) AS nafta FROM mov WHERE cat='Nafta'"
-- La primera tiene que listar 'ingreso' y 'tope'; la segunda tiene que dar 0.
--
-- Si falla a la mitad: wrangler d1 execute --file no corre el archivo como una sola
-- transacción (mismo comportamiento que ya documentan migracion-limites.sql y
-- migracion-servicios.sql), y acá los dos ALTER TABLE van primero y no son idempotentes
-- — reintentar el archivo entero falla de una con "duplicate column name" antes de
-- llegar siquiera a las tablas nuevas o a los UPDATE que todavía faltan. Mirar qué
-- quedó aplicado y correr a mano solo lo que falte, en este orden:
--   npx wrangler d1 execute gastos --remote --command "PRAGMA table_info(servicio);"
--   npx wrangler d1 execute gastos --remote --command "PRAGMA table_info(mov);"
-- 1. ALTER TABLE servicio ADD COLUMN hasta TEXT;   -- si 'hasta' no aparece en servicio
-- 2. ALTER TABLE mov ADD COLUMN ambito TEXT;       -- si 'ambito' no aparece en mov
-- 3. los dos CREATE TABLE IF NOT EXISTS            -- no hacen nada si 'ingreso'/'tope' ya existen
-- 4. los dos UPDATE                                -- no hacen nada si ya no queda ningún 'Nafta'

-- Un compromiso es un servicio con fecha de fin. NULL = sin fin, como hasta ahora.
ALTER TABLE servicio ADD COLUMN hasta TEXT;

-- 'personal' = gasto de uno solo, no suma a ningún total familiar. NULL = familiar.
ALTER TABLE mov ADD COLUMN ambito TEXT;

CREATE TABLE IF NOT EXISTS ingreso (
  id      TEXT PRIMARY KEY,
  nombre  TEXT NOT NULL,
  monto   INTEGER NOT NULL,
  dia     INTEGER,
  desde   TEXT NOT NULL,
  hasta   TEXT,
  activo  INTEGER NOT NULL DEFAULT 1,
  creado  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tope (
  cat   TEXT PRIMARY KEY,
  monto INTEGER NOT NULL
);

-- Auto ahora incluye nafta, seguro, mantenimiento y patente.
UPDATE mov SET cat = 'Auto' WHERE cat = 'Nafta';
UPDATE servicio SET cat = 'Auto' WHERE cat = 'Nafta';
