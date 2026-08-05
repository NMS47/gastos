# Límites de tarjeta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder editar el cierre y el vencimiento de una tarjeta, y ver cuánto límite queda en un pago y en cuotas, con barra de progreso.

**Architecture:** Cinco columnas nuevas en `cuenta` guardan los dos límites, las dos bases manuales y el mes del último resumen pagado. El "usado" no se guarda: se calcula al renderizar sobre `impactos()`, con una sola regla — un gasto ocupa límite hasta que su resumen esté pagado. El botón "pagué el resumen" avanza el corte y borra la base de un pago.

**Tech Stack:** Cloudflare Worker (ESM, sin framework), D1/SQLite, HTML+CSS+JS vanilla inline en un archivo, `node --test` nativo para la lógica pura.

**Spec:** `docs/superpowers/specs/2026-08-05-limites-tarjeta-design.md`

## Global Constraints

- **Cero dependencias.** El proyecto no tiene `package.json` y no debe tenerlo. Los tests usan el runner nativo de Node.
- **Correr los tests con `node --test` a secas, desde la raíz del repo.** En Windows, pasarle un directorio (`node --test src/`) hace que Node lo trate como archivo de test y falle con un `'test failed'` sin detalle.
- **Sin build step.** `wrangler.toml` apunta `main = "src/index.js"`; wrangler bundlea. Importar un `.mjs` desde `src/index.js` ya está verificado.
- **Todo el texto de la UI en español rioplatense, voseo, sentence case.**
- **Montos con el helper `fmt()`** — `toLocaleString("es-AR")`, sin decimales.
- **Colores desde las variables CSS**: `--accent` verde, `--danger` rojo, `--muted` gris.
- **El umbral de alerta de la barra es 90% inclusive**: exactamente 90% ya es rojo.
- **`esc()` no escapa comillas.** Nunca interpolar un string del usuario dentro de un atributo HTML. Para precargar un `value`, asignarlo por propiedad JS después de insertar el elemento.
- **Argentina es siempre UTC-3**, sin horario de verano. El Worker lo fuerza a mano; el frontend usa componentes locales del navegador. No unificar.
- **No tocar `impactos()`.** Es la función central del proyecto.
- Antes de tocar la base de producción, leer la cabecera de la migración: backup, orden respecto del deploy, y qué hacer si falla a la mitad.

---

### Task 1: `mesResumenCerrado` puro, con tests

Traduce "pagué el resumen que cerró último" al mes que `impactos()` le asigna a ese resumen. Es la única aritmética sutil de la feature: equivocarse por un mes libera de más o de menos límite, sin ningún síntoma visible.

De paso extrae de `src/servicios.mjs` el corrimiento a hora argentina, que hoy está embebido en `mesActualAR` y ahora hace falta en dos módulos.

**Files:**
- Modify: `src/servicios.mjs`
- Create: `src/tarjetas.mjs`
- Create: `src/tarjetas.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `hoyAR(ahora?: Date) -> Date` (desde `src/servicios.mjs`) — un `Date` corrido a hora argentina, para leerlo con los getters `getUTC*`
  - `mesResumenCerrado(cierre: number, ahora?: Date) -> string` (desde `src/tarjetas.mjs`) — `"YYYY-MM"`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/tarjetas.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mesResumenCerrado } from "./tarjetas.mjs";

test("antes del cierre, el último resumen cerrado es el del mes corriente", () => {
  // 5 de agosto, cierre 20: el último resumen cerró el 20 de julio y contiene
  // compras del 21/6 al 20/7. Una compra del 10/7 cae, según impactos(), en el
  // resumen de agosto.
  assert.equal(mesResumenCerrado(20, new Date("2026-08-05T15:00:00Z")), "2026-08");
});

test("después del cierre, el último resumen cerrado es el del mes siguiente", () => {
  // 25 de agosto, cierre 20: cerró el del 20 de agosto, que es el resumen de septiembre.
  assert.equal(mesResumenCerrado(20, new Date("2026-08-25T15:00:00Z")), "2026-09");
});

test("el día del cierre todavía cuenta como antes (umbral inclusive)", () => {
  assert.equal(mesResumenCerrado(20, new Date("2026-08-20T15:00:00Z")), "2026-08");
  assert.equal(mesResumenCerrado(20, new Date("2026-08-21T15:00:00Z")), "2026-09");
});

test("cruza el año correctamente", () => {
  assert.equal(mesResumenCerrado(20, new Date("2026-12-25T15:00:00Z")), "2027-01");
  assert.equal(mesResumenCerrado(20, new Date("2026-12-05T15:00:00Z")), "2026-12");
});

test("usa hora argentina, no UTC", () => {
  // 31/07 22:00 en Argentina = 01/08 01:00 UTC. En hora argentina el día es 31,
  // posterior al cierre 20, así que el resumen cerrado es el de agosto.
  assert.equal(mesResumenCerrado(20, new Date("2026-08-01T01:00:00Z")), "2026-08");
  // Y el 1 de agosto a las 01:00 argentinas el día es 1, anterior al cierre.
  assert.equal(mesResumenCerrado(20, new Date("2026-08-01T04:00:00Z")), "2026-08");
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
node --test
```

