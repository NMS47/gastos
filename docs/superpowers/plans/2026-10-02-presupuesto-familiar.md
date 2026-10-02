# Presupuesto familiar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app diga, el día 1 de cada mes, cuánta plata queda después de cubrir lo familiar y cuánto le toca a cada uno, con topes por categoría que avisan en el momento de gastar.

**Architecture:** Toda la aritmética nueva vive en `public/calculo.mjs`, un módulo ES puro servido como asset, importado por `index.html` y por los tests. El Worker solo gana dos tablas (`ingreso`, `tope`), dos columnas (`servicio.hasta`, `mov.ambito`) y los endpoints para manejarlas; no calcula nada. El cálculo queda en el frontend porque el guardado de un gasto no recarga el estado (`index.html:647`) y el recordatorio tiene que salir sin ida y vuelta al servidor.

**Tech Stack:** Worker de Cloudflare, D1 (SQLite), JS vanilla sin build step, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-02-presupuesto-familiar-design.md`

## Global Constraints

- **Español rioplatense, voseo, sentence case** en todo el texto de UI.
- **Montos con `toLocaleString("es-AR")`, sin decimales.** Usar el `fmt()` que ya existe.
- **Sin dependencias en runtime, sin build step.** Nada de npm install salvo wrangler como dev.
- **No reintroducir la carpeta `functions/`.** El proyecto es Worker + `[assets]`.
- **Cargar un gasto familiar sigue siendo 4 taps.** Ningún campo nuevo obligatorio en la pestaña Cargar.
- **Los tests corren con `node --test` desde la raíz del repo.** Sin runner nuevo.
- **Colores desde las variables CSS del tope de `index.html`:** `--accent` verde para acciones, `--credit` violeta para cuotas/tarjeta, `.q-nico` azul, `.q-dani` rosa.
- **`PATCH /api/movs/:id` está acotado a `cat` y `ambito`.** No tocar monto, fecha ni descripción.
- **Reparto 50/50 fijo**, no configurable.
- **El `estado` de un mov en la cascada:** `pendiente` cuenta, `omitido` no, `pagado` y `NULL` cuentan.

## Review Focus

Cinco cosas que la spec implica, que ningún test de tarea cubriría por sí solo, y que son las que más probablemente rompan en la mano:

1. **Un `mov` con `fecha` ausente o mal formada** hace explotar `m.fecha.slice(0,7)` y la cascada entera queda en blanco. Esperable: ese gasto se ignora y el resto del mes se calcula igual. → test en Task 3.
2. **Un `tope` de una categoría que ya no está en `CATS`** (una fila huérfana de `"Nafta"`) se sigue restando de la cascada y no se puede editar desde ninguna pantalla. Esperable: se resta igual (la plata está reservada) pero aparece en la lista de topes para poder sacarla. → test en Task 4.
3. **Un `mov` cuyo `cuenta_id` ya no existe** (borraron el medio de pago) cae en la rama de débito de `impactos()` y se cuenta en el mes de compra. Esperable: eso mismo, sin tirar error. → test en Task 2.
4. **Un `tope` con `monto` 0** divide por cero al calcular el ancho de la barra y da `NaN%`. Esperable: barra llena si hay consumo, vacía si no. → test en Task 11.
5. **Un gasto personal con `quien` en `NULL`** crea la clave `personal["null"]` y la UI muestra una tercera persona fantasma. Esperable: se agrupa bajo el `quien` por defecto y nunca aparece una fila que no sea Nico o Dani. → test en Task 4.

---

## Nota de entorno (Windows)

`wrangler dev` deja procesos huérfanos. Si un comando de wrangler falla con `EBUSY`, es un dev server viejo todavía corriendo, no el comando que acabás de escribir. Matalo antes de reintentar:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*wrangler*" } | Stop-Process -Force
```

---

### Task 1: Migración, categorías y las cuotas viejas de la tarjeta

**Files:**
- Create: `migracion-presupuesto.sql`
- Modify: `public/index.html:269-271` (la constante `CATS`)

**Interfaces:**
- Consumes: nada.
- Produces: las tablas `ingreso` y `tope`, las columnas `servicio.hasta` y `mov.ambito`, y la lista `CATS` con `"Deudas"` y `"Viajes"` y sin `"Nafta"`. Todas las tareas siguientes dependen de esto.

- [ ] **Step 1: Escribir la migración**

Crear `migracion-presupuesto.sql`:

```sql
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
```

- [ ] **Step 2: Backup antes de aplicar**

Igual que en las migraciones anteriores del repo:

```powershell
npx wrangler d1 export gastos --remote --output=./backup-pre-presupuesto.sql
```

- [ ] **Step 3: Aplicar la migración**

```powershell
npx wrangler d1 execute gastos --remote --file=./migracion-presupuesto.sql
```

- [ ] **Step 4: Verificar que las tablas y columnas están**

```powershell
npx wrangler d1 execute gastos --remote --command="SELECT name FROM sqlite_master WHERE name IN ('ingreso','tope')"
npx wrangler d1 execute gastos --remote --command="SELECT COUNT(*) AS nafta FROM mov WHERE cat='Nafta'"
```

Esperado: las dos tablas listadas, y `nafta = 0`.

- [ ] **Step 5: Actualizar `CATS` en el frontend**

En `public/index.html:269-271`, reemplazar:

```js
const CATS = ["Supermercado","Comida afuera","Nafta","Auto","Transporte","Servicios",
  "Alquiler / Expensas","Hogar","Salud","Educación","Ropa","Ocio / Paseo",
  "Suscripciones","Regalos","Impuestos","Mascotas","Otros"];
```

por:

```js
const CATS = ["Supermercado","Comida afuera","Auto","Transporte","Servicios",
  "Alquiler / Expensas","Hogar","Salud","Deudas","Educación","Ropa","Viajes",
  "Ocio / Paseo","Suscripciones","Regalos","Impuestos","Mascotas","Otros"];
```

- [ ] **Step 6: Commit**

```bash
git add migracion-presupuesto.sql public/index.html
git commit -m "feat: migracion de presupuesto y categorias nuevas"
```

- [ ] **Step 7: Avisarle al usuario sobre `base_cuotas` (no es código)**

Decirle, textualmente, que mientras `base_cuotas` tenga un número sin desglosar, la línea de tarjeta de la cascada va a salir **más baja que el resumen real** y el presupuesto personal más optimista de lo que es. Que la forma de arreglarlo es cargar las compras viejas de la tarjeta que todavía tienen cuotas pendientes como `mov` reales con su cantidad de cuotas, y después poner `base_cuotas` en cero desde la pestaña Medios. No implementar nada para esto.

---

### Task 2: `public/calculo.mjs` con `impactos()`, e `index.html` como módulo

**Files:**
- Create: `public/calculo.mjs`
- Create: `src/calculo.test.mjs`
- Modify: `public/index.html:268` (`<script>` → `<script type="module">`), `public/index.html:314-325` (borrar `impactos()` local), `public/index.html:379-384` y `:360-366` (los dos llamadores)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ym(date) → "YYYY-MM"`
  - `impactos(mov, cuenta) → [{mes, monto, nro, de}]` — `mov` necesita `fecha`, `monto`, `cuotas`; `cuenta` necesita `tipo` y `cierre`, y puede venir `undefined`.
  - En `index.html`, el helper local `imp(m)` que resuelve la cuenta y llama a `impactos`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/calculo.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { impactos, ym } from "../public/calculo.mjs";

const visa = { id: "v", tipo: "credito", cierre: 20 };
const efectivo = { id: "e", tipo: "debito" };

test("ym devuelve el mes con dos digitos", () => {
  assert.equal(ym(new Date(2026, 0, 5)), "2026-01");
  assert.equal(ym(new Date(2026, 11, 31)), "2026-12");
});

test("debito impacta el mismo dia de la compra", () => {
  const r = impactos({ fecha: "2026-10-05", monto: 1000, cuotas: 1 }, efectivo);
  assert.deepEqual(r, [{ mes: "2026-10", monto: 1000, nro: 1, de: 1 }]);
});

test("compra el dia 4 con cierre 20 entra en el resumen del mes siguiente", () => {
  const r = impactos({ fecha: "2026-10-04", monto: 1000, cuotas: 1 }, visa);
  assert.equal(r[0].mes, "2026-11");
});

test("compra el dia 25 con cierre 20 entra dos meses despues", () => {
  const r = impactos({ fecha: "2026-10-25", monto: 1000, cuotas: 1 }, visa);
  assert.equal(r[0].mes, "2026-12");
});

test("el dia del cierre todavia cuenta como antes", () => {
  const r = impactos({ fecha: "2026-10-20", monto: 1000, cuotas: 1 }, visa);
  assert.equal(r[0].mes, "2026-11");
});

test("12 cuotas desde diciembre terminan en enero del año +2", () => {
  const r = impactos({ fecha: "2026-12-05", monto: 1200, cuotas: 12 }, visa);
  assert.equal(r.length, 12);
  assert.equal(r[0].mes, "2027-01");
  assert.equal(r[11].mes, "2028-01");
});

test("la suma de las cuotas da exactamente el total", () => {
  const r = impactos({ fecha: "2026-10-05", monto: 1000, cuotas: 3 }, visa);
  assert.equal(r.reduce((a, i) => a + i.monto, 0), 1000);
  assert.equal(r[2].monto, 1000 - r[0].monto * 2);
});

// Review Focus 3: borraron el medio de pago y quedó el gasto.
test("un mov sin cuenta se cuenta en el mes de compra, sin explotar", () => {
  const r = impactos({ fecha: "2026-10-05", monto: 1000, cuotas: 1 }, undefined);
  assert.deepEqual(r, [{ mes: "2026-10", monto: 1000, nro: 1, de: 1 }]);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test`
