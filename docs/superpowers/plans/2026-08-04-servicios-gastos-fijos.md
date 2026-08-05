# Servicios y gastos fijos mensuales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir cargar servicios recurrentes mensuales para que no se olviden de pagarlos y para saber cuánto les sale fijo por mes.

**Architecture:** Una tabla `servicio` guarda la *definición* del gasto fijo. En cada `GET /api/state` el Worker materializa perezosamente los gastos del mes corriente que falten, con un `INSERT OR IGNORE` protegido por un índice único parcial sobre `(servicio_id, mes)`. Los de débito automático nacen pagados; los manuales nacen pendientes y no suman al total del mes hasta que alguien los paga. La lógica riesgosa (zona horaria, acotado de días) vive en un módulo puro testeable aparte.

**Tech Stack:** Cloudflare Worker (ESM, sin framework), D1/SQLite, HTML+CSS+JS vanilla en un solo archivo, `node --test` nativo para los tests unitarios.

**Spec:** `docs/superpowers/specs/2026-08-04-servicios-gastos-fijos-design.md`

## Global Constraints

- **Cero dependencias.** El proyecto no tiene `package.json` y no debe tenerlo. Los tests usan el runner nativo de Node (`node --test`), que no requiere instalar nada. Node instalado: v24.15.0.
- **Correr los tests con `node --test` a secas, desde la raíz del repo.** Ya se verificó que en Windows pasarle el directorio (`node --test src/`) hace que Node lo trate como un archivo de test y falle con un `'test failed'` sin detalle. Sin argumentos, descubre `src/servicios.test.mjs` solo.
- **Sin build step.** `wrangler.toml` apunta `main = "src/index.js"` y wrangler bundlea. Ya se verificó que un `import` de un archivo `.mjs` desde `src/index.js` bundlea correctamente (`npx wrangler deploy --dry-run`).
- **No reintroducir `functions/`.** El proyecto no usa Pages Functions.
- **Todo el texto de la UI en español rioplatense, voseo, sentence case.**
- **Montos con `toLocaleString("es-AR")`, sin decimales** — usar el helper `fmt()` que ya existe.
- **Colores desde las variables CSS** al tope de `index.html`: `--accent` verde para acciones, `--credit` violeta para cuotas/tarjeta, `--danger` para lo vencido.
- **Los gastos generados por servicios llevan `quien = NULL`** y por lo tanto no se pintan de azul ni de rosa.
- **Argentina es siempre UTC-3**, sin horario de verano.
- Los tests del frontend no existen: `index.html` es un archivo único sin harness. Las tareas de UI se verifican a mano con `npx wrangler dev`, con pasos y observaciones esperadas explícitas.

---

### Task 1: Módulo puro de lógica de servicios

Extrae a un módulo sin dependencias las cuatro operaciones que tienen casos borde reales: el mes corriente en hora argentina, el acotado del día al último del mes, el estado inicial según el modo, y la suma del gasto fijo. Son puras, así que se testean sin D1 ni fetch.

**Files:**
- Create: `src/servicios.mjs`
- Test: `src/servicios.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `mesActualAR(ahora?: Date) -> string` — `"YYYY-MM"` en UTC-3
  - `diasDelMes(mes: string) -> number` — `mes` es `"YYYY-MM"`
  - `fechaDeServicio(mes: string, dia: number) -> string` — `"YYYY-MM-DD"` con el día acotado
  - `estadoInicial(modo: "auto"|"manual") -> "pagado"|"pendiente"`

  El número de gasto fijo mensual **no** vive acá: lo calcula el frontend, que es el único
  que lo muestra, y no puede importar este módulo porque su JS está inline en `index.html`.
  Ponerlo también acá sería código muerto en el Worker.

- [ ] **Step 1: Write the failing test**

Crear `src/servicios.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mesActualAR, diasDelMes, fechaDeServicio, estadoInicial } from "./servicios.mjs";

test("mesActualAR usa hora argentina, no UTC", () => {
  // 31/07 22:00 en Argentina todavía es julio, aunque en UTC ya sea agosto.
  assert.equal(mesActualAR(new Date("2026-08-01T01:00:00Z")), "2026-07");
  // 01/08 01:00 en Argentina ya es agosto.
  assert.equal(mesActualAR(new Date("2026-08-01T04:00:00Z")), "2026-08");
});

test("diasDelMes contempla años bisiestos", () => {
  assert.equal(diasDelMes("2026-02"), 28);
  assert.equal(diasDelMes("2024-02"), 29);
  assert.equal(diasDelMes("2026-04"), 30);
  assert.equal(diasDelMes("2026-12"), 31);
});

test("fechaDeServicio acota el día al último del mes", () => {
  assert.equal(fechaDeServicio("2026-02", 31), "2026-02-28");
  assert.equal(fechaDeServicio("2024-02", 31), "2024-02-29");
  assert.equal(fechaDeServicio("2026-04", 31), "2026-04-30");
});

test("fechaDeServicio respeta un día válido y lo rellena a dos dígitos", () => {
  assert.equal(fechaDeServicio("2026-08", 5), "2026-08-05");
  assert.equal(fechaDeServicio("2026-08", 20), "2026-08-20");
});

test("fechaDeServicio nunca devuelve día cero ni negativo", () => {
  assert.equal(fechaDeServicio("2026-08", 0), "2026-08-01");
  assert.equal(fechaDeServicio("2026-08", -3), "2026-08-01");
});