Expected: FAIL — `Cannot find module` apuntando a `src/tarjetas.mjs`. Los 6 tests de `servicios.test.mjs` siguen pasando.

- [ ] **Step 3: Extraer `hoyAR` en `src/servicios.mjs`**

Reemplazar la función `mesActualAR` existente por estas dos:

```js
// Un Date corrido a hora argentina, para leerlo con los getters getUTC*.
export function hoyAR(ahora = new Date()) {
  return new Date(ahora.getTime() - OFFSET_AR_MS);
}

export function mesActualAR(ahora = new Date()) {
  const d = hoyAR(ahora);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
```

`OFFSET_AR_MS` ya existe al tope del archivo y no se toca. Esto no cambia ningún comportamiento: los 6 tests de `servicios.test.mjs` tienen que seguir pasando sin modificarlos.

- [ ] **Step 4: Crear `src/tarjetas.mjs`**

```js
// Lógica pura de tarjetas de crédito. Sin D1, sin fetch: testeable con `node --test`.
import { hoyAR } from "./servicios.mjs";

// El mes que impactos() le asigna al último resumen que YA cerró.
// Con cierre 20: el 5 de agosto el último resumen cerró el 20 de julio, y sus compras
// caen en el resumen de agosto → "2026-08". El 25 de agosto ya cerró el del 20 de
// agosto, que es el resumen de septiembre → "2026-09".
export function mesResumenCerrado(cierre, ahora = new Date()) {
  const d = hoyAR(ahora);
  const salto = d.getUTCDate() <= cierre ? 0 : 1;
  const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + salto, 1));
  return f.getUTCFullYear() + "-" + String(f.getUTCMonth() + 1).padStart(2, "0");
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

```bash
node --test
```

Expected: PASS — `# pass 11`, `# fail 0` (6 de servicios + 5 de tarjetas).

- [ ] **Step 6: Commit**

```bash
git add src/servicios.mjs src/tarjetas.mjs src/tarjetas.test.mjs
git commit -m "feat: mesResumenCerrado puro con tests, hoyAR extraido"
```

---

### Task 2: Migración de base de datos

Cinco columnas nuevas en `cuenta`. Puramente aditiva: las cuentas existentes quedan válidas sin backfill.

**Files:**
- Create: `migracion-limites.sql`
- Modify: `schema.sql`

**Interfaces:**
- Consumes: nada.
- Produces: columnas `cuenta.limite_pago`, `cuenta.limite_cuotas`, `cuenta.base_pago`, `cuenta.base_cuotas`, `cuenta.pagado_hasta`.

- [ ] **Step 1: Escribir la migración**

Crear `migracion-limites.sql`:

```sql
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
```

- [ ] **Step 2: Actualizar `schema.sql`**

Reemplazar el bloque `CREATE TABLE IF NOT EXISTS cuenta (...)` completo por:

```sql
CREATE TABLE IF NOT EXISTS cuenta (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('debito','credito')),
  cierre        INTEGER,          -- día de cierre (solo crédito)
  venc          INTEGER,          -- día de pago del resumen (solo crédito)
  def           INTEGER NOT NULL DEFAULT 0,
  limite_pago   REAL,             -- tope en un pago; NULL = todavía no se cargó
  limite_cuotas REAL,             -- tope en cuotas; NULL = todavía no se cargó
  base_pago     REAL NOT NULL DEFAULT 0,  -- lo que ya se debía en un pago al empezar
  base_cuotas   REAL NOT NULL DEFAULT 0,  -- ídem en cuotas
  pagado_hasta  TEXT              -- YYYY-MM del último resumen pagado; NULL = ninguno
);
```

- [ ] **Step 3: Verificar contra una base local limpia**