Expected: FAIL — `Cannot find module '../public/calculo.mjs'`

- [ ] **Step 3: Crear el módulo**

Crear `public/calculo.mjs`:

```js
// Aritmética pura del presupuesto. Sin DOM, sin red: testeable con `node --test`.
// Vive en public/ y no en src/ porque el [assets] de Cloudflare solo sirve esa
// carpeta: un módulo en src/ el navegador no lo puede pedir.

export const ym = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

// En qué resumen cae cada cuota de una compra.
// Debito o efectivo: impacta el mismo dia. Credito: si el dia de compra es <= cierre
// entra en el resumen del mes siguiente, si no en el subsiguiente; cada cuota suma un
// mes mas. La ultima cuota absorbe el redondeo para que la suma de exacta.
export function impactos(mov, cuenta) {
  const d = new Date(mov.fecha + "T12:00:00");
  if (!cuenta || cuenta.tipo !== "credito")
    return [{ mes: ym(d), monto: mov.monto, nro: 1, de: 1 }];

  const mesCiclo = d.getMonth() + (d.getDate() <= (cuenta.cierre || 20) ? 1 : 2);
  const n = mov.cuotas || 1, base = Math.round(mov.monto / n), out = [];
  for (let i = 0; i < n; i++) {
    const f = new Date(d.getFullYear(), mesCiclo + i, 1);
    out.push({ mes: ym(f), nro: i + 1, de: n,
      monto: i === n - 1 ? mov.monto - base * (n - 1) : base });
  }
  return out;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test`
Expected: PASS, 8 tests nuevos además de los 11 que ya estaban.

- [ ] **Step 5: Pasar `index.html` a módulo y borrar la función duplicada**

En `public/index.html:268`, cambiar `<script>` por:

```html
<script type="module">
import { impactos, ym } from "./calculo.mjs";
```

Borrar la función `impactos()` local (líneas 314-325) y la constante `ym` local (línea 279), que ahora vienen del módulo. Agregar, junto a los otros helpers:

```js
// Resuelve la cuenta y delega en el módulo. Los llamadores no cambian de forma.
const imp = m => impactos(m, cuentas.find(x => x.id === m.cuenta_id));
```

Reemplazar los dos llamadores:
- `index.html:360` (en `renderLoad`): `impactos({cuenta_id:c.id, ...})` → `impactos({fecha:$("fecha").value, monto, cuotas:+$("cuotas").value}, c)`
- `index.html:382` (en `renderMonth`): `impactos(m)` → `imp(m)`

Buscar cualquier otro `impactos(` que quede y pasarlo a `imp(`:

```bash
grep -n 'impactos(' public/index.html
```

- [ ] **Step 6: Verificar la app en el navegador**

```powershell
npx wrangler dev
```

Abrir la app, ir a la pestaña Mes, cambiar de mes con las flechas, y cargar un gasto con tarjeta en cuotas para ver que el hint de "entra en el resumen de…" sigue apareciendo. Mirar la consola: **no puede haber ningún error**. Si aparece `Failed to resolve module specifier`, el import está mal escrito; si aparece `X is not defined`, quedó un llamador sin migrar.

- [ ] **Step 7: Commit**

```bash
git add public/calculo.mjs src/calculo.test.mjs public/index.html
git commit -m "refactor: impactos sale a public/calculo.mjs con tests"
```

---

### Task 3: `vigenteEn()` y `consumos()`

**Files:**
- Modify: `public/calculo.mjs`
- Modify: `src/calculo.test.mjs`

**Interfaces:**
- Consumes: nada de Task 2 salvo el archivo.
- Produces:
  - `vigenteEn(fila, mes) → boolean` — `fila` necesita `activo`, `desde`, `hasta`. Sirve igual para un `servicio` que para un `ingreso`.
  - `consumos(movs, mes) → { [cat]: monto }` — la clave `""` junta los que no tienen categoría.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `src/calculo.test.mjs`:

```js
import { vigenteEn, consumos } from "../public/calculo.mjs";

test("vigenteEn: sin hasta, corre desde desde y para siempre", () => {
  const f = { activo: 1, desde: "2026-10", hasta: null };
  assert.equal(vigenteEn(f, "2026-09"), false);
  assert.equal(vigenteEn(f, "2026-10"), true);
  assert.equal(vigenteEn(f, "2030-01"), true);
});

test("vigenteEn: desde igual a hasta corre un solo mes", () => {
  const f = { activo: 1, desde: "2026-11", hasta: "2026-11" };
  assert.equal(vigenteEn(f, "2026-10"), false);
  assert.equal(vigenteEn(f, "2026-11"), true);
  assert.equal(vigenteEn(f, "2026-12"), false);
});

test("vigenteEn: dado de baja no corre, aunque el hasta no haya llegado", () => {
  assert.equal(vigenteEn({ activo: 0, desde: "2026-01", hasta: "2027-02" }, "2026-10"), false);
});

test("consumos: suma por categoria, por fecha de compra", () => {
  const movs = [
    { fecha: "2026-10-05", monto: 100, cat: "Supermercado" },
    { fecha: "2026-10-20", monto: 50, cat: "Supermercado" },
    { fecha: "2026-11-01", monto: 999, cat: "Supermercado" }
  ];
  assert.deepEqual(consumos(movs, "2026-10"), { Supermercado: 150 });
});

test("consumos: una compra en 12 cuotas consume el total en el mes de compra", () => {
  const movs = [{ fecha: "2026-10-05", monto: 1200, cuotas: 12, cat: "Hogar" }];
  assert.deepEqual(consumos(movs, "2026-10"), { Hogar: 1200 });
});

test("consumos: un pendiente consume, un omitido no", () => {
  const movs = [
    { fecha: "2026-10-28", monto: 100, cat: "Auto", estado: "pendiente" },
    { fecha: "2026-10-28", monto: 500, cat: "Auto", estado: "omitido" },
    { fecha: "2026-10-10", monto: 30, cat: "Auto", estado: "pagado" }
  ];
  assert.deepEqual(consumos(movs, "2026-10"), { Auto: 130 });
});

test("consumos: un gasto personal no consume ningun tope", () => {
  const movs = [{ fecha: "2026-10-05", monto: 100, cat: "Ropa", ambito: "personal" }];
  assert.deepEqual(consumos(movs, "2026-10"), {});
});

test("consumos: los sin categoria van a la clave vacia", () => {
  const movs = [
    { fecha: "2026-10-05", monto: 12, cat: null },
    { fecha: "2026-10-06", monto: 8, cat: "" }
  ];
  assert.deepEqual(consumos(movs, "2026-10"), { "": 20 });
});

// Review Focus 1: un mov sin fecha no puede dejar la cascada en blanco.
test("consumos: ignora un mov con fecha ausente o mal formada", () => {
  const movs = [
    { monto: 999, cat: "Supermercado" },
    { fecha: "", monto: 999, cat: "Supermercado" },
    { fecha: "2026-10-05", monto: 100, cat: "Supermercado" }
  ];
  assert.deepEqual(consumos(movs, "2026-10"), { Supermercado: 100 });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test`
Expected: FAIL — `vigenteEn is not a function` / `consumos is not a function`

- [ ] **Step 3: Implementar**

Agregar a `public/calculo.mjs`:

