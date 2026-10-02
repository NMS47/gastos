-- Presupuesto familiar: topes por categoría, ingresos, compromisos con fecha de fin
-- y gasto personal opcional. Aplicar con:
--   npx wrangler d1 execute gastos --remote --file=./migracion-presupuesto.sql

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