```bash
rm -rf .wrangler/state/v3/d1
npx wrangler d1 execute gastos --local --file=./schema.sql
npx wrangler d1 execute gastos --local --command "PRAGMA table_info(cuenta);"
```

Expected: aparecen las once columnas, incluidas las cinco nuevas.

- [ ] **Step 4: Verificar el camino de la migración sobre el schema viejo**

El `CREATE TABLE IF NOT EXISTS` no agrega columnas a una tabla que ya existe, así que hay que probar los `ALTER TABLE` contra la versión anterior del schema, que es lo que va a pasar en producción:

```bash
rm -rf .wrangler/state/v3/d1
git show HEAD:schema.sql > /tmp/schema-viejo.sql
npx wrangler d1 execute gastos --local --file=/tmp/schema-viejo.sql
npx wrangler d1 execute gastos --local --file=./migracion-limites.sql
npx wrangler d1 execute gastos --local --command "PRAGMA table_info(cuenta);"
rm -f /tmp/schema-viejo.sql
```

Expected: las cinco columnas aparecen igual que por el camino de cero. Los dos caminos convergen.

- [ ] **Step 5: Dejar la base local lista para las tareas siguientes**

```bash
rm -rf .wrangler/state/v3/d1
npx wrangler d1 execute gastos --local --file=./schema.sql
```

- [ ] **Step 6: Commit**

```bash
git add migracion-limites.sql schema.sql
git commit -m "feat: schema de limites de tarjeta"
```

---

### Task 3: `PATCH /api/cuentas/:id`

Hoy un medio de pago se puede crear y borrar, pero no modificar. Este endpoint permite corregir el nombre, el cierre, el vencimiento, los dos límites y las dos bases.

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: las columnas de Task 2.
- Produces: `PATCH /api/cuentas/:id` → la cuenta ya actualizada (objeto completo).

- [ ] **Step 1: Agregar el endpoint**

En `src/index.js`, insertar inmediatamente **antes** del bloque `if (res === "cuentas" && rid && m === "DELETE")`:

```js
    if (res === "cuentas" && rid && m === "PATCH") {
      const b = await request.json();
      const actual = await env.DB.prepare("SELECT * FROM cuenta WHERE id = ?").bind(rid).first();
      if (!actual) return json({ error: "Medio de pago inexistente" }, 404);

      const nombre = b.nombre === undefined ? actual.nombre : (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);

      // Un límite puede quedar sin cargar: "" o null lo borran, un número lo fija.
      const lim = (v, prev) => {
        if (v === undefined) return prev;
        if (v === null || v === "") return null;
        const n = Number(v);
        return n >= 0 ? n : prev;
      };
      // Las bases siempre tienen valor; nunca son NULL.
      const base = (v, prev) => {
        if (v === undefined) return prev;
        const n = Number(v);
        return n >= 0 ? n : prev;
      };
      const dia = (v, prev) => {
        if (v === undefined) return prev;
        return Math.min(Math.max(parseInt(v) || prev || 1, 1), 31);
      };

      // Los campos de crédito no aplican a una cuenta de débito: se fuerzan a su valor neutro.
      const cred = actual.tipo === "credito";
      const cierre        = cred ? dia(b.cierre, actual.cierre) : null;
      const venc          = cred ? dia(b.venc, actual.venc) : null;
      const limite_pago   = cred ? lim(b.limite_pago, actual.limite_pago) : null;
      const limite_cuotas = cred ? lim(b.limite_cuotas, actual.limite_cuotas) : null;
      const base_pago     = cred ? base(b.base_pago, actual.base_pago) : 0;
      const base_cuotas   = cred ? base(b.base_cuotas, actual.base_cuotas) : 0;

      await env.DB.prepare(
        "UPDATE cuenta SET nombre=?, cierre=?, venc=?, limite_pago=?, limite_cuotas=?, base_pago=?, base_cuotas=? WHERE id=?"
      ).bind(nombre, cierre, venc, limite_pago, limite_cuotas, base_pago, base_cuotas, rid).run();
      return json({ ...actual, nombre, cierre, venc, limite_pago, limite_cuotas, base_pago, base_cuotas });
    }
```

`tipo` y `def` no se editan acá a propósito: cambiar el tipo de una cuenta con gastos cargados los movería de resumen sin aviso, y `def` ya tiene su propio endpoint.

- [ ] **Step 2: Levantar el server y probar el camino feliz**

En una terminal:

```bash
npx wrangler dev
```

En otra:

