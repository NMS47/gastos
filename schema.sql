-- Gastos: schema D1 (SQLite)
-- Aplicar:  npx wrangler d1 execute gastos --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS cuenta (
  id      TEXT PRIMARY KEY,
  nombre  TEXT NOT NULL,
  tipo    TEXT NOT NULL CHECK (tipo IN ('debito','credito')),
  cierre  INTEGER,              -- día de cierre (solo crédito)
  venc    INTEGER,              -- día de pago del resumen (solo crédito)
  def     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mov (
  id          TEXT PRIMARY KEY,
  fecha       TEXT NOT NULL,    -- YYYY-MM-DD, fecha de la compra
  descripcion TEXT NOT NULL,
  monto       REAL NOT NULL,
  cuenta_id   TEXT NOT NULL REFERENCES cuenta(id),
  cuotas      INTEGER NOT NULL DEFAULT 1,
  cat         TEXT,
  quien       TEXT,             -- quién lo cargó: 'nico' o 'dani'
  servicio_id TEXT,             -- de qué servicio salió; NULL si es un gasto suelto
  estado      TEXT,             -- NULL para gastos comunes; 'pendiente'|'pagado'|'omitido'
  creado      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mov_fecha  ON mov(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_cuenta ON mov(cuenta_id);

CREATE TABLE IF NOT EXISTS servicio (
  id        TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  monto     REAL NOT NULL,      -- lo que se espera pagar
  dia       INTEGER NOT NULL,   -- día del mes que vence o se debita
  cuenta_id TEXT NOT NULL REFERENCES cuenta(id),
  cat       TEXT,
  modo      TEXT NOT NULL CHECK (modo IN ('auto','manual')),
  activo    INTEGER NOT NULL DEFAULT 1,
  desde     TEXT NOT NULL,      -- YYYY-MM, primer mes que corresponde
  creado    TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_serv_mes
  ON mov(servicio_id, substr(fecha,1,7)) WHERE servicio_id IS NOT NULL;

-- Medios de pago iniciales. Borrá los que no uses desde la pestaña Medios.
INSERT OR IGNORE INTO cuenta (id, nombre, tipo, cierre, venc, def) VALUES
  ('ef', 'Efectivo',   'debito',  NULL, NULL, 0),
  ('mp', 'MP',         'debito',  NULL, NULL, 1),
  ('le', 'Lemon Dani', 'debito',  NULL, NULL, 0),
  ('bn', 'BNA',        'debito',  NULL, NULL, 0),
  ('vi', 'Visa',       'credito',   20,    5, 0),
  ('ua', 'Ualá',       'credito',   25,    5, 0),
  ('mc', 'MP Crédito', 'credito',   25,   10, 0);
