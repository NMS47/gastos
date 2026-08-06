# Tag "pagado" y total pendiente en servicios — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en la pestaña Servicios se vea de un vistazo cuáles servicios manuales ya se pagaron, y cuánta plata falta que salga.

**Architecture:** Dos cambios independientes en `public/index.html`, los dos de render puro. El primero agrega un tag verde "pagado" en las filas de servicios manuales saldados. El segundo agrega una línea "Falta pagar" en la tarjeta de arriba, con la suma de todo `mov` en estado `'pendiente'`. No se toca la base de datos, ni el Worker, ni `/api/state`: la información ya viaja completa.

**Tech Stack:** HTML + CSS + JS vanilla en un solo archivo. Sin build step. Cloudflare Worker + D1 para servir y persistir.

**Spec:** `docs/superpowers/specs/2026-08-06-servicios-pagados-design.md`

## Global Constraints

- Todo el texto de la UI en español rioplatense, voseo, sentence case.
- Montos siempre con la función `fmt()` que ya existe (usa `toLocaleString("es-AR")`, sin decimales).
- Colores y tipografías salen de las variables CSS al tope del archivo. No hardcodear colores nuevos salvo el fondo del tag, que sigue el patrón de los tags existentes.
- No agregar dependencias, ni build step, ni archivos nuevos en `public/`.
- No hay tests automáticos para esto: es render en `index.html`, que no tiene infraestructura de test (igual que `impactos()`). La verificación es manual y está detallada en cada task.
- Los dos tasks tocan `public/index.html`. Si se ejecutan en paralelo van a chocar — hacerlos en orden.

---

## Preparación del entorno (una sola vez, antes del Task 1)

Sin esto no hay datos contra los cuales mirar la pantalla: la D1 local arranca vacía.

- [ ] **Paso 1: Crear el PIN local**

El Worker rechaza con 401 si no coincide el header `x-pin`. En local sale de `.dev.vars`
(ya está en `.gitignore`, no se commitea):

```bash
echo 'PIN=1234' > .dev.vars
```

- [ ] **Paso 2: Crear las tablas en la D1 local**

```bash
npx wrangler d1 execute gastos --local --file=./schema.sql
```

- [ ] **Paso 3: Sembrar servicios de prueba**

Guardar como `seed-local.sql` en la raíz (borrar el archivo al terminar, no se commitea):

```sql
INSERT OR REPLACE INTO servicio (id, nombre, monto, dia, cuenta_id, cat, modo, activo, desde, creado) VALUES
  ('s1', 'Netflix',  8500,  25, 'mp', NULL, 'auto',   1, '2026-07', '2026-07-01'),
  ('s2', 'Expensas', 95000, 10, 'ef', NULL, 'manual', 1, '2026-07', '2026-07-01'),
  ('s3', 'Agua',     12300, 15, 'ef', NULL, 'manual', 1, '2026-07', '2026-07-01'),
  ('s4', 'Edenor',   18400, 12, 'vi', NULL, 'manual', 1, '2026-07', '2026-07-01');

-- Un pendiente arrastrado de julio, para probar el caso "vencido".
-- El id sigue el formato determinístico "sv" + servicio_id + "-" + mes.
INSERT OR REPLACE INTO mov (id, fecha, descripcion, monto, cuenta_id, cuotas, cat, quien, servicio_id, estado, creado) VALUES
  ('svs4-2026-07', '2026-07-12', 'Edenor', 18400, 'vi', 1, NULL, NULL, 's4', 'pendiente', '2026-07-01');
```

Correr:

```bash
npx wrangler d1 execute gastos --local --file=./seed-local.sql
```

- [ ] **Paso 4: Levantar el dev server**

```bash
npx wrangler dev
```

Abrir `http://localhost:8787`, poner el PIN `1234`, ir a la pestaña Servicios.

Al entrar, `generarDelMes()` crea solos los gastos de agosto: Netflix nace `'pagado'`
(es automático), y Expensas, Agua y Edenor nacen `'pendiente'`.

**Estado esperado antes de tocar nada:**

| Servicio | Mes | Estado |
|---|---|---|
| Netflix | 2026-08 | pagado (automático) |
| Expensas | 2026-08 | pendiente |
| Agua | 2026-08 | pendiente |
| Edenor | 2026-08 | pendiente |
| Edenor | 2026-07 | pendiente (vencido, aparece arriba de todo) |

Total fijo mensual arriba: **$134.200** (`automáticos $8.500 · los pagás vos $125.700`).

> **Nota de Windows:** si un comando de `wrangler` falla con `EBUSY`, es un dev server viejo
> que quedó huérfano, no el comando. Matar el proceso `workerd` y reintentar.

---

## Task 1: Tag "pagado" en los servicios manuales

**Files:**
- Modify: `public/index.html:62` (CSS, agregar una regla)
- Modify: `public/index.html:456-473` (función `filaMes`)

**Interfaces:**
- Consumes: `filaMes(s)`, la variable `mv` (el `mov` del mes para ese servicio), `esc()`, `nombreCuenta()`, `fmt()` — todas ya existentes.
- Produces: nada que consuman otros tasks. El Task 2 es independiente.