```bash
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' \
  -d '{"limite_pago":150000,"limite_cuotas":300000,"base_pago":30000,"cierre":18}'
```

Expected: JSON con `"limite_pago":150000`, `"limite_cuotas":300000`, `"base_pago":30000`, `"cierre":18`, y `"base_cuotas":0` sin tocar.

- [ ] **Step 3: Probar la actualización parcial**

```bash
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' -d '{"nombre":"Visa Galicia"}'
```

Expected: el nombre cambia y `limite_pago` sigue en 150000 — un campo ausente no borra nada.

- [ ] **Step 4: Probar que se puede borrar un límite**

```bash
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' -d '{"limite_pago":""}'
```

Expected: `"limite_pago":null`. Después volver a ponerlo:

```bash
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' -d '{"limite_pago":150000}'
```

- [ ] **Step 5: Probar que una cuenta de débito ignora los campos de crédito**

```bash
curl -s -X PATCH localhost:8787/api/cuentas/mp -H 'content-type: application/json' \
  -d '{"nombre":"MP","limite_pago":999,"cierre":10}'
```

Expected: el nombre cambia, pero `limite_pago` y `cierre` vuelven `null`.

- [ ] **Step 6: Probar los errores**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH localhost:8787/api/cuentas/noexiste -H 'content-type: application/json' -d '{"nombre":"X"}'
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' -d '{"nombre":"   "}'
```

Expected: `404` en el primero; `{"error":"Poné un nombre"}` en el segundo.

- [ ] **Step 7: Commit**

```bash
git add src/index.js
git commit -m "feat: PATCH de medios de pago"
```

---

### Task 4: `POST /api/cuentas/:id/resumen-pagado`

Avanza el corte y borra la base de un pago. Es el momento en que la app deja de depender del número que se escribió a mano.

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `mesResumenCerrado` de `src/tarjetas.mjs` (Task 1); las columnas de Task 2.
- Produces: `POST /api/cuentas/:id/resumen-pagado` → la cuenta actualizada.

- [ ] **Step 1: Importar el módulo**

Al tope de `src/index.js`, debajo del import existente de `./servicios.mjs`, agregar:

```js
import { mesResumenCerrado } from "./tarjetas.mjs";
```

- [ ] **Step 2: Agregar el endpoint**

Insertar inmediatamente **después** del bloque `if (res === "cuentas" && rid && action === "default" && m === "POST")`:

```js
    if (res === "cuentas" && rid && action === "resumen-pagado" && m === "POST") {
      const c = await env.DB.prepare("SELECT * FROM cuenta WHERE id = ?").bind(rid).first();
      if (!c) return json({ error: "Medio de pago inexistente" }, 404);
      if (c.tipo !== "credito") return json({ error: "Solo las tarjetas tienen resumen" }, 400);

      // Se guarda el mes que impactos() le asigna al resumen que YA cerró. La base de un
      // pago se borra porque todo lo que se debía entró en ese resumen y quedó saldado;
      // de acá en más el usado sale solo de los gastos cargados.
      const mes = mesResumenCerrado(c.cierre || 20);
      await env.DB.prepare("UPDATE cuenta SET pagado_hasta = ?, base_pago = 0 WHERE id = ?")
        .bind(mes, rid).run();
      return json({ ...c, pagado_hasta: mes, base_pago: 0 });
    }
```

- [ ] **Step 3: Probarlo**

Con `npx wrangler dev` corriendo y la Visa con `base_pago` en 30000 y `cierre` 18 de la tarea anterior:

```bash
curl -s -X POST localhost:8787/api/cuentas/vi/resumen-pagado
```

Expected: `"base_pago":0` y `"pagado_hasta"` con el mes correcto. Con cierre 18: si hoy es día ≤ 18, el mes corriente; si es posterior, el siguiente. Calcularlo a mano y confirmar que coincide.

- [ ] **Step 4: Probar los errores**

```bash
curl -s -X POST localhost:8787/api/cuentas/mp/resumen-pagado
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8787/api/cuentas/noexiste/resumen-pagado
```

Expected: `{"error":"Solo las tarjetas tienen resumen"}` en el primero; `404` en el segundo.

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat: endpoint pague el resumen"
```

---

### Task 5: Cálculo y render de los límites

Muestra las dos barras en cada tarjeta de crédito. Solo lectura: editar y "pagué el resumen" vienen en la Task 6.

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: las columnas nuevas en `cuenta`, ya devueltas por `GET /api/state`; `impactos()`, `sumaAlTotal`, `fmt`, `esc` que ya existen.
- Produces: `usoDeCuenta(c) -> {pago: number, cuotas: number}`, `barraLimite(rotulo, usado, limite) -> string`.