```js
// Un servicio o un ingreso corre en `mes`?
// `hasta` es un final previsto desde el alta; `activo = 0` es una baja decidida
// en el camino. Hacen falta los dos: ver la spec.
export function vigenteEn(fila, mes) {
  if (!fila.activo) return false;
  if (fila.desde > mes) return false;
  if (fila.hasta && fila.hasta < mes) return false;
  return true;
}

// El mes de una fecha "YYYY-MM-DD", o null si la fecha no sirve. Exportada porque
// cascada() tambien filtra por mes y tiene que tratar una fecha rota igual que acá.
export const mesDe = f =>
  (typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.slice(0, 7) : null);

// Cuanto se consumio de cada categoria en `mes`, por FECHA DE COMPRA y por el monto
// completo: una compra en 12 cuotas consume el total en el mes que se decidio.
// La barra mide plata comprometida, no plata que salio, asi que un `pendiente`
// cuenta — al contrario del total del mes. Un `omitido` no.
// La clave "" junta los gastos sin categoria: son la bandeja de entrada.
export function consumos(movs, mes) {
  const out = {};
  for (const m of movs) {
    if (m.ambito === "personal") continue;
    if (m.estado === "omitido") continue;
    if (mesDe(m.fecha) !== mes) continue;
    const k = m.cat || "";
    out[k] = (out[k] || 0) + m.monto;
  }
  return out;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Mudar `diasDelMes` y `fechaDeServicio` al módulo**

Task 4 necesita armar la fecha de un servicio para proyectarlo en un mes futuro, y esas dos
funciones hoy viven en `src/servicios.mjs`, que el navegador no puede pedir. Mudarlas en vez de
duplicarlas.

Mover a `public/calculo.mjs`, tal cual están hoy en `src/servicios.mjs:17-25`:

```js
export function diasDelMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function fechaDeServicio(mes, dia) {
  const d = Math.min(Math.max(parseInt(dia) || 1, 1), diasDelMes(mes));
  return mes + "-" + String(d).padStart(2, "0");
}
```

Y en `src/servicios.mjs`, borrar las dos definiciones y re-exportarlas:

```js
// Viven en public/calculo.mjs porque el frontend tambien las necesita y no puede
// importar de src/. El Worker si puede importar de public/: wrangler lo bundlea.
export { diasDelMes, fechaDeServicio } from "../public/calculo.mjs";
```

- [ ] **Step 6: Correr los tests y verificar que siguen pasando**

Run: `node --test`
Expected: PASS. Los tests de `src/servicios.test.mjs` importan desde `servicios.mjs` y no saben
que la implementación se mudó, así que tienen que seguir verdes sin tocarlos. Si alguno falla, la
re-exportación está mal escrita.

- [ ] **Step 7: Verificar que el Worker sigue arrancando**

```powershell
npx wrangler dev
```

Pedir `/api/state` y verificar que los gastos de servicio del mes se siguen generando. Si wrangler
se queja de no poder resolver `../public/calculo.mjs`, revisar que la ruta sea relativa a
`src/servicios.mjs`.

- [ ] **Step 8: Commit**

```bash
git add public/calculo.mjs src/calculo.test.mjs src/servicios.mjs
git commit -m "feat: vigenteEn y consumos, fechaDeServicio se muda al modulo"
```

---

### Task 4: `cascada()`

**Files:**
- Modify: `public/calculo.mjs`
- Modify: `src/calculo.test.mjs`

**Interfaces:**
- Consumes: `impactos`, `vigenteEn`, `consumos`, `mesDe`, `fechaDeServicio` de las tareas 2 y 3.
- Produces:
  - `movsDelMes(movs, servicios, mes, mesCorriente) → [mov]` — los movs reales, más los servicios proyectados si `mes` es futuro.
  - `cascada(...)`:

```js
cascada({ movs, cuentas, ingresos, servicios, topes }, mes, mesCorriente) → {
  ingresos:     Number,                                  // suma de los vigentes
  tarjeta:      Number,                                  // resumen que se paga en `mes`
  sinTope:      [{ cat: String, monto: Number }],         // lineas de caja sin tope
  totalSinTope: Number,
  topes:        [{ cat: String, tope: Number, consumido: Number }],
  totalTopes:   Number,
  sinCategoria: [mov],                                   // la bandeja, para la UI
  queda:        Number,                                  // puede ser negativo
  cadaUno:      Number,                                  // 0 si queda <= 0
  personal:     { nico: Number, dani: Number }
}
```

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `src/calculo.test.mjs`:

```js
import { cascada as _cascada, movsDelMes } from "../public/calculo.mjs";

const base = () => ({
  movs: [],
  cuentas: [
    { id: "v", tipo: "credito", cierre: 20, base_pago: 0, base_cuotas: 0, pagado_hasta: null },
    { id: "e", tipo: "debito" }
  ],
  ingresos: [{ monto: 3350000, desde: "2026-10", hasta: null, activo: 1 }],
  servicios: [],
  topes: []
});

// Todos los tests tratan a octubre de 2026 como el mes corriente.
const HOY = "2026-10";
const cascada = (d, mes, corriente = HOY) => _cascada(d, mes, corriente);

test("cascada: sin gastos, queda todo el ingreso y se parte al medio", () => {
  const c = cascada(base(), "2026-10");
  assert.equal(c.ingresos, 3350000);
  assert.equal(c.queda, 3350000);
  assert.equal(c.cadaUno, 1675000);
});

test("cascada: un ingreso con desde = hasta cuenta solo ese mes", () => {
  const d = base();
  d.ingresos.push({ monto: 1000000, desde: "2026-11", hasta: "2026-11", activo: 1 });
  assert.equal(cascada(d, "2026-10").ingresos, 3350000);
  assert.equal(cascada(d, "2026-11").ingresos, 4350000);
});

test("cascada: el tope se reserva completo aunque no se haya gastado nada", () => {
  const d = base();
  d.topes = [{ cat: "Supermercado", monto: 600000 }];
  const c = cascada(d, "2026-10");
  assert.equal(c.totalTopes, 600000);
  assert.equal(c.topes[0].consumido, 0);
  assert.equal(c.queda, 2750000);
});

test("cascada: el tope de una categoria consume los servicios de esa categoria", () => {
  const d = base();
  d.topes = [{ cat: "Auto", monto: 300000 }];
  d.movs = [{ id: "sv1-2026-10", fecha: "2026-10-28", monto: 100000, cat: "Auto",
              cuenta_id: "e", servicio_id: "1", estado: "pendiente" }];
  const c = cascada(d, "2026-10");
  assert.equal(c.topes[0].consumido, 100000);
  assert.equal(c.totalTopes, 300000);          // la reserva no cambia
  assert.equal(c.totalSinTope, 0);             // no se resta aparte
});

test("cascada: una categoria sin tope resta lo determinado tal cual", () => {
  const d = base();
  d.movs = [{ fecha: "2026-10-10", monto: 500000, cat: "Deudas", cuenta_id: "e" }];
  const c = cascada(d, "2026-10");
  assert.deepEqual(c.sinTope, [{ cat: "Deudas", monto: 500000 }]);
  assert.equal(c.queda, 2850000);
});

test("cascada: un servicio pagado con tarjeta no se resta dos veces", () => {
  const d = base();
  d.movs = [{ fecha: "2026-10-05", monto: 15000, cuotas: 1, cat: "Suscripciones",
              cuenta_id: "v", servicio_id: "1", estado: "pagado" }];
  const enOctubre = cascada(d, "2026-10");
  assert.equal(enOctubre.totalSinTope, 0);     // no esta como linea de caja
  assert.equal(enOctubre.tarjeta, 0);          // el resumen cae en noviembre
  assert.equal(cascada(d, "2026-11").tarjeta, 15000);
});

test("cascada: la tarjeta suma base_pago si el resumen del mes no esta pagado", () => {
  const d = base();
  d.cuentas[0].base_pago = 700000;
  assert.equal(cascada(d, "2026-10").tarjeta, 700000);
  d.cuentas[0].pagado_hasta = "2026-10";
  assert.equal(cascada(d, "2026-10").tarjeta, 0);
});

test("cascada: base_cuotas nunca entra en la linea de tarjeta", () => {
  const d = base();
  d.cuentas[0].base_cuotas = 900000;
  assert.equal(cascada(d, "2026-10").tarjeta, 0);
});

test("cascada: un gasto familiar sin categoria cae en la bandeja y no desaparece", () => {
  const d = base();
  d.movs = [{ id: "x", fecha: "2026-10-05", monto: 12000, cat: null, cuenta_id: "e" }];
  const c = cascada(d, "2026-10");
  assert.deepEqual(c.sinTope, [{ cat: "", monto: 12000 }]);
  assert.equal(c.sinCategoria.length, 1);
  assert.equal(c.sinCategoria[0].id, "x");
  assert.equal(c.queda, 3338000);
});

test("cascada: la bandeja incluye los sin categoria pagados con tarjeta", () => {
  const d = base();
  d.movs = [{ id: "x", fecha: "2026-10-05", monto: 12000, cuotas: 1, cat: null, cuenta_id: "v" }];
  const c = cascada(d, "2026-10");
  assert.equal(c.sinCategoria.length, 1);
  assert.equal(c.totalSinTope, 0);             // la caja ya la cuenta el resumen
});

test("cascada: un gasto personal no toca ningun total familiar", () => {
  const d = base();
  d.movs = [{ fecha: "2026-10-05", monto: 40000, cat: "Ropa", cuenta_id: "e",
              ambito: "personal", quien: "nico" }];
  const c = cascada(d, "2026-10");
  assert.equal(c.totalSinTope, 0);
  assert.equal(c.queda, 3350000);
  assert.equal(c.personal.nico, 40000);
});

test("cascada: el mes puede dar negativo y cadaUno queda en cero", () => {
  const d = base();
  d.topes = [{ cat: "Supermercado", monto: 4000000 }];
  const c = cascada(d, "2026-10");
  assert.equal(c.queda, -650000);
  assert.equal(c.cadaUno, 0);
});

test("cascada: el redondeo no hace aparecer ni desaparecer un peso", () => {
  const d = base();
  d.ingresos = [{ monto: 5, desde: "2026-10", hasta: null, activo: 1 }];
  const c = cascada(d, "2026-10");
  assert.equal(c.cadaUno, 2);
  assert.ok(c.cadaUno * 2 <= c.queda);
});

test("movsDelMes: en el mes corriente devuelve los movs tal cual", () => {
  const movs = [{ id: "a", fecha: "2026-10-05", monto: 1 }];
  assert.equal(movsDelMes(movs, [{ id: "s", activo: 1, desde: "2026-01", hasta: null,
    nombre: "Luz", monto: 90000, dia: 10, cuenta_id: "e", cat: "Servicios", modo: "auto" }],
    "2026-10", HOY).length, 1);
});

test("movsDelMes: en un mes futuro proyecta los servicios vigentes", () => {
  const sv = [{ id: "s", activo: 1, desde: "2026-01", hasta: null, nombre: "Luz",
                monto: 90000, dia: 10, cuenta_id: "e", cat: "Servicios", modo: "auto" }];
  const r = movsDelMes([], sv, "2026-11", HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].fecha, "2026-11-10");
  assert.equal(r[0].monto, 90000);
  assert.equal(r[0].estado, "pagado");
  assert.equal(r[0].proyectado, true);
});

test("movsDelMes: no proyecta un servicio que ya tiene su fila en ese mes", () => {
  const sv = [{ id: "s", activo: 1, desde: "2026-01", hasta: null, nombre: "Luz",
                monto: 90000, dia: 10, cuenta_id: "e", cat: "Servicios", modo: "auto" }];
  const movs = [{ id: "svs-2026-11", fecha: "2026-11-10", monto: 90000, servicio_id: "s" }];
  assert.equal(movsDelMes(movs, sv, "2026-11", HOY).length, 1);
});