- [ ] **Paso 1: Agregar la regla CSS**

Después de la línea 62 (`.tag.venc{...}`), agregar:

```css
  .tag.pago{background:#E6F0EE; color:var(--accent)}
```

Mismo fondo y color que `.tag.fijo`, que es el verde de acciones. Se declara aparte en vez
de reusar `.fijo` porque son dos significados distintos: uno marca "esto es un gasto fijo",
el otro "esto ya se pagó".

- [ ] **Paso 2: Reescribir el armado de la fila en `filaMes`**

Reemplazar este bloque (líneas 462-472, desde `const vencidoEsteMes` hasta el `return`):

```js
    const vencidoEsteMes = mv.estado === "pendiente" && mv.fecha <= hoyISO();
    const estado = mv.estado === "pagado" ? "pagado"
      : mv.estado === "omitido" ? "salteado este mes"
      : vencidoEsteMes ? "venció el " + mv.fecha.slice(8) + "/" + mv.fecha.slice(5,7)
      : "vence " + mv.fecha.slice(8);
    return `<div class="row${mv.estado === "omitido" ? " off" : ""}">
      <div class="name">${esc(s.nombre)}${vencidoEsteMes ? `<span class="tag venc">vencido</span>` : ""}
        <span class="sub">${esc(nombreCuenta(s.cuenta_id))} · ${estado}</span></div>
      <div class="val mono">${fmt(mv.monto)}</div>
      ${mv.estado === "pendiente" ? `<button class="pay" data-pay="${mv.id}">Pagar</button>` : ""}
      <button class="del" data-off="${s.id}">baja</button></div>`;
```

por:

```js
    const vencidoEsteMes = mv.estado === "pendiente" && mv.fecha <= hoyISO();
    const pagado = mv.estado === "pagado";
    // Cuando está pagado el tag ya lo dice: repetirlo en el sub sería decir dos veces
    // lo mismo en la fila más angosta de la app.
    const estado = mv.estado === "omitido" ? "salteado este mes"
      : vencidoEsteMes ? "venció el " + mv.fecha.slice(8) + "/" + mv.fecha.slice(5,7)
      : "vence " + mv.fecha.slice(8);
    const sub = pagado ? esc(nombreCuenta(s.cuenta_id))
      : `${esc(nombreCuenta(s.cuenta_id))} · ${estado}`;
    return `<div class="row${mv.estado === "omitido" ? " off" : ""}">
      <div class="name">${esc(s.nombre)}${vencidoEsteMes ? `<span class="tag venc">vencido</span>` : ""}${pagado ? `<span class="tag pago">pagado</span>` : ""}
        <span class="sub">${sub}</span></div>
      <div class="val mono">${fmt(mv.monto)}</div>
      ${mv.estado === "pendiente" ? `<button class="pay" data-pay="${mv.id}">Pagar</button>` : ""}
      <button class="del" data-off="${s.id}">baja</button></div>`;
```

`pagado` y `vencidoEsteMes` no pueden ser verdaderos a la vez — `vencidoEsteMes` exige
`estado === "pendiente"` — así que nunca salen los dos tags juntos.

- [ ] **Paso 3: Verificar en el navegador**

Con el dev server andando, en la pestaña Servicios:

1. Refrescar. Ninguno de los tres manuales de agosto muestra tag "pagado" todavía.
2. Apretar **Pagar** en Agua, confirmar el monto `12300`.
3. La fila de Agua ahora muestra el tag verde `pagado` al lado del nombre.
4. La línea gris de Agua dice solo `Efectivo` — **no** `Efectivo · pagado`.
5. La fila de Agua ya no tiene botón "Pagar".
6. Expensas y Edenor siguen sin tag, con su botón y su fecha de vencimiento.
7. El Edenor de julio sigue arriba con su tag rojo `vencido`.
8. Netflix (automático) no muestra ningún tag: está en la lista de arriba, que no pasa por `filaMes`.

- [ ] **Paso 4: Verificar el caso "omitido"**

El estado `omitido` no se produce desde esta pantalla: el botón **baja** da de baja el
servicio entero. Se produce borrando el gasto generado desde la pestaña Mes, que lo marca
`omitido` en vez de eliminarlo.

1. Ir a la pestaña Mes, encontrar el gasto de Expensas de agosto, borrarlo.
2. Volver a Servicios: la fila de Expensas está al 50% de opacidad y dice `Efectivo · salteado este mes`, sin tag.

- [ ] **Paso 5: Commit**

```bash
git add public/index.html
git commit -m "feat: tag pagado en los servicios manuales saldados"
```

---

## Task 2: Línea "Falta pagar"

**Files:**
- Modify: `public/index.html:169` (HTML, agregar un div en la tarjeta de gasto fijo)
- Modify: `public/index.html:70` (CSS, agregar reglas de `.falta`)
- Modify: `public/index.html:433-436` (función `renderServicios`)

**Interfaces:**
- Consumes: el array global `movs`, `fmt()`, `$()` — todos ya existentes.
- Produces: nada que consuman otros tasks.