- [ ] **Step 1: Agregar el CSS**

En el `<style>`, después de la regla `.bar i{...}`, agregar:

```css
  .bar i.alerta{background:var(--danger)}
  .lim{margin-top:12px}
  .limtop{display:flex; justify-content:space-between; align-items:baseline; gap:8px}
  .limr{font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted)}
  .limn{font-size:13px; font-weight:700; white-space:nowrap}
  .limsin{font-size:13px; color:var(--muted)}
  .lnk{background:none; border:none; color:var(--muted); font-size:13px; padding:4px;
    text-decoration:underline}
  .accrow{display:flex; align-items:baseline; gap:10px}
  .editbox{margin-top:14px; padding-top:14px; border-top:1px solid var(--line)}
```

- [ ] **Step 2: Escribir el cálculo**

Agregar antes de `function renderAcc(){`:

```js
// Cuánto límite ocupa una tarjeta hoy. Una sola regla: un gasto ocupa límite hasta que
// su resumen esté pagado, así que se compara el mes que le asigna impactos() contra
// pagado_hasta. Las bases son lo que ya se debía antes de usar la app.
// Los pendientes y omitidos no llegaron a la tarjeta: los filtra sumaAlTotal.
function usoDeCuenta(c){
  const corte = c.pagado_hasta || "";
  let pago = c.base_pago || 0, cuotas = c.base_cuotas || 0;
  movs.filter(sumaAlTotal).filter(m => m.cuenta_id === c.id).forEach(m => {
    impactos(m).forEach(i => {
      if(i.mes <= corte) return;
      if(i.de > 1) cuotas += i.monto; else pago += i.monto;
    });
  });
  return { pago, cuotas };
}

function barraLimite(rotulo, usado, limite){
  // Sin límite cargado no se dibuja barra: una barra vacía se lee como "no debés nada",
  // que es lo contrario de la verdad.
  if(!(limite > 0)) return `<div class="lim"><div class="limtop">
    <span class="limr">${rotulo}</span><span class="limsin">sin límite cargado</span></div></div>`;
  const pct = Math.min(usado / limite * 100, 100);
  const alerta = usado / limite >= 0.9;
  return `<div class="lim"><div class="limtop">
    <span class="limr">${rotulo}</span>
    <span class="limn mono">${fmt(usado)} / ${fmt(limite)}</span></div>
    <div class="bar"><i class="${alerta ? "alerta" : ""}" style="width:${pct}%"></i></div></div>`;
}
```

- [ ] **Step 3: Reescribir `renderAcc`**

Reemplazar la función `renderAcc` completa por:

```js
function renderAcc(){
  $("acclist").innerHTML = cuentas.map(c => {
    const cred = c.tipo === "credito";
    const u = cred ? usoDeCuenta(c) : null;
    return `<div class="row" style="display:block">
      <div class="accrow">
        <button class="star" data-def="${c.id}" title="Usar por defecto">${c.def ? "★" : "☆"}</button>
        <div class="name">${esc(c.nombre)}
          <span class="sub">${cred ? `crédito · cierra ${c.cierre} · paga ${c.venc}` : "débito / efectivo"}</span></div>
        <button class="lnk" data-edit="${c.id}">editar</button>
        <button class="del" data-rm="${c.id}">borrar</button>
      </div>
      ${cred ? barraLimite("Un pago", u.pago, c.limite_pago)
             + barraLimite("Cuotas", u.cuotas, c.limite_cuotas)
             + `<button class="pay" data-resumen="${c.id}" style="margin-top:12px">Pagué el resumen</button>`
             : ""}</div>`;
  }).join("");
}
```

- [ ] **Step 4: Verificar que el script parsea**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('public/index.html','utf8');fs.writeFileSync('.chk.mjs',s.match(/<script>([\s\S]*)<\/script>/)[1]);"
node --check .chk.mjs && echo "SYNTAX OK"
rm -f .chk.mjs
```

Expected: `SYNTAX OK`.

- [ ] **Step 5: Verificar la aritmética contra la base**

Arrancar de una base limpia. Es necesario: la Task 4 le dejó a la Visa un `pagado_hasta`, y
`PATCH` no lo puede borrar, así que arrastrarlo haría que el resultado de esta verificación
dependa del día del mes en que se corra — con el corte puesto, un gasto que impacta en ese
mismo resumen queda filtrado y los números no dan.

```bash
# parar wrangler dev antes de esto
rm -rf .wrangler/state/v3/d1
npx wrangler d1 execute gastos --local --file=./schema.sql
npx wrangler dev
```

Con el server levantado de nuevo, poner límites en la Visa y cargar gastos conocidos:

```bash
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' \
  -d '{"limite_pago":150000,"limite_cuotas":300000,"base_pago":30000,"base_cuotas":0,"cierre":20}'
