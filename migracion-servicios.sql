-- Servicios recurrentes mensuales.
-- Correr una sola vez:
--   npx wrangler d1 execute gastos --remote --file=./migracion-servicios.sql

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