- [ ] **Paso 1: Agregar el contenedor en el HTML**

En la sección `#v-serv`, después de la línea 169 (`<p class="hint" id="fijodet"></p>`),
dentro de la misma `<div class="card">`:

```html
      <div class="falta" id="faltapagar" hidden></div>
```

Queda así:

```html
    <div class="card">
      <div class="total"><div class="big mono" id="fijototal">$0</div></div>
      <p class="hint" id="fijodet"></p>
      <div class="falta" id="faltapagar" hidden></div>
    </div>
```

- [ ] **Paso 2: Agregar el CSS**

Después de la línea 70 (`.total .big{...}`), agregar:

```css
  .falta{display:flex; align-items:baseline; justify-content:space-between; gap:10px;
    margin-top:12px; padding-top:12px; border-top:1px solid var(--line)}
  .falta .rot{font-size:13px; color:var(--muted)}
  .falta .val{font-size:19px; font-weight:700; color:var(--ink)}
```

Nada de `--danger`: los atrasados ya tienen su tag rojo, y teñir el total de rojo haría
sonar alarma el día 2 del mes, cuando todavía no venció nada.

- [ ] **Paso 3: Calcular y pintar el total en `renderServicios`**

Después de la asignación de `$("fijodet").textContent` (línea 434-436), agregar:

```js
  // Solo los manuales generan pendientes: estadoInicial hace nacer 'pagado' a los
  // automáticos. Así que todo mov 'pendiente' ya es un manual sin pagar, y no hace falta
  // cruzar contra la tabla servicio. Incluye los vencidos arrastrados de meses anteriores
  // y los de servicios dados de baja: es la plata que falta que salga de verdad.
  const falta = movs.filter(m => m.estado === "pendiente")
                    .reduce((a, m) => a + m.monto, 0);
  $("faltapagar").hidden = falta === 0;
  $("faltapagar").innerHTML = `<span class="rot">Falta pagar</span><span class="val mono">${fmt(falta)}</span>`;
```

- [ ] **Paso 4: Verificar el número contra la pantalla**

Con el dev server andando, en la pestaña Servicios. Si venís del Task 1, ya pagaste Agua y
omitiste Expensas; volvé a un estado limpio con estos dos comandos y refrescá:

```bash
npx wrangler d1 execute gastos --local --command "DELETE FROM mov;"
npx wrangler d1 execute gastos --local --file=./seed-local.sql
```

Los dos hacen falta: el `DELETE` borra los movs de agosto y `generarDelMes()` los vuelve a
crear solo al refrescar, pero el pendiente de julio no se regenera — `generarDelMes()` solo
toca el mes corriente. Sin el segundo comando te falta el vencido y el total da $125.700.

1. Refrescar. La línea dice **Falta pagar $144.100** — que es Expensas 95.000 + Agua 12.300 + Edenor agosto 18.400 + Edenor julio 18.400.
2. Sumar a mano los montos de todas las filas que tienen botón "Pagar" en pantalla, incluido el vencido de arriba. Tiene que dar el mismo número.
3. El total grande de arriba sigue diciendo $134.200: es otra cosa (el gasto fijo del mes, con los automáticos adentro y sin los arrastrados).

- [ ] **Paso 5: Verificar que baja al pagar, sin recargar**

1. Apretar **Pagar** en Agua, confirmar `12300`.
2. Sin tocar F5, la línea pasa a **Falta pagar $131.800**.

Esto funciona porque `confirmarPago()` ya llama a `renderServicios()` — no hay que tocar
nada ahí.

- [ ] **Paso 6: Verificar el caso vacío**

1. Pagar los tres que quedan (Expensas, Edenor de agosto, Edenor de julio).
2. La línea "Falta pagar" **desaparece** — no muestra $0.
3. La tarjeta de arriba vuelve a verse como antes de esta feature.

- [ ] **Paso 7: Commit**

```bash
git add public/index.html
git commit -m "feat: total de servicios que faltan pagar"
```

---

## Cierre

- [ ] **Paso 1: Limpiar el entorno de prueba**

```bash
rm seed-local.sql
```

`.dev.vars` puede quedar: ya está en `.gitignore` y sirve para la próxima.

- [ ] **Paso 2: Confirmar que no quedó nada suelto**

```bash
git status --short
```

Tiene que estar limpio. Si aparece `seed-local.sql` o `.dev.vars`, no commitearlos.

- [ ] **Paso 3: Actualizar el CLAUDE.md**

En la sección "Reglas de negocio que no son obvias", agregar:

```markdown
- **El total "falta pagar" de la pestaña Servicios no filtra por servicio.** Solo los
  manuales generan pendientes, así que todo `mov` en estado `'pendiente'` ya es un manual
  sin pagar. Incluye los arrastrados de meses anteriores, a diferencia del "Total a vencer"
  de la pestaña Mes, que suma solo el mes corriente. Los dos números difieren cuando hay
  atrasados, y está bien: responden preguntas distintas.
```

Commit:

```bash
git add CLAUDE.md
git commit -m "docs: total de servicios pendientes"
```