curl -s -X POST localhost:8787/api/movs -H 'content-type: application/json' \
  -d '{"fecha":"2026-08-05","descripcion":"prueba un pago","monto":20000,"cuenta_id":"vi","cuotas":1}'
curl -s -X POST localhost:8787/api/movs -H 'content-type: application/json' \
  -d '{"fecha":"2026-08-05","descripcion":"prueba cuotas","monto":60000,"cuenta_id":"vi","cuotas":6}'
```

Ahora calcular a mano lo que tiene que dar y confirmarlo abriendo `http://localhost:8787` en la pestaña Medios:

- Un pago: base 30.000 + 20.000 = **$50.000 / $150.000**
- Cuotas: base 0 + las seis cuotas de 10.000 = **$60.000 / $300.000**, porque las seis ocupan límite desde el momento de la compra.

Con la base limpia `pagado_hasta` es `NULL`, así que todo cuenta y estos números no dependen
del día en que se corra la prueba.

Anotar en el reporte los dos números observados. Si no coinciden, no seguir.

- [ ] **Step 6: Verificar el umbral de alerta**

```bash
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' -d '{"limite_pago":55556}'
```

50.000 / 55.556 = 89,99% → la barra sigue verde.

```bash
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' -d '{"limite_pago":55555}'
```

50.000 / 55.555 = 90,0009% → la barra pasa a roja. Confirmar en el navegador y dejarlo anotado; la confirmación visual del color es del humano.

Restaurar después: `{"limite_pago":150000}`.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: barras de limite en los medios de pago"
```

---

### Task 6: Editar un medio y "pagué el resumen"

Hace interactiva la pantalla: formulario inline de edición y el botón que libera el límite de un pago.

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `PATCH /api/cuentas/:id` (Task 3), `POST /api/cuentas/:id/resumen-pagado` (Task 4), `renderAcc` y `usoDeCuenta` (Task 5).
- Produces: `abrirEdicion(cid, fila)`, `guardarCuenta(cid, box)`.

- [ ] **Step 1: Escribir el formulario inline**

Agregar después de la función `renderAcc`:

```js
// El value de cada input se asigna por propiedad y no interpolado en el HTML: esc() no
// escapa comillas, así que un nombre con " rompería el atributo.
function abrirEdicion(cid, fila){
  const c = cuentas.find(x => x.id === cid);
  if(!c || fila.querySelector(".editbox")) return;
  const cred = c.tipo === "credito";
  const box = document.createElement("div");
  box.className = "editbox";
  box.innerHTML = `
    <div class="field"><label>Nombre</label><input class="e-nom" autocomplete="off"></div>
    ${cred ? `
    <div class="inline field">
      <div><label>Día de cierre</label><input class="e-cierre" inputmode="numeric"></div>
      <div><label>Día de pago</label><input class="e-venc" inputmode="numeric"></div>
    </div>
    <div class="inline field">
      <div><label>Límite en un pago</label><input class="e-lp" inputmode="decimal" placeholder="sin cargar"></div>
      <div><label>Límite en cuotas</label><input class="e-lc" inputmode="decimal" placeholder="sin cargar"></div>
    </div>
    <div class="inline field">
      <div><label>Usado en un pago</label><input class="e-bp" inputmode="decimal"></div>
      <div><label>Usado en cuotas</label><input class="e-bc" inputmode="decimal"></div>
    </div>
    <p class="hint">Los "usado" son lo que ya debías antes de empezar con la app; de ahí en
    más se suman los gastos que carguen. El de cuotas conviene bajarlo a mano cada tanto,
    porque la app no conoce el cronograma de tus cuotas viejas. Ojo: cambiar el día de
    cierre mueve de resumen los gastos ya cargados.</p>` : ""}
    <div class="inline">
      <button class="primary" data-save="${cid}">Guardar</button>
      <button class="lnk" data-cancel="1">Cancelar</button>
    </div>`;
  fila.appendChild(box);
  const set = (sel, v) => { const el = box.querySelector(sel); if(el) el.value = v; };
  set(".e-nom", c.nombre);
  if(cred){
    set(".e-cierre", c.cierre ?? 20);
    set(".e-venc", c.venc ?? 5);
    set(".e-lp", c.limite_pago ?? "");
    set(".e-lc", c.limite_cuotas ?? "");
    set(".e-bp", c.base_pago ?? 0);
    set(".e-bc", c.base_cuotas ?? 0);
  }
  box.querySelector(".e-nom").focus();
}

