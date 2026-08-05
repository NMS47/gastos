-- Solo si la base ya existe y NO tiene las columnas 'servicio_id', 'estado' ni el índice 'idx_mov_serv_mes'.
-- Servicios recurrentes mensuales.
-- Correr una sola vez:
--   npx wrangler d1 execute gastos --remote --file=./migracion-servicios.sql
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
