-- Solo si la base ya existe y NO tiene las columnas 'servicio_id', 'estado' ni el índice 'idx_mov_serv_mes'.
-- Servicios recurrentes mensuales.
--
-- IMPORTANTE — orden de deploy: esta migración tiene que correr ANTES de pushear el
-- código de este branch. GET /api/state hace SELECT sobre la tabla 'servicio'; si el
-- Worker nuevo se deploya antes de que exista esa tabla, todas las llamadas a
-- /api/state devuelven 500 y la app queda inutilizable para los dos (ni siquiera se
-- puede cargar un gasto) hasta que se corra esta migración.
--
-- IMPORTANTE — backup antes de correr: ALTER TABLE ADD COLUMN no se puede deshacer en
-- SQLite sin reconstruir la tabla entera. Backupeá primero:
--   npx wrangler d1 export gastos --remote --output=backup-pre-servicios.sql
--
-- Correr una sola vez:
--   npx wrangler d1 execute gastos --remote --file=./migracion-servicios.sql
--
-- Verificación posterior — tiene que pasar ANTES de deployar el Worker:
--   npx wrangler d1 execute gastos --remote --command "PRAGMA table_info(mov);"
--   npx wrangler d1 execute gastos --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mov_serv_mes';"
-- La primera tiene que listar 'servicio_id' y 'estado' entre las columnas de mov;
-- la segunda tiene que devolver una fila con 'idx_mov_serv_mes'. Si falta cualquiera
-- de las dos, no deployar todavía.
--
-- Si falla a la mitad (p. ej., error de conexión entre statements):
-- 1. Verificar qué columnas ya existen: PRAGMA table_info(mov);
-- 2. Verificar si el índice existe: SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mov_serv_mes';
-- 3. Correr manualmente solo los statements que faltan, no el archivo completo (evita "duplicate column name").

CREATE TABLE IF NOT EXISTS servicio (
  id        TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  monto     REAL NOT NULL,
  dia       INTEGER NOT NULL,
  cuenta_id TEXT NOT NULL REFERENCES cuenta(id),
  cat       TEXT,
  modo      TEXT NOT NULL CHECK (modo IN ('auto','manual')),
  activo    INTEGER NOT NULL DEFAULT 1,
  desde     TEXT NOT NULL,
  creado    TEXT NOT NULL
);

ALTER TABLE mov ADD COLUMN servicio_id TEXT;
ALTER TABLE mov ADD COLUMN estado TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_serv_mes
  ON mov(servicio_id, substr(fecha,1,7)) WHERE servicio_id IS NOT NULL;