async function guardarCuenta(cid, box){
  const c = cuentas.find(x => x.id === cid);
  const val = sel => { const el = box.querySelector(sel); return el ? el.value.trim() : undefined; };
  const cuerpo = { nombre: val(".e-nom") };
  if(c.tipo === "credito"){
    cuerpo.cierre = +val(".e-cierre");
    cuerpo.venc = +val(".e-venc");
    // Vacío borra el límite; con número lo fija. parseMonto acepta 1.234,56.
    cuerpo.limite_pago   = val(".e-lp") === "" ? "" : parseMonto(val(".e-lp"));
    cuerpo.limite_cuotas = val(".e-lc") === "" ? "" : parseMonto(val(".e-lc"));
    cuerpo.base_pago   = parseMonto(val(".e-bp")) || 0;
    cuerpo.base_cuotas = parseMonto(val(".e-bc")) || 0;
  }
  try {
    const row = await api("cuentas/" + cid, "PATCH", cuerpo);
    const i = cuentas.findIndex(x => x.id === cid);
    if(i >= 0) cuentas[i] = row;
    showErr(""); renderAcc(); fillSelects(); renderLoad(); renderMonth();
    toast("Medio actualizado");
  } catch(e){ showErr(e.message); }
}
```

- [ ] **Step 2: Cablear los handlers**

Reemplazar el listener de `$("acclist")` completo por:

```js
$("acclist").addEventListener("click", async e => {
  const t = e.target.dataset;
  if(t.edit) return abrirEdicion(t.edit, e.target.closest(".row"));
  if(t.cancel){ const b = e.target.closest(".editbox"); if(b) b.remove(); return; }
  if(t.save) return guardarCuenta(t.save, e.target.closest(".editbox"));
  if(t.resumen){
    const c = cuentas.find(x => x.id === t.resumen);
    if(!c || !confirm(`¿Marcar como pagado el resumen de ${c.nombre}? Libera el límite en un pago y borra el usado que cargaste a mano.`)) return;
    try {
      const row = await api("cuentas/" + t.resumen + "/resumen-pagado", "POST");
      const i = cuentas.findIndex(x => x.id === t.resumen);
      if(i >= 0) cuentas[i] = row;
      showErr(""); renderAcc(); toast("Resumen pagado");
    } catch(err){ showErr(err.message); }
    return;
  }
  try {
    if(t.def){
      await api("cuentas/" + t.def + "/default", "POST");
      cuentas.forEach(c => c.def = c.id === t.def ? 1 : 0);
    } else if(t.rm){
      await api("cuentas/" + t.rm, "DELETE");
      cuentas = cuentas.filter(c => c.id !== t.rm);
    } else return;
    showErr(""); renderAcc(); fillSelects(); renderLoad();
  } catch(err){ showErr(err.message); }
});
```

- [ ] **Step 3: Verificar que el script parsea**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('public/index.html','utf8');fs.writeFileSync('.chk.mjs',s.match(/<script>([\s\S]*)<\/script>/)[1]);"
node --check .chk.mjs && echo "SYNTAX OK"
rm -f .chk.mjs
```

Expected: `SYNTAX OK`.

- [ ] **Step 4: Verificar el ciclo completo por HTTP**

Con `npx wrangler dev` corriendo, comprobar que los endpoints que usa la pantalla responden:

```bash
curl -s -X PATCH localhost:8787/api/cuentas/vi -H 'content-type: application/json' \
  -d '{"nombre":"Visa","cierre":20,"venc":5,"limite_pago":150000,"limite_cuotas":300000,"base_pago":30000,"base_cuotas":5000}'
curl -s -X POST localhost:8787/api/cuentas/vi/resumen-pagado
curl -s localhost:8787/api/state | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=JSON.parse(d).cuentas.find(c=>c.id==='vi');console.log(JSON.stringify({base_pago:v.base_pago,base_cuotas:v.base_cuotas,pagado_hasta:v.pagado_hasta}));})"
```