test("movsDelMes: no proyecta un compromiso pasado su hasta", () => {
  const sv = [{ id: "s", activo: 1, desde: "2026-08", hasta: "2027-02", nombre: "Mendoza",
                monto: 725000, dia: 10, cuenta_id: "e", cat: "Deudas", modo: "manual" }];
  assert.equal(movsDelMes([], sv, "2027-02", HOY).length, 1);
  assert.equal(movsDelMes([], sv, "2027-03", HOY).length, 0);
});

test("cascada: un mes futuro resta los servicios aunque todavia no tengan fila", () => {
  const d = base();
  d.servicios = [{ id: "s", activo: 1, desde: "2026-01", hasta: null, nombre: "Luz",
                   monto: 90000, dia: 10, cuenta_id: "e", cat: "Servicios", modo: "auto" }];
  // En octubre el Worker ya generó la fila, así que no hay nada que proyectar.
  assert.equal(cascada(d, "2026-10").totalSinTope, 0);
  // En noviembre la fila no existe todavía: sin proyección la cascada mentiría 90.000.
  const nov = cascada(d, "2026-11");
  assert.deepEqual(nov.sinTope, [{ cat: "Servicios", monto: 90000 }]);
  assert.equal(nov.queda, 3260000);
});

// Review Focus 2: fila huerfana de una categoria que ya no esta en CATS.
test("cascada: un tope de una categoria que ya no existe se sigue restando y se lista", () => {
  const d = base();
  d.topes = [{ cat: "Nafta", monto: 250000 }];
  const c = cascada(d, "2026-10");
  assert.equal(c.totalTopes, 250000);
  assert.equal(c.topes[0].cat, "Nafta");
});