test("estadoInicial: los automáticos nacen pagados, los manuales pendientes", () => {
  assert.equal(estadoInicial("auto"), "pagado");
  assert.equal(estadoInicial("manual"), "pendiente");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test
```

Expected: FAIL — `Cannot find module` apuntando a `src/servicios.mjs`.

- [ ] **Step 3: Write minimal implementation**

Crear `src/servicios.mjs`:

```js
// Lógica pura de servicios recurrentes. Sin D1, sin fetch: testeable con `node --test`.

// Argentina no aplica horario de verano, siempre UTC-3.
const OFFSET_AR_MS = 3 * 60 * 60 * 1000;

export function mesActualAR(ahora = new Date()) {
  const d = new Date(ahora.getTime() - OFFSET_AR_MS);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

export function diasDelMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function fechaDeServicio(mes, dia) {
  const d = Math.min(Math.max(parseInt(dia) || 1, 1), diasDelMes(mes));
  return mes + "-" + String(d).padStart(2, "0");
}

export function estadoInicial(modo) {
  return modo === "auto" ? "pagado" : "pendiente";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test
```

Expected: PASS — `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/servicios.mjs src/servicios.test.mjs
git commit -m "feat: modulo puro de logica de servicios con tests"
```

---

### Task 2: Migración de base de datos

Crea la tabla `servicio`, agrega las dos columnas a `mov` y el índice único parcial que hace idempotente toda la generación. `schema.sql` se actualiza en paralelo para que una base creada de cero quede idéntica a la migrada.

**Files:**
- Create: `migracion-servicios.sql`
- Modify: `schema.sql`

**Interfaces:**
- Consumes: nada.
- Produces: tabla `servicio(id, nombre, monto, dia, cuenta_id, cat, modo, activo, desde, creado)`; columnas `mov.servicio_id` y `mov.estado`; índice `idx_mov_serv_mes`.

- [ ] **Step 1: Escribir la migración**

Crear `migracion-servicios.sql`:

```sql
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
```

- [ ] **Step 2: Actualizar `schema.sql`**

En `schema.sql`, dentro del `CREATE TABLE IF NOT EXISTS mov`, agregar las dos columnas después de `quien`:

```sql
  quien       TEXT,             -- quién lo cargó: 'nico' o 'dani'
  servicio_id TEXT,             -- de qué servicio salió; NULL si es un gasto suelto
  estado      TEXT,             -- NULL para gastos comunes; 'pendiente'|'pagado'|'omitido'
  creado      TEXT NOT NULL
);
```

Y después del bloque de índices existentes (`idx_mov_fecha`, `idx_mov_cuenta`), agregar la tabla `servicio` y el índice único:

```sql
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
```

- [ ] **Step 3: Verificar la migración contra la base local**

Aplicar la **migración**, no `schema.sql`. Si la base local ya existe con la tabla `mov`
vieja, `CREATE TABLE IF NOT EXISTS mov` es un no-op y las columnas nuevas nunca aparecerían:
los `ALTER TABLE` son los que hacen el trabajo, y es exactamente lo que va a correr en
producción.

```bash
# Solo si la base local todavía no existe:
npx wrangler d1 execute gastos --local --file=./schema.sql

npx wrangler d1 execute gastos --local --file=./migracion-servicios.sql
npx wrangler d1 execute gastos --local --command "PRAGMA table_info(mov);"
```

Si la base local ya venía de una corrida anterior de `schema.sql` **posterior** a este
cambio, los `ALTER TABLE` van a fallar con "duplicate column name". En ese caso, borrar el
estado local y empezar de cero:

```bash
rm -rf .wrangler/state/v3/d1
npx wrangler d1 execute gastos --local --file=./schema.sql
```

Expected: la salida incluye las filas `servicio_id` y `estado`.

```bash
npx wrangler d1 execute gastos --local --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mov_serv_mes';"
```

Expected: devuelve `idx_mov_serv_mes`.

- [ ] **Step 4: Verificar que el índice único realmente bloquea duplicados**

```bash
npx wrangler d1 execute gastos --local --command "INSERT INTO mov (id,fecha,descripcion,monto,cuenta_id,cuotas,servicio_id,estado,creado) VALUES ('t1','2026-08-05','probe',100,'mp',1,'s1','pagado','x'); INSERT OR IGNORE INTO mov (id,fecha,descripcion,monto,cuenta_id,cuotas,servicio_id,estado,creado) VALUES ('t2','2026-08-20','probe',100,'mp',1,'s1','pagado','x'); SELECT count(*) AS n FROM mov WHERE servicio_id='s1';"
```

Expected: `n = 1`. Las dos fechas caen en `2026-08`, así que el segundo insert se ignora.

Limpiar la fila de prueba:

```bash
npx wrangler d1 execute gastos --local --command "DELETE FROM mov WHERE servicio_id='s1';"
```

- [ ] **Step 5: Commit**

```bash
git add migracion-servicios.sql schema.sql
git commit -m "feat: schema de servicios y estado en mov"
```

---

### Task 3: API de servicios (alta, edición, baja)

Endpoints CRUD de `servicio` y `GET /api/state` devolviendo la lista. Todavía **sin** generación de gastos: esta tarea solo administra definiciones.

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `mesActualAR` de `src/servicios.mjs` (Task 1).
- Produces:
  - `GET /api/state` → `{cuentas, movs, servicios}`
  - `POST /api/servicios` → fila creada, 201
  - `PATCH /api/servicios/:id` → el servicio ya actualizado (objeto completo)
  - `DELETE /api/servicios/:id` → `{ok: true}` o 409 si ya generó gastos

- [ ] **Step 1: Importar el módulo puro**

Al tope de `src/index.js`, arriba del comentario existente, agregar:

```js
import { mesActualAR } from "./servicios.mjs";
```

- [ ] **Step 2: Devolver los servicios en `/api/state`**

Reemplazar el bloque `if (res === "state" && m === "GET")` por:

```js
    if (res === "state" && m === "GET") {
      const [cuentas, movs, servicios] = await env.DB.batch([
        env.DB.prepare("SELECT * FROM cuenta ORDER BY def DESC, nombre"),
        env.DB.prepare("SELECT * FROM mov ORDER BY fecha DESC, creado DESC LIMIT 2000"),
        env.DB.prepare("SELECT * FROM servicio ORDER BY activo DESC, modo, nombre")
      ]);
      return json({ cuentas: cuentas.results, movs: movs.results, servicios: servicios.results });
    }
```

- [ ] **Step 3: Agregar el alta de servicio**

Insertar antes del `return json({ error: "Ruta no encontrada" }, 404);`:

```js
    if (res === "servicios" && !rid && m === "POST") {
      const b = await request.json();
      const nombre = (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const monto = Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const dia = Math.min(Math.max(parseInt(b.dia) || 1, 1), 31);
      const modo = b.modo === "auto" ? "auto" : "manual";
      const cuenta = await env.DB.prepare("SELECT id FROM cuenta WHERE id = ?").bind(b.cuenta_id).first();
      if (!cuenta) return json({ error: "Medio de pago inexistente" }, 400);

      const row = {
        id: "s" + id(),
        nombre, monto, dia,
        cuenta_id: b.cuenta_id,
        cat: b.cat || null,
        modo,
        activo: 1,
        desde: mesActualAR(),
        creado: new Date().toISOString()
      };
      await env.DB.prepare(
        "INSERT INTO servicio (id,nombre,monto,dia,cuenta_id,cat,modo,activo,desde,creado) VALUES (?,?,?,?,?,?,?,1,?,?)"
      ).bind(row.id, row.nombre, row.monto, row.dia, row.cuenta_id, row.cat, row.modo, row.desde, row.creado).run();
      return json(row, 201);
    }
```

- [ ] **Step 4: Agregar la edición y la baja**

Inmediatamente debajo del bloque anterior:

```js
    if (res === "servicios" && rid && m === "PATCH") {
      const b = await request.json();
      const actual = await env.DB.prepare("SELECT * FROM servicio WHERE id = ?").bind(rid).first();
      if (!actual) return json({ error: "Servicio inexistente" }, 404);

      const nombre = b.nombre === undefined ? actual.nombre : (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const monto = b.monto === undefined ? actual.monto : Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const dia = b.dia === undefined ? actual.dia : Math.min(Math.max(parseInt(b.dia) || 1, 1), 31);
      const modo = b.modo === undefined ? actual.modo : (b.modo === "auto" ? "auto" : "manual");
      const cat = b.cat === undefined ? actual.cat : (b.cat || null);
      const activo = b.activo === undefined ? actual.activo : (b.activo ? 1 : 0);
      let cuenta_id = actual.cuenta_id;
      if (b.cuenta_id !== undefined) {
        const cuenta = await env.DB.prepare("SELECT id FROM cuenta WHERE id = ?").bind(b.cuenta_id).first();
        if (!cuenta) return json({ error: "Medio de pago inexistente" }, 400);
        cuenta_id = b.cuenta_id;
      }

      await env.DB.prepare(
        "UPDATE servicio SET nombre=?, monto=?, dia=?, cuenta_id=?, cat=?, modo=?, activo=? WHERE id=?"
      ).bind(nombre, monto, dia, cuenta_id, cat, modo, activo, rid).run();
      return json({ ...actual, nombre, monto, dia, cuenta_id, cat, modo, activo });
    }

    if (res === "servicios" && rid && m === "DELETE") {
      const usado = await env.DB.prepare("SELECT 1 FROM mov WHERE servicio_id = ? LIMIT 1").bind(rid).first();
      if (usado) return json({ error: "Ese servicio ya generó gastos. Dale de baja en vez de borrarlo." }, 409);
      await env.DB.prepare("DELETE FROM servicio WHERE id = ?").bind(rid).run();
      return json({ ok: true });
    }
```

- [ ] **Step 5: Verificar los endpoints contra `wrangler dev`**

En una terminal:

```bash
npx wrangler dev
```

En otra (el PIN local es vacío salvo que exista `.dev.vars`, así que `x-pin` puede ir vacío):

```bash
curl -s -X POST localhost:8787/api/servicios -H 'content-type: application/json' \
  -d '{"nombre":"Netflix","monto":7400,"dia":5,"cuenta_id":"vi","modo":"auto","cat":"Suscripciones"}'
```

Expected: 201 con un JSON que incluye `"id":"s..."`, `"activo":1` y `"desde"` en formato `YYYY-MM`.

```bash
curl -s localhost:8787/api/state | head -c 400
```

Expected: el JSON incluye la clave `servicios` con el Netflix recién creado.

```bash
curl -s -X POST localhost:8787/api/servicios -H 'content-type: application/json' \
  -d '{"nombre":"Roto","monto":0,"dia":5,"cuenta_id":"vi","modo":"auto"}'
```

Expected: 400 `{"error":"Monto inválido"}`.

- [ ] **Step 6: Commit**

```bash
git add src/index.js
git commit -m "feat: API de alta, edicion y baja de servicios"
```

---

### Task 4: Generación perezosa de los gastos del mes

El corazón de la feature. En cada `GET /api/state`, antes de responder, se insertan los gastos del mes corriente que falten.

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `mesActualAR`, `fechaDeServicio`, `estadoInicial` de `src/servicios.mjs`; el índice `idx_mov_serv_mes` de Task 2; el endpoint `/api/state` de Task 3.
- Produces: `generarDelMes(env) -> Promise<void>`, llamada al principio del handler de `state`.

- [ ] **Step 1: Ampliar el import**

Cambiar la línea de import al tope de `src/index.js` por:

```js
import { mesActualAR, fechaDeServicio, estadoInicial } from "./servicios.mjs";
```

- [ ] **Step 2: Escribir la función de generación**

Insertar arriba de `async function api(request, env) {`:

```js
// Materializa los gastos del mes corriente de cada servicio activo.
// El índice único parcial (servicio_id, mes) hace que repetir esto no duplique nada,
// así que es seguro llamarlo en cada arranque de la app y desde los dos teléfonos a la vez.
async function generarDelMes(env) {
  const mes = mesActualAR();
  const { results } = await env.DB.prepare(
    "SELECT * FROM servicio WHERE activo = 1 AND desde <= ?"
  ).bind(mes).all();
  if (!results.length) return;

  const creado = new Date().toISOString();
  await env.DB.batch(results.map(s => env.DB.prepare(
    "INSERT OR IGNORE INTO mov (id,fecha,descripcion,monto,cuenta_id,cuotas,cat,quien,servicio_id,estado,creado) " +
    "VALUES (?,?,?,?,?,1,?,NULL,?,?,?)"
  ).bind(
    id(), fechaDeServicio(mes, s.dia), s.nombre, s.monto,
    s.cuenta_id, s.cat, s.id, estadoInicial(s.modo), creado
  )));
}
```

- [ ] **Step 3: Llamarla desde `/api/state`**

Reemplazar la primera línea del bloque `state` para que la generación corra antes de leer:

```js
    if (res === "state" && m === "GET") {
      await generarDelMes(env);
      const [cuentas, movs, servicios] = await env.DB.batch([
```

(el resto del bloque queda igual)

- [ ] **Step 4: Verificar generación e idempotencia**

Con `npx wrangler dev` corriendo y el Netflix de la Task 3 ya cargado:

```bash
curl -s localhost:8787/api/state > /dev/null
curl -s localhost:8787/api/state > /dev/null
curl -s localhost:8787/api/state > /dev/null
npx wrangler d1 execute gastos --local --command "SELECT count(*) AS n, estado FROM mov WHERE servicio_id IS NOT NULL GROUP BY estado;"
```

Expected: `n = 1` con `estado = pagado`. Tres llamadas, un solo gasto: el índice único hizo su trabajo.

- [ ] **Step 5: Verificar que un manual nace pendiente**

```bash
curl -s -X POST localhost:8787/api/servicios -H 'content-type: application/json' \
  -d '{"nombre":"Edenor","monto":18000,"dia":15,"cuenta_id":"mp","modo":"manual","cat":"Servicios"}'
curl -s localhost:8787/api/state > /dev/null
npx wrangler d1 execute gastos --local --command "SELECT descripcion, fecha, estado, quien FROM mov WHERE servicio_id IS NOT NULL;"
```

Expected: dos filas. Netflix con `estado = pagado`, Edenor con `estado = pendiente`, ambas con `quien` en `NULL` y con `fecha` en el día configurado del mes corriente.

- [ ] **Step 6: Commit**

```bash
git add src/index.js
git commit -m "feat: generacion perezosa de los gastos del mes por servicio"
```

---

### Task 5: Pagar, omitir y proteger el borrado de medios

Cierra el ciclo de vida del gasto de servicio: pagarlo con el monto real, saltear un mes sin que se regenere, y evitar borrar un medio de pago que un servicio esté usando.

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: las columnas `estado` y `servicio_id` de Task 2.
- Produces:
  - `POST /api/movs/:id/pagar` con body `{monto}` → fila actualizada
  - `DELETE /api/movs/:id` → marca `omitido` si tiene `servicio_id`, borra si no
  - `DELETE /api/cuentas/:id` → 409 si un servicio la usa

- [ ] **Step 1: Agregar el endpoint de pago**

Insertar después del bloque `if (res === "movs" && rid && m === "DELETE")`:

```js
    if (res === "movs" && rid && action === "pagar" && m === "POST") {
      const b = await request.json();
      const monto = Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const mov = await env.DB.prepare("SELECT * FROM mov WHERE id = ?").bind(rid).first();
      if (!mov) return json({ error: "Gasto inexistente" }, 404);
      if (!mov.servicio_id) return json({ error: "Ese gasto no viene de un servicio" }, 400);

      // La fecha no se toca: queda la del vencimiento, así pagar tarde no
      // cambia el mes al que pertenece el gasto.
      await env.DB.prepare("UPDATE mov SET monto = ?, estado = 'pagado' WHERE id = ?")
        .bind(monto, rid).run();
      return json({ ...mov, monto, estado: "pagado" });
    }
```

- [ ] **Step 2: Convertir el borrado en omisión para los gastos de servicio**

Reemplazar el bloque `if (res === "movs" && rid && m === "DELETE")` por:

```js
    if (res === "movs" && rid && m === "DELETE") {
      const mov = await env.DB.prepare("SELECT servicio_id FROM mov WHERE id = ?").bind(rid).first();
      // Un gasto de servicio no se borra: se marca omitido. Si se borrara, el
      // INSERT OR IGNORE del próximo arranque lo volvería a crear.
      if (mov && mov.servicio_id) {
        await env.DB.prepare("UPDATE mov SET estado = 'omitido' WHERE id = ?").bind(rid).run();
        return json({ ok: true, omitido: true });
      }
      await env.DB.prepare("DELETE FROM mov WHERE id = ?").bind(rid).run();
      return json({ ok: true });
    }
```

- [ ] **Step 3: Proteger el borrado de medios de pago**

Reemplazar el bloque `if (res === "cuentas" && rid && m === "DELETE")` por:

```js
    if (res === "cuentas" && rid && m === "DELETE") {
      const usada = await env.DB.prepare("SELECT 1 FROM mov WHERE cuenta_id = ? LIMIT 1").bind(rid).first();
      if (usada) return json({ error: "Ese medio tiene gastos cargados" }, 409);
      const enServicio = await env.DB.prepare("SELECT 1 FROM servicio WHERE cuenta_id = ? LIMIT 1").bind(rid).first();
      if (enServicio) return json({ error: "Ese medio lo usa un servicio" }, 409);
      await env.DB.prepare("DELETE FROM cuenta WHERE id = ?").bind(rid).run();
      return json({ ok: true });
    }
```

- [ ] **Step 4: Verificar el pago**

Con `npx wrangler dev` corriendo, obtener el id del Edenor pendiente:

```bash
npx wrangler d1 execute gastos --local --command "SELECT id, descripcion, monto FROM mov WHERE estado='pendiente';"
```

Copiar el `id` de la salida y usarlo en los comandos siguientes (reemplazar `ID_ACA`):

```bash
curl -s -X POST localhost:8787/api/movs/ID_ACA/pagar -H 'content-type: application/json' -d '{"monto":21350}'
```

Expected: JSON con `"estado":"pagado"` y `"monto":21350`. La `fecha` es la misma que antes.

- [ ] **Step 5: Verificar la omisión**

```bash
curl -s -X DELETE localhost:8787/api/movs/ID_ACA
npx wrangler d1 execute gastos --local --command "SELECT estado FROM mov WHERE id='ID_ACA';"
curl -s localhost:8787/api/state > /dev/null
npx wrangler d1 execute gastos --local --command "SELECT count(*) AS n FROM mov WHERE servicio_id IS NOT NULL;"
```

Expected: el estado queda `omitido`, y tras volver a llamar a `/api/state` la cantidad de filas **no** aumenta — el gasto omitido no se regeneró.

- [ ] **Step 6: Verificar el 409 al borrar un medio usado por un servicio**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE localhost:8787/api/cuentas/vi
```

Expected: `409`.

- [ ] **Step 7: Commit**

```bash
git add src/index.js
git commit -m "feat: pagar, omitir y proteger medios usados por servicios"
```

---

### Task 6: Pestaña Servicios — estructura y render

Agrega la cuarta pestaña con el número de gasto fijo mensual y los dos grupos de servicios. Solo lectura: el alta y las acciones vienen en las tareas siguientes.

Al terminar esta tarea el botón Pagar de los vencidos ya se dibuja pero todavía no hace
nada — su handler llega en la Task 7. Es esperado, no un bug.

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `GET /api/state` devolviendo `servicios` (Task 3).
- Produces: variable global `servicios`, función `renderServicios()`, sección `#v-serv`, helpers `pendientesVencidos()` y `nombreCuenta(id)`.

- [ ] **Step 1: Agregar el CSS**

En el `<style>`, después de la regla `.tag{...}`, agregar:

```css
  .tag.fijo{background:#E6F0EE; color:var(--accent)}
  .tag.venc{background:#FBEAE6; color:var(--danger)}
  .dot{display:inline-block; width:7px; height:7px; border-radius:50%;
    background:var(--danger); margin-left:5px; vertical-align:middle}
  .pay{background:var(--accent); color:#fff; border:none; border-radius:8px;
    padding:7px 11px; font-size:13px; font-weight:700; white-space:nowrap}
  .payrow{display:flex; gap:8px; align-items:center; padding:10px 0}
  .payrow input{flex:1; font-size:16px; padding:9px 10px}
  .off{opacity:.5}
```

- [ ] **Step 2: Agregar la sección al HTML**

Insertar entre `</section>` de `#v-month` y `<section id="v-acc" hidden>`:

```html
  <section id="v-serv" hidden>
    <h1>Gasto fijo mensual</h1>
    <div class="card">
      <div class="total"><div class="big mono" id="fijototal">$0</div></div>
      <p class="hint" id="fijodet"></p>
    </div>
    <div class="sect">Débito automático</div>
    <div class="card" id="servauto"></div>
    <div class="sect">Los pagás vos</div>
    <div class="card" id="servman"></div>
  </section>
```

- [ ] **Step 3: Agregar la pestaña al nav**

Reemplazar el `<nav role="tablist">` completo por:

```html
<nav role="tablist">
  <button data-v="load" aria-selected="true">Cargar</button>
  <button data-v="month" aria-selected="false">Mes</button>
  <button data-v="serv" aria-selected="false">Servicios<span class="dot" id="navdot" hidden></span></button>
  <button data-v="acc" aria-selected="false">Medios</button>
</nav>
```

- [ ] **Step 4: Declarar el estado y los helpers**

Cambiar la línea `let cuentas = [], movs = [], cursor = new Date();` por:

```js
let cuentas = [], movs = [], servicios = [], cursor = new Date();
```

Y agregar después de la función `esc`:

```js
const nombreCuenta = cid => (cuentas.find(x => x.id === cid) || {nombre:"?"}).nombre;
const hoyISO = () => new Date().toISOString().slice(0,10);

// Pendientes cuyo vencimiento ya pasó, incluidos los de meses anteriores:
// una boleta de julio sin pagar tiene que seguir avisando en agosto.
const pendientesVencidos = () => movs.filter(m => m.estado === "pendiente" && m.fecha <= hoyISO());
```

- [ ] **Step 5: Escribir `renderServicios()`**

Agregar antes de `function renderAcc(){`:

```js
function renderServicios(){
  const mes = ym(new Date());
  const act = servicios.filter(s => s.activo);
  const suma = l => l.reduce((a,s) => a + s.monto, 0);
  const auto = act.filter(s => s.modo === "auto");
  const man  = act.filter(s => s.modo === "manual");

  $("fijototal").textContent = fmt(suma(act));
  $("fijodet").textContent = act.length
    ? `automáticos ${fmt(suma(auto))} · los pagás vos ${fmt(suma(man))}`
    : "Cargá los servicios para saber cuánto les sale fijo por mes.";

  $("servauto").innerHTML = auto.length ? auto.map(s => `<div class="row">
    <div class="name">${esc(s.nombre)}
      <span class="sub">${esc(nombreCuenta(s.cuenta_id))} · día ${s.dia}</span></div>
    <div class="val mono">${fmt(s.monto)}</div></div>`).join("")
    : `<div class="empty">Ninguno todavía. Acá van Netflix, Spotify o el seguro: lo que se debita solo.</div>`;

  const vencidos = movs
    .filter(m => m.estado === "pendiente" && m.fecha.slice(0,7) < mes)
    .sort((a,b) => a.fecha < b.fecha ? -1 : 1);

  const filaVencida = m => `<div class="row">
    <div class="name">${esc(m.descripcion)}<span class="tag venc">vencido</span>
      <span class="sub">${esc(nombreCuenta(m.cuenta_id))} · venció el ${m.fecha.slice(8)}/${m.fecha.slice(5,7)}</span></div>
    <div class="val mono">${fmt(m.monto)}</div>
    <button class="pay" data-pay="${m.id}">Pagar</button></div>`;

  const filaMes = s => {
    const mv = movs.find(m => m.servicio_id === s.id && m.fecha.slice(0,7) === mes);
    if(!mv) return `<div class="row off">
      <div class="name">${esc(s.nombre)}<span class="sub">${esc(nombreCuenta(s.cuenta_id))} · día ${s.dia}</span></div>
      <div class="val mono">${fmt(s.monto)}</div></div>`;
    const estado = mv.estado === "pagado" ? "pagado"
      : mv.estado === "omitido" ? "salteado este mes"
      : "vence " + mv.fecha.slice(8);
    return `<div class="row${mv.estado === "omitido" ? " off" : ""}">
      <div class="name">${esc(s.nombre)}
        <span class="sub">${esc(nombreCuenta(s.cuenta_id))} · ${estado}</span></div>
      <div class="val mono">${fmt(mv.monto)}</div>
      ${mv.estado === "pendiente" ? `<button class="pay" data-pay="${mv.id}">Pagar</button>` : ""}</div>`;
  };

  $("servman").innerHTML = (man.length || vencidos.length)
    ? vencidos.map(filaVencida).join("") + man.map(filaMes).join("")
    : `<div class="empty">Ninguno todavía. Acá van la luz, el agua o las expensas: lo que pagás vos.</div>`;

  const n = pendientesVencidos().length;
  $("navdot").hidden = n === 0;
}
```

- [ ] **Step 6: Cablear el boot y la navegación**

En `boot()`, cambiar la asignación por:

```js
    cuentas = s.cuentas; movs = s.movs; servicios = s.servicios || []; showErr("");
```

y la última línea de `boot()` por:

```js
  fillSelects(); renderLoad(); renderUltimos(); renderMonth(); renderServicios(); renderAcc();
```

En el handler de navegación, cambiar la lista de vistas y agregar el render:

```js
document.querySelectorAll("nav button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach(x => x.setAttribute("aria-selected", x === b));
  ["load","month","serv","acc"].forEach(v => $("v-"+v).hidden = v !== b.dataset.v);
  if(b.dataset.v === "month") renderMonth();
  if(b.dataset.v === "serv") renderServicios();
  if(b.dataset.v === "acc") renderAcc();
}));
```

- [ ] **Step 7: Verificar a mano**

```bash
npx wrangler dev
```

Abrir `http://localhost:8787` y tocar la pestaña Servicios.

Expected:
- El nav muestra cuatro pestañas y la de Servicios tiene un punto rojo (hay un Edenor pendiente de las tareas anteriores, salvo que se haya omitido).
- Arriba aparece "Gasto fijo mensual" con la suma de Netflix + Edenor, y debajo el desglose `automáticos $7.400 · los pagás vos $18.000`.
- Netflix aparece bajo "Débito automático", sin botón.
- Edenor aparece bajo "Los pagás vos" con un botón Pagar.
- Ninguna fila está pintada de azul ni de rosa.

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "feat: pestana Servicios con gasto fijo mensual"
```

---

### Task 7: Acciones de la pestaña Servicios — alta, baja y pago

Agrega el formulario de alta, el botón de baja y el flujo de pago con input inline.

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `POST /api/servicios`, `PATCH /api/servicios/:id`, `POST /api/movs/:id/pagar` (Tasks 3 y 5); `renderServicios()` (Task 6).
- Produces: formulario `#addserv`, handlers de `#servman` y `#servauto`.

- [ ] **Step 1: Agregar el botón de baja al render**

En `renderServicios()`, en la plantilla de `$("servauto")`, agregar el botón antes de cerrar el div, dejando la fila así:

```js
  $("servauto").innerHTML = auto.length ? auto.map(s => `<div class="row">
    <div class="name">${esc(s.nombre)}
      <span class="sub">${esc(nombreCuenta(s.cuenta_id))} · día ${s.dia}</span></div>
    <div class="val mono">${fmt(s.monto)}</div>
    <button class="del" data-off="${s.id}">baja</button></div>`).join("")
    : `<div class="empty">Ninguno todavía. Acá van Netflix, Spotify o el seguro: lo que se debita solo.</div>`;
```

Y en `filaMes`, agregar el mismo botón de baja después del monto, en las dos ramas del `return`. La rama sin movimiento queda:

```js
    if(!mv) return `<div class="row off">
      <div class="name">${esc(s.nombre)}<span class="sub">${esc(nombreCuenta(s.cuenta_id))} · día ${s.dia}</span></div>
      <div class="val mono">${fmt(s.monto)}</div>
      <button class="del" data-off="${s.id}">baja</button></div>`;
```

y la rama con movimiento:

```js
    return `<div class="row${mv.estado === "omitido" ? " off" : ""}">
      <div class="name">${esc(s.nombre)}
        <span class="sub">${esc(nombreCuenta(s.cuenta_id))} · ${estado}</span></div>
      <div class="val mono">${fmt(mv.monto)}</div>
      ${mv.estado === "pendiente" ? `<button class="pay" data-pay="${mv.id}">Pagar</button>` : ""}
      <button class="del" data-off="${s.id}">baja</button></div>`;
```

- [ ] **Step 2: Agregar el formulario de alta al HTML**

Dentro de `<section id="v-serv">`, después del `<div class="card" id="servman"></div>`:

```html
    <div class="sect">Agregar servicio</div>
    <div class="card">
      <div class="field">
        <label for="s-nom">Nombre</label>
        <input id="s-nom" placeholder="Netflix, Edenor, expensas…" autocomplete="off">
      </div>
      <div class="inline field">
        <div>
          <label for="s-monto">Monto</label>
          <input id="s-monto" inputmode="decimal" placeholder="0" autocomplete="off">
        </div>
        <div>
          <label for="s-dia">Día del mes</label>
          <input id="s-dia" inputmode="numeric" value="10">
        </div>
      </div>
      <div class="field">
        <label for="s-modo">Cómo se paga</label>
        <select id="s-modo">
          <option value="manual">Lo pago yo</option>
          <option value="auto">Se debita solo</option>
        </select>
      </div>
      <div class="field">
        <label for="s-cuenta">Medio de pago</label>
        <select id="s-cuenta"></select>
      </div>
      <div class="field">
        <label for="s-cat">Categoría <span style="text-transform:none;letter-spacing:0">(opcional)</span></label>
        <select id="s-cat"></select>
      </div>
      <button class="primary" id="addserv">Agregar servicio</button>
      <p class="hint">Los que se debitan solos se cargan como gasto sin que hagas nada. Los que pagás vos te esperan con un botón para confirmar el monto real.</p>
    </div>
```

- [ ] **Step 3: Poblar los selects del formulario**

En `fillSelects()`, antes del cierre de la función, agregar:

```js
  const ss = $("s-cuenta"), sprev = ss.value;
  ss.innerHTML = cuentas.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  if(cuentas.some(c => c.id === sprev)) ss.value = sprev;
  if(!$("s-cat").options.length)
    $("s-cat").innerHTML = `<option value="">—</option>` + CATS.map(c=>`<option>${c}</option>`).join("");
```

- [ ] **Step 4: Agregar el handler de alta**

Después del handler de `$("addacc")`:

```js
$("addserv").addEventListener("click", async () => {
  const nombre = $("s-nom").value.trim();
  if(!nombre){ $("s-nom").focus(); return; }
  const monto = parseMonto($("s-monto").value);
  if(!monto){ $("s-monto").focus(); return; }
  try {
    const s = await api("servicios", "POST", {
      nombre, monto, dia: +$("s-dia").value, cuenta_id: $("s-cuenta").value,
      modo: $("s-modo").value, cat: $("s-cat").value
    });
    servicios.push(s);
    $("s-nom").value = ""; $("s-monto").value = "";
    showErr(""); renderServicios(); toast(nombre + " agregado");
  } catch(e){ showErr(e.message); }
});
```

- [ ] **Step 5: Agregar el handler de baja y de pago**

A continuación:

```js
async function darDeBaja(sid){
  const s = servicios.find(x => x.id === sid);
  if(!s || !confirm(`¿Dar de baja ${s.nombre}? Deja de generar gastos, pero el historial queda.`)) return;
  try {
    await api("servicios/" + sid, "PATCH", { activo: 0 });
    s.activo = 0;
    showErr(""); renderServicios(); toast(s.nombre + " dado de baja");
  } catch(e){ showErr(e.message); }
}

// El botón Pagar convierte la fila en un input con el monto esperado precargado,
// porque en la luz o el gas casi siempre difiere del estimado.
function abrirPago(mid, fila){
  const mv = movs.find(m => m.id === mid);
  if(!mv || fila.querySelector(".payrow")) return;
  const box = document.createElement("div");
  box.className = "payrow";
  box.innerHTML = `<input inputmode="decimal" value="${Math.round(mv.monto)}" aria-label="Monto real">
    <button class="pay" data-ok="${mid}">Confirmar</button>`;
  fila.after(box);
  box.querySelector("input").focus();
  box.querySelector("input").select();
}

async function confirmarPago(mid, box){
  const monto = parseMonto(box.querySelector("input").value);
  if(!monto) return;
  try {
    const row = await api("movs/" + mid + "/pagar", "POST", { monto });
    const i = movs.findIndex(m => m.id === mid);
    if(i >= 0) movs[i] = row;
    showErr(""); renderServicios(); renderMonth(); renderUltimos(); toast("Pagado");
  } catch(e){ showErr("No se pudo pagar: " + e.message); }
}

["servauto","servman"].forEach(cid => $(cid).addEventListener("click", e => {
  const off = e.target.dataset.off, pay = e.target.dataset.pay, ok = e.target.dataset.ok;
  if(off) return darDeBaja(off);
  if(pay) return abrirPago(pay, e.target.closest(".row"));
  if(ok)  return confirmarPago(ok, e.target.closest(".payrow"));
}));
```

- [ ] **Step 6: Verificar a mano**

```bash
npx wrangler dev
```

En `http://localhost:8787`, pestaña Servicios:

1. Cargar un servicio manual "Aysa", monto 12000, día 20, medio MP. Expected: aparece bajo "Los pagás vos", el número de gasto fijo sube 12.000, y el toast dice "Aysa agregado".
2. Recargar la página. Expected: Aysa ahora muestra "vence 20" y un botón Pagar (la generación del backend le creó el pendiente).
3. Tocar Pagar en Aysa. Expected: se abre un input debajo con `12000` precargado y seleccionado.
4. Cambiar a `13500` y tocar Confirmar. Expected: toast "Pagado", la fila pasa a "pagado" con $13.500 y desaparece el botón.
5. Tocar "baja" en Netflix y aceptar. Expected: Netflix desaparece del listado y el gasto fijo mensual baja 7.400.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: alta, baja y pago de servicios desde la app"
```

---

### Task 8: Vista Mes — pendientes, tag fijo y filtrado de totales

Los pendientes y omitidos dejan de contar en los totales, aparece la sección de pendientes con subtotal, y las filas de servicio se distinguen con un tag.

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `estado` en los movimientos (Task 2), `renderServicios()` (Task 6).
- Produces: `sumaAlTotal(m) -> boolean`, sección `#pendientes` en la vista Mes.

- [ ] **Step 1: Agregar el helper de filtrado**

Después de `pendientesVencidos`, agregar:

```js
// Un gasto suma a los totales si es común (estado NULL) o si ya se pagó.
// Los pendientes y los omitidos quedan afuera: el total del mes es plata que salió.
const sumaAlTotal = m => !m.estado || m.estado === "pagado";
```

El nombre no es `cuenta` a propósito: ya existen el array `cuentas` y el select `#cuenta`,
y un tercer significado de la misma palabra haría el código ilegible.

- [ ] **Step 2: Agregar la sección de pendientes al HTML**

En `<section id="v-month">`, entre el `<div class="card" id="mlist"></div>` y `<div class="sect">Ya comprometido en cuotas</div>`:

```html
    <div class="sect" id="pend-sect" hidden>Pendientes de pagar</div>
    <div class="card" id="pendientes" hidden></div>
```

- [ ] **Step 3: Filtrar los totales en `renderMonth()`**

En `renderMonth()`, reemplazar la línea que arma `filas` por:

```js
  movs.filter(sumaAlTotal).forEach(m => impactos(m).forEach(i => { if(i.mes === key) filas.push({m, i}); }));
```

Y la que arma `fut` por:

```js
  movs.filter(sumaAlTotal).forEach(m => impactos(m).forEach(i => { if(i.mes > key && i.de > 1) fut[i.mes] = (fut[i.mes]||0) + i.monto; }));
```

- [ ] **Step 4: Agregar el tag `fijo` a las filas de servicio**

En `renderMonth()`, dentro del `map` de `$("mlist")`, reemplazar la línea del `cuota` y el `return` por:

```js
    const cuota = i.de > 1 ? `<span class="tag">${i.nro}/${i.de}</span>` : "";
    const fijo = m.servicio_id ? `<span class="tag fijo">fijo</span>` : "";
    return `<div class="row ${m.quien ? "q-"+m.quien : ""}"><div class="name">${esc(m.descripcion)}${cuota}${fijo}
      <span class="sub">${esc(c.nombre)}${m.cat ? " · "+esc(m.cat) : ""} · comprado ${m.fecha.slice(8)}/${m.fecha.slice(5,7)}</span></div>
      <div class="val mono">${fmt(i.monto)}</div>
      <button class="del" data-del="${m.id}">borrar</button></div>`;
```

- [ ] **Step 5: Renderizar la sección de pendientes**

Al final de `renderMonth()`, después del bloque que llena `$("futuro")`:

```js
  const pend = movs.filter(m => m.estado === "pendiente" && m.fecha.slice(0,7) === key)
                   .sort((a,b) => a.fecha < b.fecha ? -1 : 1);
  const hayPend = pend.length > 0;
  $("pend-sect").hidden = !hayPend;
  $("pendientes").hidden = !hayPend;
  if(hayPend){
    const totalPend = pend.reduce((a,m) => a + m.monto, 0);
    $("pendientes").innerHTML = pend.map(m => `<div class="row">
      <div class="name">${esc(m.descripcion)}
        <span class="sub">${esc(nombreCuenta(m.cuenta_id))} · vence ${m.fecha.slice(8)}/${m.fecha.slice(5,7)}</span></div>
      <div class="val mono">${fmt(m.monto)}</div></div>`).join("") +
      `<div class="row"><div class="name"><b>Falta pagar</b></div>
        <div class="val mono">${fmt(totalPend)}</div></div>`;
  }
```

- [ ] **Step 6: Actualizar el borrado para que refresque servicios**

En el handler de `$("mlist")`, reemplazar el bloque `try` por:

```js
  try {
    const r = await api("movs/" + id, "DELETE");
    if(r.omitido){
      const mv = movs.find(m => m.id === id);
      if(mv) mv.estado = "omitido";
    } else {
      movs = movs.filter(m => m.id !== id);
    }
    showErr(""); renderMonth(); renderUltimos(); renderServicios();
    toast(r.omitido ? "Salteado este mes" : "Gasto borrado");
  } catch(e){ showErr("No se borró: " + e.message); }
```

Y cambiar el texto del `confirm` de arriba por:

```js
  if(!confirm("¿Borrar este gasto? Si viene de un servicio, se saltea solo este mes.")) return;
```

- [ ] **Step 7: Verificar a mano**

```bash
npx wrangler dev
```

En `http://localhost:8787`, pestaña Mes, con al menos un servicio manual pendiente y uno automático del mes corriente:

1. Expected: el Netflix automático aparece en Movimientos con un tag verde `fijo` (o en el mes del resumen que corresponda si está en una tarjeta de crédito).
2. Expected: aparece la sección "Pendientes de pagar" con las filas pendientes y una fila final "Falta pagar" con el subtotal.
3. Expected: el total del mes de arriba **no** incluye los pendientes. Sumar a mano las filas de Movimientos debe dar exactamente el total.
4. Pagar el pendiente desde la pestaña Servicios y volver a Mes. Expected: desaparece de Pendientes, aparece en Movimientos, y el total del mes sube por el monto real.
5. Borrar una fila con tag `fijo`. Expected: toast "Salteado este mes", desaparece del listado, y recargar la página no la resucita.

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "feat: pendientes y tag fijo en la vista Mes"
```

---

### Task 9: Verificación end-to-end y documentación

Corre la lista de verificación completa del spec contra la base local, aplica la migración a la base remota y deja el contexto del proyecto actualizado.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Correr los tests unitarios**

```bash
node --test
```

Expected: `# fail 0`.

- [ ] **Step 2: Correr la verificación del spec**

Arrancar de una base local limpia, para no arrastrar los servicios de prueba de las tareas
anteriores:

```bash
rm -rf .wrangler/state/v3/d1
npx wrangler d1 execute gastos --local --file=./schema.sql
npx wrangler dev
```

Recorrer los nueve puntos de la sección "Verificación" del spec
`docs/superpowers/specs/2026-08-04-servicios-gastos-fijos-design.md`.

El punto 7 (día 31 en un mes de 30) se verifica sin esperar al mes que viene, insertando el servicio con `desde` en el pasado y consultando la fecha generada:

```bash
curl -s -X POST localhost:8787/api/servicios -H 'content-type: application/json' \
  -d '{"nombre":"Prueba 31","monto":1000,"dia":31,"cuenta_id":"mp","modo":"auto"}'
curl -s localhost:8787/api/state > /dev/null
npx wrangler d1 execute gastos --local --command "SELECT descripcion, fecha FROM mov WHERE descripcion='Prueba 31';"
```

Expected: la fecha cae en el último día del mes corriente, nunca en un día 31 inexistente.

Anotar cualquier punto que falle y arreglarlo antes de seguir. No marcar este paso como hecho con puntos en rojo.

- [ ] **Step 3: Aplicar la migración a la base remota**

```bash
npx wrangler d1 execute gastos --remote --file=./migracion-servicios.sql
```

Expected: `success: true`. Si la columna ya existiera, SQLite corta con "duplicate column name" y la migración se revierte entera — en ese caso, revisar qué parte ya estaba aplicada antes de reintentar.

- [ ] **Step 4: Actualizar `CLAUDE.md`**

En la sección "Stack", agregar a la lista de archivos:

```
src/servicios.mjs    lógica pura de servicios (mes en UTC-3, acotado de días); tests al lado
migracion-servicios.sql  tabla servicio + estado en mov, ya aplicado
```

En "Modelo de datos", agregar después del bloque de `mov`:

```sql
servicio(id, nombre, monto, dia, cuenta_id, cat, modo, activo, desde, creado)
  modo: 'auto' (débito automático) | 'manual' (lo pagan ellos)
  desde: YYYY-MM, primer mes que corresponde
```

Y agregar a `mov` las dos columnas nuevas en la descripción existente:

```
  servicio_id: de qué servicio salió; NULL si es un gasto suelto
  estado: NULL para gastos comunes; 'pendiente' | 'pagado' | 'omitido'
```

En "Reglas de negocio que no son obvias", agregar:

```markdown
- **Los servicios no se guardan mes a mes: se materializan solos.** Cada `GET /api/state`
  inserta los gastos del mes corriente que falten, con un `INSERT OR IGNORE` protegido por
  el índice único `(servicio_id, mes)`. Por eso abrir la app veinte veces no duplica nada.
- **Borrar un gasto de servicio lo marca `omitido`, no lo elimina.** Si se borrara, el
  próximo arranque lo volvería a crear.
- **Un pendiente no suma al total del mes.** Los totales filtran
  `estado IS NULL OR estado = 'pagado'`, así el total sigue siendo plata que salió.
- **Editar el monto de un servicio no toca el pasado.** El precio nuevo rige del mes
  siguiente. Esa es la razón de guardar filas reales en vez de proyectar al vuelo.
```

En "Cosas pendientes / ideas", borrar nada y agregar:

```markdown
- Editar un servicio ya creado desde la app (hoy solo se puede dar de baja).
```

- [ ] **Step 5: Commit y push**

```bash
git add CLAUDE.md
git commit -m "docs: documentar servicios y gastos fijos en el contexto del proyecto"
git push origin main
```

Expected: Cloudflare toma el push y deploya solo.

- [ ] **Step 6: Verificar en producción**

Abrir la app publicada, ir a Servicios y cargar un servicio real.

Expected: se guarda, aparece en el listado, y recargar no lo duplica.

---

## Notas para quien ejecute

- **No agregar `package.json`.** `node --test` funciona sin él porque los tests son `.mjs` y Node los trata como módulos ES por la extensión. Un `package.json` puede alterar el pipeline de build de Cloudflare, que hoy anda solo con push.
- **El orden importa.** Las tareas 3, 4 y 5 tocan todas `src/index.js` y las 6, 7 y 8 tocan todas `public/index.html`. Ejecutarlas fuera de orden genera conflictos.
- **La migración remota (Task 9, Step 3) es de ida.** Correrla recién cuando la verificación local esté verde.