Expected: `base_pago` en 0, `base_cuotas` intacto en 5000 (las cuotas viejas siguen corriendo), y `pagado_hasta` con el mes correcto.

- [ ] **Step 5: Probar a mano en el navegador**

Abrir `http://localhost:8787`, pestaña Medios:

1. Tocar "editar" en una tarjeta → se despliega el formulario con los valores actuales cargados.
2. Cambiar el nombre y guardar → cambia en la lista y en el selector de la pantalla de carga.
3. Tocar "editar" dos veces seguidas → no se apilan dos formularios.
4. Vaciar el campo de límite en un pago y guardar → la barra desaparece y queda "sin límite cargado".
5. Tocar "Pagué el resumen" y cancelar el `confirm` → no pasa nada.
6. Tocar "editar" en una cuenta de débito → solo aparece el campo de nombre.

Anotar cuáles se pudieron verificar. La apariencia visual la confirma el humano.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: editar medios de pago y pague el resumen desde la app"
```

---

### Task 7: Verificación end-to-end y documentación

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Correr los tests y el bundle**

```bash
node --test
npx wrangler deploy --dry-run --outdir=.probe-out && rm -rf .probe-out
```

Expected: `# pass 11`, `# fail 0`, y el bundle sin errores.

- [ ] **Step 2: Recorrer la lista de verificación del spec**

Con una base local limpia y `npx wrangler dev`, recorrer los nueve puntos de la sección "Verificación" del spec `docs/superpowers/specs/2026-08-05-limites-tarjeta-design.md`. El punto 4b (los dos lados del cierre) se cubre con los tests de la Task 1; anotarlo así.

No marcar este paso como hecho con puntos en rojo.

- [ ] **Step 3: Actualizar `CLAUDE.md`**

En "Modelo de datos", reemplazar el bloque de `cuenta` por:

```sql
cuenta(id, nombre, tipo, cierre, venc, def,
       limite_pago, limite_cuotas, base_pago, base_cuotas, pagado_hasta)
  tipo: 'debito' (incluye efectivo y billeteras) | 'credito'
  cierre/venc: días del mes, solo para crédito
  def: 1 en el medio de pago preseleccionado al cargar
  limite_pago / limite_cuotas: topes del banco; NULL = todavía no se cargaron
  base_pago / base_cuotas: lo que ya se debía antes de usar la app
  pagado_hasta: YYYY-MM del último resumen pagado; NULL = ninguno
```

Agregar a la lista de archivos del Stack:

```
src/tarjetas.mjs        mesResumenCerrado: a qué resumen corresponde el que acaba de cerrar
migracion-limites.sql   límites y bases en cuenta
```

Agregar a "Reglas de negocio que no son obvias":

```markdown
- **El límite usado no se guarda, se calcula.** Una sola regla: un gasto ocupa límite hasta
  que su resumen esté pagado, así que se compara el mes que le asigna `impactos()` contra
  `pagado_hasta`. Guardar un contador se desincronizaría al borrar o editar un gasto.
- **Una compra en N cuotas ocupa el total desde el día uno**, no de a una cuota por mes. Es
  lo que hacen los bancos con el límite de financiación.
- **"Pagué el resumen" borra `base_pago` pero no `base_cuotas`.** Lo que se debía en un pago
  entró entero en ese resumen; las cuotas viejas siguen corriendo y la app no conoce su
  cronograma, así que esa base se baja a mano.
```

Agregar a "Cosas pendientes / ideas":

```markdown
- Importar el resumen de la tarjeta para extraer cierre, vencimiento y conciliar gastos.
  Reemplazaría las bases manuales de los límites.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documentar limites de tarjeta"
```

- [ ] **Step 5: Parar acá**

**No aplicar la migración remota ni pushear.** La cabecera de `migracion-limites.sql` tiene el orden obligatorio (backup, migración, verificación, recién después el deploy) y esa secuencia la decide el humano, igual que en la feature anterior. Reportar que está listo para revisión.

---

## Notas para quien ejecute

- **No agregar `package.json`.** `node --test` funciona sin él porque los tests son `.mjs`.
- **El orden importa.** Las tareas 3 y 4 tocan `src/index.js`; las 5 y 6 tocan `public/index.html`. Dentro de cada grupo van en orden.
- **Si un comando de wrangler falla con `EBUSY`**, no es el comando: es un `wrangler dev` viejo que quedó vivo reteniendo el lock de la caché de npm. Matar los procesos `node` de wrangler primero y después los `workerd`, o leer la base local directo con `node:sqlite`.