// Review Focus 5: nunca una tercera persona fantasma.
test("cascada: un gasto personal sin quien se agrupa bajo nico", () => {
  const d = base();
  d.movs = [{ fecha: "2026-10-05", monto: 100, cuenta_id: "e", ambito: "personal", quien: null }];
  const c = cascada(d, "2026-10");
  assert.deepEqual(Object.keys(c.personal).sort(), ["dani", "nico"]);
  assert.equal(c.personal.nico, 100);
  assert.equal(c.personal.dani, 0);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test`
Expected: FAIL — `cascada is not a function`

- [ ] **Step 3: Implementar**

Agregar a `public/calculo.mjs`:

```js
// Los servicios del mes corriente ya existen como filas en mov: los genera
// generarDelMes() en el Worker. Para un mes futuro todavia no existen, asi que hay que
// proyectarlos. Sin esto, navegar al mes que viene muestra una cascada sin luz, sin gas
// y sin las cuotas de las deudas, o sea muchisimo mas optimista de lo que es.
export function movsDelMes(movs, servicios, mes, mesCorriente) {
  if (mes <= mesCorriente) return movs;
  const yaEstan = new Set(
    movs.filter(m => m.servicio_id && mesDe(m.fecha) === mes).map(m => m.servicio_id));
  const proyectados = servicios
    .filter(s => vigenteEn(s, mes) && !yaEstan.has(s.id))
    .map(s => ({
      id: "proy" + s.id + "-" + mes,
      fecha: fechaDeServicio(mes, s.dia),
      descripcion: s.nombre, monto: s.monto, cuenta_id: s.cuenta_id, cuotas: 1,
      cat: s.cat, quien: null, servicio_id: s.id,
      estado: s.modo === "auto" ? "pagado" : "pendiente",
      proyectado: true
    }));
  return movs.concat(proyectados);
}

// Las lineas del mes. La regla unica: si una categoria tiene tope se reserva el tope
// completo y todo lo de esa categoria lo consume; si no tiene tope se resta lo
// determinado tal cual. Un gasto de credito ya esta contado en la linea de tarjeta del
// mes en que se paga, asi que no se resta de nuevo como caja.
export function cascada({ movs, cuentas, ingresos, servicios, topes }, mes, mesCorriente) {
  const total = ingresos.filter(i => vigenteEn(i, mes)).reduce((a, i) => a + i.monto, 0);
  const todos = movsDelMes(movs, servicios, mes, mesCorriente);

  const credito = new Map(cuentas.filter(c => c.tipo === "credito").map(c => [c.id, c]));
  const familiar = m => m.ambito !== "personal" && m.estado !== "omitido";

  // El resumen que se paga en `mes`: las cuotas que caen acá, mas base_pago si ese
  // resumen todavia no se pago. base_cuotas nunca entra: la app no conoce su cronograma,
  // asi que repartirlo por mes seria inventar. Ver la spec.
  let tarjeta = 0;
  for (const m of todos) {
    const c = credito.get(m.cuenta_id);
    if (!c || !familiar(m) || !mesDe(m.fecha)) continue;
    for (const i of impactos(m, c)) if (i.mes === mes) tarjeta += i.monto;
  }
  for (const c of credito.values())
    if (c.base_pago && (!c.pagado_hasta || c.pagado_hasta < mes)) tarjeta += c.base_pago;

  const porCat = consumos(todos, mes);
  const conTope = topes.map(t => ({ cat: t.cat, tope: t.monto, consumido: porCat[t.cat] || 0 }));
  const totalTopes = conTope.reduce((a, t) => a + t.tope, 0);
  const catsConTope = new Set(topes.map(t => t.cat));

  // Caja de las categorias sin tope. Solo debito y efectivo: lo de credito ya esta
  // en `tarjeta`, sumarlo acá lo contaria dos veces en la misma moneda.
  // La bandeja, en cambio, lista TODOS los sin categoria del mes sin importar el medio:
  // se quieren clasificar igual, se hayan pagado como se hayan pagado.
  const sinTopeMap = {};
  const sinCategoria = [];
  for (const m of todos) {
    if (!familiar(m) || mesDe(m.fecha) !== mes) continue;
    if (!m.cat && !m.proyectado) sinCategoria.push(m);
    if (catsConTope.has(m.cat)) continue;
    const c = cuentas.find(x => x.id === m.cuenta_id);
    if (c && c.tipo === "credito") continue;
    const k = m.cat || "";
    sinTopeMap[k] = (sinTopeMap[k] || 0) + m.monto;
  }
  const sinTope = Object.entries(sinTopeMap).map(([cat, monto]) => ({ cat, monto }));
  const totalSinTope = sinTope.reduce((a, s) => a + s.monto, 0);

  const queda = total - tarjeta - totalSinTope - totalTopes;
  // Math.floor para que 2 * cadaUno nunca sea mas que lo que hay: el peso impar
  // queda sin repartir en vez de aparecer de la nada.
  const cadaUno = queda > 0 ? Math.floor(queda / 2) : 0;

  // Siempre las dos claves, siempre numero: la UI muestra dos filas y nunca una tercera.
  const personal = { nico: 0, dani: 0 };
  for (const m of todos) {
    if (m.ambito !== "personal" || mesDe(m.fecha) !== mes) continue;
    personal[m.quien === "dani" ? "dani" : "nico"] += m.monto;
  }

  return { ingresos: total, tarjeta, sinTope, totalSinTope,
           topes: conTope, totalTopes, sinCategoria, queda, cadaUno, personal };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/calculo.mjs src/calculo.test.mjs
git commit -m "feat: cascada del mes con tests"
```

---

### Task 5: Worker — `hasta` en servicio

**Files:**
- Modify: `src/index.js:20-34` (`generarDelMes`), `src/index.js:240-264` (`PATCH /api/servicios/:id`), `src/index.js:206-238` (`POST /api/servicios`)

**Interfaces:**
- Consumes: la columna `servicio.hasta` de Task 1.
- Produces: `POST` y `PATCH` de servicios aceptan `hasta` (`"YYYY-MM"` o `null`), y `generarDelMes` deja de generar pasado el `hasta`.

- [ ] **Step 1: Acotar `generarDelMes`**

En `src/index.js:22-24`, cambiar la consulta:

```js
  const { results } = await env.DB.prepare(
    "SELECT * FROM servicio WHERE activo = 1 AND desde <= ? AND (hasta IS NULL OR hasta >= ?)"
  ).bind(mes, mes).all();
```

Agregar arriba de la función, al comentario que ya está:

```js
// `hasta` corta la generacion: un compromiso de 7 cuotas deja de generar en el mes 8
// sin que haya que darlo de baja a mano. Esta condicion duplica a proposito la logica
// de vigenteEn() en public/calculo.mjs — una corre en SQL y la otra en el navegador.
// Si se cambia una, cambiar la otra.
```

- [ ] **Step 2: Aceptar `hasta` en el POST**

En el handler `POST /api/servicios` (`src/index.js:206`), agregar junto a los otros campos validados:

```js
      const hasta = /^\d{4}-\d{2}$/.test(b.hasta || "") ? b.hasta : null;
      if (hasta && hasta < desde) return json({ error: "El hasta no puede ser anterior al desde" }, 400);
```

Agregar `hasta` a la lista de columnas del `INSERT` y `hasta` al `.bind(...)`, en la misma posición.

- [ ] **Step 3: Aceptar `hasta` en el PATCH**

En `src/index.js:240-264`, agregar junto a los otros campos:

```js
      let hasta = actual.hasta;
      if (b.hasta !== undefined)
        hasta = /^\d{4}-\d{2}$/.test(b.hasta || "") ? b.hasta : null;
      if (hasta && hasta < actual.desde)
        return json({ error: "El hasta no puede ser anterior al desde" }, 400);
```

Cambiar el `UPDATE` para incluir `hasta=?` y agregar `hasta` al `.bind(...)` en la misma posición. Agregar `hasta` al objeto que devuelve el `json({...actual, ...})`.

- [ ] **Step 4: Verificar a mano con wrangler**

El Worker no tiene suite de tests (solo los módulos puros la tienen), así que esto se verifica con `wrangler dev` y curl.

```powershell
npx wrangler dev
```

En otra terminal, con el PIN que tengas en `.dev.vars`:

```bash
curl -s -X POST localhost:8787/api/servicios -H "x-pin: PIN" -H "content-type: application/json" \
  -d '{"nombre":"Escritura","monto":500000,"dia":10,"cuenta_id":"CID","modo":"manual","cat":"Deudas","hasta":"2026-10"}'
```

Esperado: 201 con `hasta: "2026-10"`. Después:

```bash
curl -s localhost:8787/api/state -H "x-pin: PIN" | grep -o '"hasta":"[^"]*"'
```

Esperado: el `hasta` viaja en el estado. Y pedir `/api/state` en un mes posterior al `hasta` no tiene que generar el gasto — verificable mirando que no aparezca un `mov` con id `sv<id>-2026-11`.

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat: servicio.hasta corta la generacion de gastos"
```

---

### Task 6: Worker — endpoints de ingresos

**Files:**
- Modify: `src/index.js:49-57` (`GET /api/state`), y agregar los handlers nuevos antes del `return json({ error: "Ruta no encontrada" }, 404)`

**Interfaces:**
- Consumes: la tabla `ingreso` de Task 1.
- Produces: `GET /api/state` devuelve `ingresos`; `POST /api/ingresos`, `PATCH /api/ingresos/:id`, `DELETE /api/ingresos/:id`.

- [ ] **Step 1: Agregar `ingresos` al estado**

En `src/index.js:50-56`, agregar la consulta al batch y al objeto de respuesta:

```js
      const [cuentas, movs, servicios, ingresos] = await env.DB.batch([
        env.DB.prepare("SELECT * FROM cuenta ORDER BY def DESC, nombre"),
        env.DB.prepare("SELECT * FROM mov ORDER BY fecha DESC, creado DESC LIMIT 2000"),
        env.DB.prepare("SELECT * FROM servicio ORDER BY activo DESC, modo, nombre"),
        env.DB.prepare("SELECT * FROM ingreso ORDER BY activo DESC, monto DESC")
      ]);
      return json({ cuentas: cuentas.results, movs: movs.results,
                    servicios: servicios.results, ingresos: ingresos.results });
```

- [ ] **Step 2: Agregar los handlers**

Antes del `return json({ error: "Ruta no encontrada" }, 404)`:

```js
    if (res === "ingresos" && !rid && m === "POST") {
      const b = await request.json();
      const nombre = (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const monto = Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const desde = /^\d{4}-\d{2}$/.test(b.desde || "") ? b.desde : mesActualAR();
      const hasta = /^\d{4}-\d{2}$/.test(b.hasta || "") ? b.hasta : null;
      if (hasta && hasta < desde)
        return json({ error: "El hasta no puede ser anterior al desde" }, 400);

      const row = {
        id: id(), nombre, monto,
        dia: b.dia == null ? null : Math.min(Math.max(parseInt(b.dia) || 1, 1), 31),
        desde, hasta, activo: 1, creado: new Date().toISOString()
      };
      await env.DB.prepare(
        "INSERT INTO ingreso (id,nombre,monto,dia,desde,hasta,activo,creado) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(row.id, row.nombre, row.monto, row.dia, row.desde, row.hasta, row.activo, row.creado).run();
      return json(row, 201);
    }

    if (res === "ingresos" && rid && m === "PATCH") {
      const b = await request.json();
      const actual = await env.DB.prepare("SELECT * FROM ingreso WHERE id = ?").bind(rid).first();
      if (!actual) return json({ error: "Ingreso inexistente" }, 404);

      const nombre = b.nombre === undefined ? actual.nombre : (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const monto = b.monto === undefined ? actual.monto : Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const dia = b.dia === undefined ? actual.dia
        : (b.dia == null ? null : Math.min(Math.max(parseInt(b.dia) || 1, 1), 31));
      const activo = b.activo === undefined ? actual.activo : (b.activo ? 1 : 0);
      let hasta = actual.hasta;
      if (b.hasta !== undefined) hasta = /^\d{4}-\d{2}$/.test(b.hasta || "") ? b.hasta : null;
      if (hasta && hasta < actual.desde)
        return json({ error: "El hasta no puede ser anterior al desde" }, 400);

      await env.DB.prepare(
        "UPDATE ingreso SET nombre=?, monto=?, dia=?, hasta=?, activo=? WHERE id=?"
      ).bind(nombre, monto, dia, hasta, activo, rid).run();
      return json({ ...actual, nombre, monto, dia, hasta, activo });
    }

    if (res === "ingresos" && rid && m === "DELETE") {
      await env.DB.prepare("DELETE FROM ingreso WHERE id = ?").bind(rid).run();
      return json({ ok: true });
    }
```

Un ingreso se puede borrar de verdad, a diferencia de un servicio: no generó ninguna fila en `mov` que quedaría huérfana.

- [ ] **Step 3: Verificar a mano**

```bash
curl -s -X POST localhost:8787/api/ingresos -H "x-pin: PIN" -H "content-type: application/json" \
  -d '{"nombre":"Sueldo","monto":1500000,"dia":5}'
curl -s -X POST localhost:8787/api/ingresos -H "x-pin: PIN" -H "content-type: application/json" \
  -d '{"nombre":"Viaticos","monto":1000000,"desde":"2026-11","hasta":"2026-11"}'
curl -s -X POST localhost:8787/api/ingresos -H "x-pin: PIN" -H "content-type: application/json" \
  -d '{"nombre":"Mal","monto":100,"desde":"2026-11","hasta":"2026-01"}'
```

Esperado: 201, 201, y la tercera un 400 con "El hasta no puede ser anterior al desde".

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: endpoints de ingresos"
```

---

### Task 7: Worker — endpoints de topes

**Files:**
- Modify: `src/index.js` (`GET /api/state` y handlers nuevos)

**Interfaces:**
- Consumes: la tabla `tope` de Task 1.
- Produces: `GET /api/state` devuelve `topes`; `PUT /api/topes/:cat` hace upsert; `DELETE /api/topes/:cat` saca el tope.

- [ ] **Step 1: Agregar `topes` al estado**

Agregar al batch de `GET /api/state`:

```js
        env.DB.prepare("SELECT * FROM tope ORDER BY monto DESC")
```

y `topes: topes.results` al objeto de respuesta, desestructurando `topes` del batch.

- [ ] **Step 2: Agregar los handlers**

```js
    // PUT y no POST: el tope esta identificado por la categoria, asi que poner un
    // tope es idempotente. Mandarlo dos veces no crea dos filas.
    if (res === "topes" && rid && m === "PUT") {
      const b = await request.json();
      const cat = decodeURIComponent(rid).slice(0, 40);
      if (!cat) return json({ error: "Falta la categoría" }, 400);
      const monto = Number(b.monto);
      if (!(monto >= 0)) return json({ error: "Monto inválido" }, 400);
      await env.DB.prepare(
        "INSERT INTO tope (cat,monto) VALUES (?,?) ON CONFLICT(cat) DO UPDATE SET monto=excluded.monto"
      ).bind(cat, monto).run();
      return json({ cat, monto });
    }

    if (res === "topes" && rid && m === "DELETE") {
      await env.DB.prepare("DELETE FROM tope WHERE cat = ?").bind(decodeURIComponent(rid)).run();
      return json({ ok: true });
    }
```

Un tope de 0 se acepta a propósito: es "esta categoría no se toca este mes", distinto de no tener tope.

- [ ] **Step 3: Verificar a mano**

```bash
curl -s -X PUT localhost:8787/api/topes/Supermercado -H "x-pin: PIN" -H "content-type: application/json" -d '{"monto":600000}'
curl -s -X PUT localhost:8787/api/topes/Supermercado -H "x-pin: PIN" -H "content-type: application/json" -d '{"monto":650000}'
curl -s localhost:8787/api/state -H "x-pin: PIN" | grep -o '"topes":\[[^]]*\]'
```

Esperado: una sola fila de Supermercado, con 650000. Y con una categoría con espacios y acentos:

```bash
curl -s -X PUT "localhost:8787/api/topes/Ocio%20%2F%20Paseo" -H "x-pin: PIN" -H "content-type: application/json" -d '{"monto":80000}'
```

Esperado: 200 con `cat: "Ocio / Paseo"`. Si devuelve la categoría partida o escapada, el `decodeURIComponent` está mal puesto.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: endpoints de topes por categoria"
```

---

### Task 8: Worker — `ambito` y `PATCH /api/movs/:id`

**Files:**
- Modify: `src/index.js:59-82` (`POST /api/movs`), y un handler nuevo

**Interfaces:**
- Consumes: la columna `mov.ambito` de Task 1.
- Produces: `POST /api/movs` acepta `ambito`; `PATCH /api/movs/:id` cambia `cat` y `ambito` y devuelve la fila entera.

- [ ] **Step 1: Aceptar `ambito` en el POST**

En el objeto `row` de `src/index.js:67-77`, agregar:

```js
        ambito: b.ambito === "personal" ? "personal" : null,
```

Cambiar el `INSERT` para incluir la columna `ambito` y agregar `row.ambito` al `.bind(...)` en la misma posición.

- [ ] **Step 2: Agregar el PATCH**

Después del handler de `DELETE /api/movs/:id`:

```js
    // Acotado a cat y ambito: reclasificar, no editar. El monto, la fecha y la
    // descripcion siguen sin poder cambiarse (ver "Fuera de alcance" en la spec).
    // En un gasto generado por un servicio esto afecta solo esa fila: el mes que
    // viene se genera con la cat del servicio, igual que pasa con el monto.
    if (res === "movs" && rid && !action && m === "PATCH") {
      const b = await request.json();
      const actual = await env.DB.prepare("SELECT * FROM mov WHERE id = ?").bind(rid).first();
      if (!actual) return json({ error: "Gasto inexistente" }, 404);

      const cat = b.cat === undefined ? actual.cat : (b.cat || null);
      const ambito = b.ambito === undefined ? actual.ambito
        : (b.ambito === "personal" ? "personal" : null);

      await env.DB.prepare("UPDATE mov SET cat=?, ambito=? WHERE id=?")
        .bind(cat, ambito, rid).run();
      return json({ ...actual, cat, ambito });
    }
```

- [ ] **Step 3: Verificar a mano**

```bash
curl -s -X POST localhost:8787/api/movs -H "x-pin: PIN" -H "content-type: application/json" \
  -d '{"fecha":"2026-10-05","descripcion":"bazar","monto":12000,"cuenta_id":"CID"}'
# tomar el id que devuelve
curl -s -X PATCH localhost:8787/api/movs/EL_ID -H "x-pin: PIN" -H "content-type: application/json" \
  -d '{"cat":"Hogar"}'
curl -s -X PATCH localhost:8787/api/movs/EL_ID -H "x-pin: PIN" -H "content-type: application/json" \
  -d '{"ambito":"personal"}'
curl -s -X PATCH localhost:8787/api/movs/EL_ID -H "x-pin: PIN" -H "content-type: application/json" \
  -d '{"monto":999999}'
```

Esperado: el `cat` cambia, el `ambito` cambia y el `cat` se mantiene (porque no se mandó), y el último devuelve la fila con el **monto original** — el campo se ignora sin error.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: ambito en mov y PATCH para reclasificar"
```

---

### Task 9: UI — pestaña Plan

**Files:**
- Modify: `public/index.html` — nav (`:260-265`), una `<section id="v-plan">` nueva después de `v-month`, el `boot()`/carga de estado para guardar `ingresos` y `topes`, y el handler de la nav

**Interfaces:**
- Consumes: `ingresos` y `topes` de `GET /api/state` (tareas 6 y 7); los endpoints de las tareas 6 y 7.
- Produces: `let ingresos = [], topes = []` como variables de módulo, y `renderPlan()`.

- [ ] **Step 1: Agregar el botón a la nav**

En `public/index.html:260-265`, insertar entre Mes y Servicios:

```html
  <button data-v="plan" aria-selected="false">Plan</button>
```

- [ ] **Step 2: Agregar la sección**

Después de `</section>` de `v-month`:

```html
  <section id="v-plan" hidden>
    <h1>Plan del mes</h1>
    <div class="sect">Ingresos</div>
    <div class="card" id="ingresos-list"></div>
    <div class="card">
      <div class="field">
        <label for="i-nom">Nombre</label>
        <input id="i-nom" placeholder="Sueldo, alquiler del depto…" autocomplete="off">
      </div>
      <div class="inline field">
        <div>
          <label for="i-monto">Monto</label>
          <input id="i-monto" inputmode="decimal" placeholder="0" autocomplete="off">
        </div>
        <div>
          <label for="i-dia">Día del mes</label>
          <input id="i-dia" inputmode="numeric" value="5">
        </div>
      </div>
      <div class="field">
        <label for="i-hasta">Solo este mes</label>
        <select id="i-hasta">
          <option value="">No, todos los meses</option>
          <option value="unico">Sí, entra una sola vez</option>
        </select>
      </div>
      <button id="i-save">Agregar ingreso</button>
    </div>
    <div class="sect">Topes por categoría</div>
    <p class="hint">Una categoría sin tope no se reserva: se resta lo que realmente se paga.</p>
    <div class="card" id="topes-list"></div>
  </section>
```

- [ ] **Step 3: Guardar el estado nuevo**

Cambiar la declaración de `public/index.html:275`:

```js
let cuentas = [], movs = [], servicios = [], ingresos = [], topes = [], cursor = new Date();
```

Y donde se asigna el estado después de `await api("state")` (hay tres lugares: el boot, y los dos refrescos de `index.html:628` y `:741`), agregar:

```js
  ingresos = s.ingresos || []; topes = s.topes || [];
```

- [ ] **Step 4: Escribir `renderPlan()`**

```js
function renderPlan(){
  const vig = ingresos.filter(i => vigenteEn(i, ym(cursor)));
  const tot = vig.reduce((a,i) => a + i.monto, 0);
  $("ingresos-list").innerHTML = ingresos.length
    ? ingresos.map(i => {
        const unico = i.hasta && i.hasta === i.desde;
        const corre = vigenteEn(i, ym(cursor));
        return `<div class="row" style="${corre ? "" : "opacity:.5"}">
          <div class="name">${esc(i.nombre)}
            <span class="sub">${i.dia ? "día " + i.dia : "sin día"}${unico ? " · solo " + i.desde : ""}${i.activo ? "" : " · de baja"}</span></div>
          <div class="val mono">${fmt(i.monto)}</div>
          <button data-rmi="${i.id}" class="mini">✕</button></div>`;
      }).join("") + `<div class="row"><div class="name"><b>Total del mes</b></div>
         <div class="val mono"><b>${fmt(tot)}</b></div></div>`
    : `<div class="empty">Sin ingresos cargados. La cascada no puede calcular nada todavía.</div>`;

  const porCat = Object.fromEntries(topes.map(t => [t.cat, t.monto]));
  // Las categorias con tope primero, despues las que podrian tenerlo. Un tope de una
  // categoria que ya no esta en CATS igual se lista, para poder sacarlo.
  const orden = [...new Set([...topes.map(t => t.cat), ...CATS])];
  $("topes-list").innerHTML = orden.map(c => `<div class="row">
    <div class="name">${esc(c)}${CATS.includes(c) ? "" : ` <span class="tag">vieja</span>`}</div>
    <input class="tope-in mono" data-cat="${esc(c)}" inputmode="decimal"
      value="${porCat[c] ?? ""}" placeholder="sin tope"></div>`).join("");
}
```

- [ ] **Step 5: Conectar los handlers**

```js
$("i-save").addEventListener("click", async () => {
  const monto = parseMonto($("i-monto").value);
  const nombre = $("i-nom").value.trim();
  if(!monto || !nombre) return;
  const mes = ym(cursor);
  try {
    const row = await api("ingresos", "POST", { nombre, monto, dia: +$("i-dia").value || null,
      desde: mes, hasta: $("i-hasta").value === "unico" ? mes : null });
    ingresos.push(row);
    $("i-nom").value = ""; $("i-monto").value = "";
    toast("Ingreso agregado"); renderPlan(); renderMonth();
  } catch(e){ showErr("No se guardó: " + e.message); }
});

$("ingresos-list").addEventListener("click", async e => {
  const iid = e.target.dataset.rmi; if(!iid) return;
  try {
    await api("ingresos/" + iid, "DELETE");
    ingresos = ingresos.filter(i => i.id !== iid);
    toast("Ingreso borrado"); renderPlan(); renderMonth();
  } catch(err){ showErr("No se borró: " + err.message); }
});

// `change` y no `input`: guarda al salir del campo, no en cada tecla.
$("topes-list").addEventListener("change", async e => {
  const cat = e.target.dataset.cat; if(!cat) return;
  const v = e.target.value.trim();
  try {
    if(!v){
      await api("topes/" + encodeURIComponent(cat), "DELETE");
      topes = topes.filter(t => t.cat !== cat);
      toast("Tope sacado");
    } else {
      const row = await api("topes/" + encodeURIComponent(cat), "PUT", { monto: parseMonto(v) });
      const i = topes.findIndex(t => t.cat === cat);
      if(i >= 0) topes[i] = row; else topes.push(row);
      toast("Tope guardado");
    }
    renderPlan(); renderMonth();
  } catch(err){ showErr("No se guardó: " + err.message); }
});
```

Importar `vigenteEn` en el `import` del tope del script:

```js
import { impactos, ym, vigenteEn, consumos, cascada } from "./calculo.mjs";
```

- [ ] **Step 6: Llamar a `renderPlan()` donde se renderiza el resto**

Buscar el handler de la nav (`index.html:795-797`) y la función de boot, y agregar `renderPlan()` donde se llaman los otros `render*`.

- [ ] **Step 7: Verificar en el navegador**

```powershell
npx wrangler dev
```

Cargar los tres ingresos reales (sueldo 1.500.000, y los dos deptos de 950.000 y 900.000), poner el tope de Supermercado en 600.000, recargar la página y verificar que **los números siguen ahí**. Probar poner un tope, borrarlo dejando el campo vacío, y poner un tope en "Ocio / Paseo" (con espacios y barra) para ver que no se rompe.

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "feat: pestaña Plan con ingresos y topes"
```

---

### Task 10: UI — la cascada en la pestaña Mes

**Files:**
- Modify: `public/index.html:156-161` (el card del total), `renderMonth()` (`:379-384`)

**Interfaces:**
- Consumes: `cascada()` de Task 4; `ingresos` y `topes` de Task 9.
- Produces: el bloque de la cascada renderizado, y `const c = cascada(...)` disponible dentro de `renderMonth()` para las tareas 11, 12 y 14.

- [ ] **Step 1: Cambiar el markup del card del total**

Reemplazar `public/index.html:156-161`:

```html
    <div class="card">
      <label style="margin:0">Queda para dividir</label>
      <div class="total"><div class="big mono" id="mtotal">$0</div></div>
      <p class="hint" id="mfalta"></p>
      <p class="hint" id="mgastado"></p>
      <div id="cascada"></div>
      <div id="pormedio"></div>
    </div>
```

- [ ] **Step 2: Calcular y mostrar la cascada en `renderMonth()`**

Al principio de `renderMonth()`, después de `const key = ym(cursor);`:

```js
  // El tercer argumento es el mes corriente: la cascada lo necesita para saber si tiene
  // que proyectar los servicios (en un mes futuro todavia no tienen fila en mov).
  const c = cascada({ movs, cuentas, ingresos, servicios, topes }, key, hoyISO().slice(0,7));

  $("mtotal").textContent = fmt(c.queda);
  $("mtotal").style.color = c.queda < 0 ? "var(--bad)" : "";
  $("mfalta").textContent = c.queda < 0
    ? `Faltan ${fmt(-c.queda)} para cubrir el mes.`
    : `Cada uno: ${fmt(c.cadaUno)}.`;

  const lineas = [
    ["Ingresos", c.ingresos],
    ["Tarjeta", -c.tarjeta],
    ...c.sinTope.map(s => [s.cat || "Sin categoría", -s.monto]),
    ["Topes", -c.totalTopes]
  ].filter(([, v]) => v !== 0);

  $("cascada").innerHTML = lineas.map(([n, v]) => `<div class="row" style="border:none;padding:4px 0">
    <div class="name">${esc(n)}</div>
    <div class="val mono" style="${v < 0 ? "color:var(--muted)" : ""}">${v < 0 ? "−" : ""}${fmt(Math.abs(v))}</div></div>`).join("");
```

**Ojo con el total viejo:** el `$("mtotal").textContent = fmt(total)` que está hoy en `renderMonth()` (`index.html:385`) hay que **borrarlo**, y lo que calculaba (`total`, el gasto del mes) pasa a la línea chica:

```js
  $("mgastado").textContent = `Gastado: ${fmt(total)}`;
```

La variable `total` y el array `filas` se siguen usando más abajo para `#pormedio` y `#mlist`: no tocarlos.

- [ ] **Step 3: Agregar la variable CSS `--bad` si no existe**

```bash
grep -n '\-\-bad' public/index.html
```

Si ya existe, usarla tal cual. Si no está, agregarla al bloque `:root` del tope del archivo:

```css
  --bad: #B3261E;
```

Es el rojo que ya usa el tag `vencido` de la pestaña Servicios; verificar con
`grep -n 'venc' public/index.html` y copiar ese valor exacto en vez de este, si difiere.

- [ ] **Step 4: Verificar en el navegador**

Con los ingresos y el tope de Supermercado de Task 9 cargados, abrir la pestaña Mes y comparar el número grande con la cuenta hecha a mano: `ingresos − tarjeta − sin tope − topes`. Navegar a un mes sin ingresos vigentes y verificar que el número da negativo y dice "Faltan …". Navegar a noviembre y verificar que la línea de Tarjeta cambia (las cuotas de las compras de octubre caen ahí).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: la cascada del mes reemplaza el total grande"
```

---

### Task 11: UI — barras de topes, y editar un tope tocando la barra

**Files:**
- Modify: `public/index.html` — markup de `v-month` y `renderMonth()`

**Interfaces:**
- Consumes: `c.topes` de Task 10.
- Produces: el bloque `#topesmes`.

- [ ] **Step 1: Escribir el test del tope en 0 (Review Focus 4)**

Agregar a `src/calculo.test.mjs`:

```js
import { anchoBarra } from "../public/calculo.mjs";

test("anchoBarra: un tope en 0 no da NaN", () => {
  assert.equal(anchoBarra(0, 0), 0);
  assert.equal(anchoBarra(100, 0), 100);
});

test("anchoBarra: nunca pasa de 100", () => {
  assert.equal(anchoBarra(50, 100), 50);
  assert.equal(anchoBarra(500, 100), 100);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test`
Expected: FAIL — `anchoBarra is not a function`

- [ ] **Step 3: Implementar `anchoBarra`**

Agregar a `public/calculo.mjs`:

```js
// Ancho de una barra en porcentaje. Un tope en 0 significa "no se toca": la barra
// va llena si hubo consumo y vacia si no, en vez de dividir por cero.
export function anchoBarra(consumido, tope) {
  if (!tope) return consumido > 0 ? 100 : 0;
  return Math.min(100, Math.round(consumido / tope * 100));
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Agregar el markup**

Después del card del total en `v-month`:

```html
    <div class="sect" id="topes-sect" hidden>Topes</div>
    <div class="card" id="topesmes" hidden></div>
```

- [ ] **Step 6: Renderizar las barras**

En `renderMonth()`, después del bloque de la cascada:

```js
  $("topes-sect").hidden = $("topesmes").hidden = !c.topes.length;
  $("topesmes").innerHTML = c.topes
    .slice().sort((a,b) => b.tope - a.tope)
    .map(t => {
      const resto = t.tope - t.consumido;
      const paso = resto < 0;
      return `<div style="margin-top:12px" data-tope="${esc(t.cat)}">
        <div class="row" style="border:none;padding:0">
          <div class="name">${esc(t.cat)}</div>
          <div class="val mono">${fmt(t.consumido)} / ${fmt(t.tope)}</div></div>
        <div class="bar"><i style="width:${anchoBarra(t.consumido, t.tope)}%${paso ? ";background:var(--bad)" : ""}"></i></div>
        <div class="sub">${paso ? "te pasaste " + fmt(-resto) : "quedan " + fmt(resto)}</div></div>`;
    }).join("");
```

Importar `anchoBarra` en el `import` del tope del script.

- [ ] **Step 7: Editar el tope tocando la barra**

```js
// Tocar una barra edita ese tope ahi mismo: es donde uno se da cuenta de que esta mal.
$("topesmes").addEventListener("click", async e => {
  const box = e.target.closest("[data-tope]"); if(!box) return;
  const cat = box.dataset.tope;
  const actual = topes.find(t => t.cat === cat);
  const v = prompt(`Tope de ${cat}`, actual ? actual.monto : "");
  if(v === null) return;
  const monto = parseMonto(v);
  try {
    if(!monto){
      await api("topes/" + encodeURIComponent(cat), "DELETE");
      topes = topes.filter(t => t.cat !== cat);
    } else {
      const row = await api("topes/" + encodeURIComponent(cat), "PUT", { monto });
      const i = topes.findIndex(t => t.cat === cat);
      if(i >= 0) topes[i] = row; else topes.push(row);
    }
    toast("Tope actualizado"); renderMonth(); renderPlan();
  } catch(err){ showErr("No se guardó: " + err.message); }
});
```

**`prompt()` es un diálogo modal del navegador.** Es lo más corto que resuelve esto y la app ya usa `confirm()` para borrar un gasto (`index.html:661`), así que es consistente con lo que hay. Si en la revisión molesta, reemplazarlo por un input inline — pero no mezclar ese cambio con esta tarea.

- [ ] **Step 8: Verificar en el navegador**

Con el tope de Supermercado en 600.000, cargar un gasto de supermercado de 650.000 con fecha de este mes y verificar que la barra se pone roja y dice "te pasaste 50.000". Poner el tope en 0 y verificar que la barra se llena sin mostrar `NaN%`. Tocar la barra, cambiar el número, y verificar que el número grande de la cascada se recalcula.

- [ ] **Step 9: Commit**

```bash
git add public/calculo.mjs src/calculo.test.mjs public/index.html
git commit -m "feat: barras de topes en el mes, editables al tocarlas"
```

---

### Task 12: UI — la bandeja de los gastos sin categoría

**Files:**
- Modify: `public/index.html` — markup de `v-month` y `renderMonth()`

**Interfaces:**
- Consumes: `c.sinCategoria` de Task 10; `PATCH /api/movs/:id` de Task 8.
- Produces: el bloque `#bandeja`.

- [ ] **Step 1: Agregar el markup**

```html
    <div class="sect" id="bandeja-sect" hidden>Sin categoría</div>
    <div class="card" id="bandeja" hidden></div>
```

- [ ] **Step 2: Renderizar la bandeja**

En `renderMonth()`, después de las barras de topes:

```js
  const sc = c.sinCategoria;
  $("bandeja-sect").hidden = $("bandeja").hidden = !sc.length;
  $("bandeja-sect").textContent = `Sin categoría · ${sc.length} ${sc.length === 1 ? "gasto" : "gastos"}`;
  $("bandeja").innerHTML = sc.map(m => `<div class="row">
    <div class="name">${esc(m.descripcion)}
      <span class="sub">${esc(nombreCuenta(m.cuenta_id))} · ${m.fecha.slice(8)}/${m.fecha.slice(5,7)}</span></div>
    <div class="val mono">${fmt(m.monto)}</div>
    <select data-asignar="${m.id}">
      <option value="">asignar…</option>
      ${CATS.map(x => `<option>${x}</option>`).join("")}
    </select></div>`).join("");
```

- [ ] **Step 3: Conectar la asignación**

```js
$("bandeja").addEventListener("change", async e => {
  const mid = e.target.dataset.asignar; if(!mid) return;
  const cat = e.target.value; if(!cat) return;
  try {
    const row = await api("movs/" + mid, "PATCH", { cat });
    const i = movs.findIndex(m => m.id === mid);
    if(i >= 0) movs[i] = row;
    toast(`Va a ${cat}`); renderMonth();
  } catch(err){ showErr("No se guardó: " + err.message); }
});
```

- [ ] **Step 4: Verificar en el navegador**

Cargar un gasto **sin elegir categoría** (dejando el selector en "—"). Verificar que aparece en la bandeja, que la línea "Sin categoría" aparece en la cascada con su monto, y que al asignarle "Hogar" desaparece de la bandeja y aparece consumiendo el tope de Hogar si lo tiene. Cargar uno sin categoría con tarjeta y verificar que aparece en la bandeja **pero no** en las líneas de la cascada (ya está dentro de Tarjeta).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: bandeja de gastos sin categoria, asignables desde el mes"
```

---

### Task 13: UI — el recordatorio

**Files:**
- Modify: `public/index.html` — `renderLoad()` (`:353-366`), el handler de `#save` (`:640-657`), y el markup del selector de categoría

**Interfaces:**
- Consumes: `consumos()` de Task 3; `topes` de Task 9.
- Produces: `restante(cat)`, usado por `renderLoad()` y por el toast.

- [ ] **Step 1: Agregar el hint abajo del selector de categoría**

Buscar el `<select id="cat">` en el markup y agregar justo después:

```html
      <p class="hint" id="cathint"></p>
```

- [ ] **Step 2: Escribir el helper y mostrarlo**

Junto a los otros helpers:

```js
// Cuanto queda del tope de una categoria en el mes de la fecha que se esta cargando.
// null si esa categoria no tiene tope.
function restante(cat, mes){
  const t = topes.find(x => x.cat === cat);
  if(!t) return null;
  return t.monto - (consumos(movs, mes)[cat] || 0);
}
```

Al final de `renderLoad()`:

```js
  const cat = $("cat").value;
  const r = cat ? restante(cat, ($("fecha").value || hoyISO()).slice(0,7)) : null;
  $("cathint").textContent = r === null ? ""
    : r >= 0 ? `${cat} · quedan ${fmt(r)}`
             : `${cat} · ya te pasaste ${fmt(-r)}`;
```

Y hacer que el selector dispare el re-render:

```js
$("cat").addEventListener("change", renderLoad);
```

- [ ] **Step 3: Cambiar el toast al guardar**

En el handler de `#save` (`index.html:652`), reemplazar `toast("Gasto guardado")` por:

```js
    const r = row.cat ? restante(row.cat, row.fecha.slice(0,7)) : null;
    toast(r === null ? "Gasto guardado"
      : r >= 0 ? `Guardado · ${row.cat}: quedan ${fmt(r)}`
               : `Guardado · ${row.cat}: te pasaste ${fmt(-r)}`);
```

**El orden importa:** esto va **después** de `movs.push(row)`, porque `restante()` lee `movs` y tiene que ver el gasto que se acaba de cargar.

- [ ] **Step 4: Verificar en el navegador**

Con el tope de Supermercado en 600.000 y 420.000 ya consumidos: elegir Supermercado en el selector y verificar que el hint dice "quedan 180.000". Cargar 200.000 y verificar que el toast dice "te pasaste 20.000". Elegir una categoría sin tope y verificar que el hint queda vacío y el toast dice solo "Gasto guardado". **Contar los taps de un gasto familiar: tienen que seguir siendo 4.**

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: recordatorio del tope al elegir categoria y al guardar"
```

---

### Task 14: UI — el gasto personal

**Files:**
- Modify: `public/index.html` — markup de la pestaña Cargar (el selector de quien), el handler de `#save`, markup de `v-month` y `renderMonth()`

**Interfaces:**
- Consumes: `c.cadaUno` y `c.personal` de Task 10; `ambito` en `POST /api/movs` de Task 8.
- Produces: el bloque `#cadauno`.

- [ ] **Step 1: Agregar el toggle**

Buscar en el markup de la pestaña Cargar el selector de Nico/Dani y agregar al lado:

```html
      <label class="chk"><input type="checkbox" id="personal"> personal</label>
```

Si no hay una clase `.chk`, agregarla al CSS del tope con el mismo criterio que el resto (`font-size:13px`, `color:var(--muted)`).

- [ ] **Step 2: Mandar `ambito` al guardar**

En el `api("movs", "POST", {...})` del handler de `#save`, agregar:

```js
      ambito: $("personal").checked ? "personal" : null
```

Y después de guardar, **desmarcar el checkbox** junto con el resto de la limpieza del formulario, para que el próximo gasto no salga personal sin querer:

```js
    $("personal").checked = false;
```

- [ ] **Step 3: Agregar el bloque "cada uno"**

```html
    <div class="sect">Cada uno</div>
    <div class="card" id="cadauno"></div>
```

- [ ] **Step 4: Renderizarlo**

En `renderMonth()`:

```js
  // Cargar el gasto personal es opcional: si no cargaron nada, el bloque igual dice
  // cuanto le toca a cada uno. El que no carga no queda en cero, queda sin registro.
  $("cadauno").innerHTML = ["nico","dani"].map(q => {
    const g = c.personal[q] || 0;
    const sub = c.cadaUno > 0
      ? (g ? `te quedan ${fmt(c.cadaUno - g)} de ${fmt(c.cadaUno)}` : `${fmt(c.cadaUno)} sin tocar`)
      : (g ? `cargó ${fmt(g)}` : "este mes no hay presupuesto personal");
    return `<div class="row q-${q}"><div class="name">${q === "nico" ? "Nico" : "Dani"}
      <span class="sub">${sub}</span></div>
      <div class="val mono">${c.cadaUno > 0 ? fmt(c.cadaUno - g) : fmt(g)}</div></div>`;
  }).join("");
```

- [ ] **Step 5: Verificar en el navegador**

Cargar un gasto con "personal" marcado y verificar que: **no** aparece en el total del mes, **no** consume ningún tope, el número grande de la cascada **no cambia**, y sí aparece en el bloque "cada uno" bajo quien lo cargó. Después cargar un gasto sin marcarlo y verificar que el checkbox arrancó desmarcado.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: gasto personal opcional y bloque cada uno"
```

---

### Task 15: Documentación

**Files:**
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada que use otra tarea.

- [ ] **Step 1: Actualizar la estructura de archivos en `CLAUDE.md`**

Agregar al bloque de estructura:

```
public/calculo.mjs      aritmética pura: impactos, vigenteEn, consumos, cascada, anchoBarra
src/calculo.test.mjs    tests de calculo.mjs — mismo `node --test`
migracion-presupuesto.sql  topes, ingresos, servicio.hasta, mov.ambito, ya aplicado (2026-10-02)
```

Y corregir la línea de `public/index.html`: ya no es "la app entera", es "HTML + CSS + render. La aritmética está en `calculo.mjs`".

- [ ] **Step 2: Actualizar el modelo de datos en `CLAUDE.md`**

Agregar `ingreso` y `tope` al bloque SQL, y las columnas `servicio.hasta` y `mov.ambito` con sus comentarios. Documentar que `hasta` es un final previsto y `activo = 0` una baja en el camino, y por qué hacen falta los dos.

- [ ] **Step 3: Reemplazar las reglas que quedaron viejas**

- **Borrar** la nota que pide verificar `impactos()` a mano: ahora tiene tests. En su lugar: "Si se toca `impactos()`, correr `node --test`".
- **Borrar** "No hay ingresos. Solo gastos, a propósito." Reemplazar por por qué los ingresos van en tabla aparte y no como `tipo` en `mov`: `mov` sigue significando *plata que sale* y ninguna consulta existente necesita un filtro nuevo.
- **Agregar** las reglas nuevas, con el mismo tono que las que ya están: la regla única de los topes (con tope se reserva todo, sin tope se resta lo determinado); los dos relojes (topes por fecha de compra, resumen por mes de pago, y que la doble carga durante la transición es a propósito); que un `pendiente` consume tope aunque no sume al total del mes, y por qué; que una compra en cuotas consume el tope completo en el mes de compra; que `base_cuotas` no entra en la línea de tarjeta y la consecuencia práctica; que un compromiso es un servicio con `hasta`; y que el reparto es fijo del día 1, 50/50.
- **Agregar** que la condición de vigencia está duplicada a propósito entre el SQL de `generarDelMes` y `vigenteEn()` en `calculo.mjs`, y que si se cambia una hay que cambiar la otra.

- [ ] **Step 4: Sacar de "Cosas pendientes" lo que se hizo**

Queda pendiente: editar monto/fecha/descripción de un gasto, editar un servicio desde la app (el `PATCH` existe, falta la UI), reactivar un servicio dado de baja, importar el resumen de la tarjeta. Agregar: multi-moneda para la deuda en USD, reparto distinto a 50/50, historial de topes, y repartir el sobrante de un tope a fin de mes.

- [ ] **Step 5: Actualizar el `README.md`**

Ya estaba atrasado antes de esto: dice "las tres tablas" y no menciona `migracion-limites.sql`. Actualizar la lista de archivos, las migraciones, y agregar un párrafo en "Cómo funciona" sobre la cascada y los topes.

- [ ] **Step 6: Correr todo y commitear**

```bash
node --test
git add CLAUDE.md README.md
git commit -m "docs: presupuesto familiar, cascada y topes"
```

---

## Verificación final

- [ ] `node --test` desde la raíz: todo verde, sin tests salteados.
- [ ] La consola del navegador sin un solo error, en las cinco pestañas.
- [ ] Un gasto familiar se sigue cargando en 4 taps.
- [ ] El número grande de la pestaña Mes coincide con `ingresos − tarjeta − sin tope − topes` hecho a mano.
- [ ] Navegar tres meses para adelante y tres para atrás sin que nada explote ni muestre `NaN`.
- [ ] Recargar la página y verificar que todo lo cargado sigue ahí (o sea: se guardó en D1, no quedó solo en el array local).
