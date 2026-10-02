# Presupuesto familiar: cascada de la plata y presupuesto personal

Fecha: 2026-10-02

## Problema

Nico y Dani están reorganizando las finanzas de la casa. El objetivo no es medir mejor los
gastos: es que **una vez cubierto lo familiar, cada uno tenga un monto propio y decida solo
en qué gastarlo, sin rendir cuentas.** El control de gastos es el medio; evitar la discusión
sobre en qué se gasta es el fin.

La app hoy responde *"cuánto gastamos este mes"*. No responde las dos preguntas que importan
ahora: *"cuánto queda"* y *"cuánto de eso es mío"*.

Hay además un problema concreto de caja. Los números de octubre de 2026:

| | |
|---|---:|
| Sueldo | 1.500.000 |
| Depto 1 | 950.000 |
| Depto 2 | 900.000 |
| **Ingresos** | **3.350.000** |
| − Resumen de tarjeta | −1.700.000 |
| − Cuota de escritura | −500.000 |
| **Queda para todo lo familiar** | **1.150.000** |

Con un tope de supermercado de 600.000, sobran 550.000 para auto, servicios, hogar y salud.
**El presupuesto personal de octubre va a dar negativo, y mostrarlo es exactamente el punto**:
es un número que nunca tuvieron a la vista.

Dos datos de contexto que condicionan el diseño:

- **La tarjeta es un problema a desarmar, no un dato fijo.** Los 1.700.000 son de este mes;
  la intención es reducir la tarjeta a unas pocas cosas. El diseño tiene que ayudar a bajarla,
  no a convivir con ella.
- **Hay ingresos y compromisos que no se pueden dar por sentados.** El millón de viáticos no
  se cobró y no se sabe cuándo; los 500 USD de la deuda de Mendoza no se van a pagar este mes
  aunque el compromiso siga vigente hasta febrero de 2027.

## Decisiones tomadas

### Sobre el número personal

- **Fijo el día 1, no vivo.** La app calcula `ingresos − determinado − topes` y dice el número
  de cada uno desde el primer día del mes. El tope de una categoría se reserva completo aunque
  no se haya gastado nada: el día 20, con 400.000 de 600.000 de super consumidos, el tope sigue
  reservado en 600.000 y los 200.000 que sobran no se reparten hasta que el mes cierre. Un
  número que se mueve según lo que el otro cargó ayer no sirve para dejar de discutir, y es lo
  que daría un cálculo sobre lo gastado.
- **Reparto 50/50, no configurable.** "Cada uno queda con un presupuesto igual".
- **El mes puede dar negativo, y se muestra negativo.** Si falta plata, la app dice *"faltan
  170.000"*, no *"cada uno tiene 0"*. El número negativo es accionable: o se baja un tope, o el
  mes se cubre con tarjeta y se paga el que viene. Un cero piadoso esconde justo lo que hay que
  ver.

### Sobre los dos relojes (la decisión central)

Una compra de supermercado con tarjeta el 5 de octubre vive en dos meses: **se decide en
octubre** pero **la plata sale en noviembre**. La app cuenta las dos cosas:

- **Los topes se miden por fecha de compra**, sin importar el medio de pago. Así el
  recordatorio suena cuando se está decidiendo, en la caja del super, y no 40 días después.
- **El resumen de la tarjeta se resta en el mes en que se paga.**

Esto significa que, durante la transición, un mes carga el supermercado de agosto (dentro del
resumen) y reserva el de octubre (dentro del tope) a la vez. **No es doble conteo: es
literalmente lo que pasa cuando se vive con la tarjeta** — se paga el pasado y se compromete el
presente en el mismo mes. La app va a ser deliberadamente pesimista mientras dure, y ese
pesimismo es el mecanismo: a medida que baja el uso de tarjeta, el resumen se encoge solo, la
doble carga desaparece y el presupuesto personal aparece. La cascada se destraba sin tocar nada
y el progreso se ve mes a mes.

Las dos alternativas se descartaron: medir los topes por mes de impacto cuadra con el banco pero
rompe el recordatorio (se podría gastar un millón de super el 21 de octubre y la app diría que en
octubre se consumió cero); restar solo la deuda vieja y no el resumen completo da un número más
estable y más generoso, pero miente sobre la plata que hay en la cuenta.

### Sobre la regla de los topes

> **Si una categoría tiene tope, se reserva el tope completo y todo lo de esa categoría lo
> consume — servicios incluidos.**
> **Si no tiene tope, se resta lo determinado de esa categoría, tal cual.**

Una sola regla que resuelve los tres casos que parecían excepciones:

- **Auto mezcla determinado y discrecional** (seguro y patente son servicios mensuales; nafta y
  mantenimiento son discrecionales). No hay que separarlos: con tope 300.000, el seguro de
  100.000 consume un tercio el día 1 solo y quedan 200.000 para nafta. Una sola barra, que es
  como lo piensan ellos.
- **La escritura es un pago único de 500.000.** Va en una categoría sin tope, así que se resta
  entera sin tener que inventarle un tope de 500.000 a un pago de un solo mes.
- **Servicios no lleva tope**, por decisión explícita: la línea dice cuánto se está pagando de
  luz, gas e internet, y no se le pone un límite a algo cuyo monto deciden otros.

**La barra de un tope mide plata comprometida, no plata que salió.** Es una diferencia con el
total del mes, que sí mide plata que salió, y hay que tenerla clara porque los dos números van
a estar en la misma pantalla:

- Un gasto **`pendiente`** (un servicio manual sin pagar, el seguro del auto que vence el 28)
  **sí consume el tope**. Ya está comprometido: la plata se va a ir, y el tope existe para que no
  se prometa dos veces. Esto es distinto de lo que hace el total del mes, que deja los pendientes
  afuera.
- Un gasto **`omitido`** **no consume el tope**. Se salteó a propósito, esa plata no sale.

Si la barra dejara los pendientes afuera, el día 1 el tope de Auto se vería vacío aunque el
seguro ya esté comprometido, y daría permiso para gastar en nafta una plata que no está.

**Una compra en cuotas consume el tope completo en el mes de compra, no de a una cuota.** Una
heladera de 1.200.000 en 12 cuotas consume 1.200.000 del tope de Hogar en octubre, y la barra va a
decir que se pasaron por mucho. Es a propósito, por tres razones: el tope limita lo que se *decide*
gastar en el mes, y en 12 cuotas se decidió gastar 1.200.000; es lo que la app ya hace con el
límite de financiación de la tarjeta; y financiar en cuotas no tiene que sentirse gratis este mes,
que es justamente el hábito que están tratando de cortar.

### Sobre qué no se resta dos veces

- **Un servicio pagado con tarjeta ya está dentro del resumen** y no se resta como línea aparte.
  Es la regla que la app ya tiene para el pago del resumen, aplicada a los servicios.
- **El resumen lo calcula la app, no se carga a mano.** Sale de `impactos()`, que ya sabe en qué
  resumen cae cada cuota.
- **La línea de tarjeta incluye `base_pago` pero no `base_cuotas`.** `base_pago` es lo que se debía
  en un pago antes de la app, y entra entero en el primer resumen que todavía no está pagado.
  `base_cuotas` son cuotas viejas corriendo cuyo cronograma la app **no conoce**: no hay forma de
  saber cuánto de eso cae en octubre y cuánto en diciembre, así que repartirlo sería inventar.
  Queda afuera.
- **Consecuencia práctica, y hay que decirla porque afecta los primeros meses:** mientras haya
  `base_cuotas` sin desglosar, la línea de tarjeta de la cascada va a ser **más baja que el resumen
  real**, y el presupuesto personal va a salir más optimista de lo que es. La salida no es código:
  es cargar las compras viejas de la tarjeta que todavía tienen cuotas pendientes como `mov` reales
  con su cantidad de cuotas, y poner `base_cuotas` en cero. Ahí la app calcula todo y la línea
  cuadra con el banco. Conviene hacerlo junto con la migración.

### Sobre el modelo

- **Los compromisos no son una tabla nueva: son servicios con fecha de fin.** Un compromiso
  necesita nombre, monto, día del mes, desde cuándo y hasta cuándo. `servicio` ya tiene todo
  menos lo último. Un pago único es un servicio que dura un mes, y saltear un mes porque no se
  llegó es el estado `omitido` que ya existe. Cero maquinaria nueva.
- **Los ingresos van en una tabla aparte, no en una columna `tipo` de `mov`.** Esto contradice a
  propósito lo que dice el `CLAUDE.md` actual. Con tabla aparte, `mov` sigue significando
  exactamente *plata que sale* y ninguna de las consultas que hoy funcionan necesita un filtro
  nuevo. Con una columna `tipo`, cada total pasa a necesitar un `WHERE` extra y el día que se
  olvide uno los números se inflan sin avisar.
- **Un ingreso eventual es un ingreso con `desde = hasta`.** El mismo mecanismo cubre el sueldo
  de todos los meses y el millón de viáticos que se cobra una vez. Un ingreso que no se sabe
  cuándo cae simplemente no se carga: la cascada nunca cuenta plata que no existe.
- **`mov.ambito` para el gasto personal, no reusar `quien`.** Hoy `quien` significa *quién lo
  cargó*, para pintar la fila de azul o rosa — un gasto familiar también tiene `quien`. Son dos
  ejes distintos, igual que categoría y persona. Mezclarlos es el error que tenía la planilla
  vieja.
- **Los topes no tienen historial.** Un solo monto vigente por categoría. Mirar un mes pasado lo
  calcula con los topes de hoy. YAGNI explícito: agregar historial es una columna `desde` y una
  consulta más complicada, y todavía no hace falta.

### Sobre la bandeja de entrada

- **Un gasto familiar sin categoría, o en una categoría sin tope, cae en una línea "Sin tope".**
  Sin esa línea sería plata que salió y que no aparece en ninguna parte de la cascada.
- **Esa línea es una bandeja de entrada, no solo una red de seguridad.** Se carga el gasto en 4
  taps sin elegir categoría y se clasifica después con tiempo. Refuerza la convención de que
  cargar tiene que ser rápido, en vez de pelearse con ella.
- Requiere un `PATCH /api/movs/:id` nuevo, **acotado a `cat` y `ambito`**. No es "editar un
  gasto" completo: el monto, la fecha y la descripción siguen sin poder editarse.

### Sobre dónde vive el cálculo

- **El cálculo vive en el frontend**, en un módulo servido desde `public/`. No en el Worker. El
  guardado de un gasto no recarga el estado: mete la fila en el array local y re-renderiza
  (`index.html:647`), y es a propósito, porque eso hace que cargar sea instantáneo. El
  recordatorio tiene que salir en ese momento, sin ida y vuelta al servidor.
- **Tiene que estar en `public/` y no en `src/`** porque el `[assets]` de Cloudflare solo sirve
  esa carpeta: un módulo en `src/` el navegador no lo puede pedir. Desde ahí los tests lo
  importan igual que importan `servicios.mjs` hoy.
- **Rompe la convención de "la app entera en un archivo", a propósito.** En `index.html` queda
  todo el HTML, el CSS y el renderizado; sale solo la aritmética pura. Es el mismo criterio con
  el que ya se sacaron `servicios.mjs` y `tarjetas.mjs` del Worker. La convención existía para
  que la app sea simple de leer, no para dejar sin test la función que decide cómo se reparte la
  plata entre los dos.

## Comportamiento

### La cascada

```
  Ingresos del mes
− Resumen de tarjeta que se paga este mes
− Servicios y compromisos de categorías sin tope
− Suma de los topes
  ─────────────────────────────────────────
= Queda para dividir     ÷ 2
```

Con los números de octubre y topes de ejemplo:

| | |
|---|---:|
| Ingresos | 3.350.000 |
| − Resumen de tarjeta | −1.700.000 |
| − Deudas *(la cuota de escritura)* | −500.000 |
| − Servicios *(lo que se paga, sin tope)* | −190.000 |
| − Topes (super 600 · auto 300 · hogar 150 · salud 80) | −1.130.000 |
| **Queda para dividir** | **−170.000** |

**Hay una línea por categoría sin tope, nombrada por la categoría**, y se despliega para ver qué
servicios la componen. No una línea por compromiso: con tres deudas chicas la cascada se volvería
una lista.

Eso obliga a **agregar `"Deudas"` a `CATS`**. Hoy no hay dónde poner la cuota de escritura ni la de
Mendoza: "Impuestos" no es, y "Otros" haría que la línea más grande de la cascada se llame "Otros".

### La pestaña Mes

```
            ◀   octubre 2026   ▶

              − 170.000
       faltan 170.000 para cubrir el mes
              gastado: 890.000

  Ingresos                      3.350.000     ▾
  Tarjeta                      −1.700.000
  Deudas                         −500.000     ▾
  Servicios                      −190.000     ▾
  Topes                        −1.130.000

  ── TOPES ──────────────────────────────
  Supermercado  ████████░░░░   420.000 / 600.000
  Auto          ███░░░░░░░░░   110.000 / 300.000
  Hogar         ████████████   165.000 / 150.000  ⚠
  Salud         ██░░░░░░░░░░    20.000 /  80.000

  ── SIN TOPE ·  3 gastos ───────────────
  bazar                 12.000      → asignar
  farmacia               8.500      → asignar
  regalo cumple         30.000      → asignar

  ── CADA UNO ───────────────────────────
  Nico    cargó 40.000
  Dani    cargó 15.000

  ── VENCEN ESTE MES ────────────────────
  (lo que ya existe hoy)
```

- **El número grande pasa a ser "queda para dividir"**, que es el que buscan. Lo gastado baja a
  línea chica. Es una pérdida consciente: hoy el número grande es lo gastado.
- **Las barras de tope son un bloque nuevo.** Hoy no hay ningún desglose por categoría: el bloque
  `#pormedio` que está abajo del total desglosa **por medio de pago** (`porC[f.m.cuenta_id]`,
  `index.html:391`), y mide contra el total del mes. Ese bloque se queda como está — dice cuánto
  está cargando cada tarjeta, que es otra pregunta útil.
- Los bloques "Movimientos", "Vencen este mes" y "Ya comprometido en cuotas" tampoco cambian.
- **Tocar una barra edita ese tope ahí mismo.** Es el lugar donde uno se da cuenta de que el tope
  está mal, no una pantalla de configuración.
- Cuando el mes da positivo, el bloque "cada uno" dice `Nico: te quedan 172.000 de 212.500` en
  lugar de solo lo cargado. En el ejemplo de arriba el mes da negativo, así que solo puede mostrar
  lo cargado: no hay presupuesto personal del cual descontar.
- "Vencen este mes" no cambia: sigue usando la fecha de vencimiento del gasto, no el mes que le
  asigna `impactos()`.

### El recordatorio

Dos momentos, y ninguno agrega un tap:

**Mientras se elige la categoría**, abajo del selector, en chico: `Supermercado · quedan 180.000`.

**Al guardar**, el toast que ya existe cambia de texto:

```
Guardado · Supermercado: quedan 155.000
Guardado · Hogar: te pasaste 15.000      ⚠
```

Nunca bloquea ni pide confirmación. Es un recordatorio, no un guardia. Si la categoría no tiene
tope, el toast dice "Guardado" como hoy.

### El gasto personal

El gasto personal **no hace falta cargarlo**: cada uno hace lo que quiera con su parte y no tiene
que quedar registrado. Pero si alguien quiere registrarlo, se puede, y en el bloque secundario
"cada uno" ve cuánto le queda.

Al lado del selector de Nico/Dani que ya existe, un toggle chico **"personal"**, apagado por
defecto. Un gasto personal **no suma a ningún total familiar y no consume ningún tope**. Los 4
taps de un gasto familiar siguen siendo 4.

### Dónde se configura

Los compromisos ya viven en **Servicios** (son servicios con `hasta`). Los ingresos y los topes
van en una pestaña nueva:

```
Cargar  ·  Mes  ·  Plan  ·  Servicios  ·  Medios
```

Cinco botones, que entran en un celular de 360px con el CSS actual (`nav button` es `flex:1`).

## Modelo de datos

```sql
-- compromisos = servicios con fecha de fin
ALTER TABLE servicio ADD COLUMN hasta TEXT;   -- YYYY-MM, NULL = sin fin

-- gasto personal opcional
ALTER TABLE mov ADD COLUMN ambito TEXT;       -- 'personal' | NULL = familiar

CREATE TABLE ingreso (
  id      TEXT PRIMARY KEY,
  nombre  TEXT NOT NULL,
  monto   INTEGER NOT NULL,
  dia     INTEGER,                -- día del mes que entra
  desde   TEXT NOT NULL,          -- YYYY-MM, primer mes que cuenta
  hasta   TEXT,                   -- YYYY-MM, último mes; NULL = sin fin
  activo  INTEGER NOT NULL DEFAULT 1,
  creado  TEXT NOT NULL
);

CREATE TABLE tope (
  cat   TEXT PRIMARY KEY,         -- una categoría de CATS
  monto INTEGER NOT NULL
);
```

**Sin fila en `tope` = sin tope.** Así Servicios, Ropa, Educación y Viajes quedan fuera del
reparto sin necesidad de ningún flag.

Ejemplos de cómo quedan los datos reales:

| tabla | fila | qué es |
|---|---|---|
| `ingreso` | Sueldo, 1.500.000, desde 2026-10, hasta NULL | todos los meses |
| `ingreso` | Viáticos, 1.000.000, desde 2026-11, hasta 2026-11 | solo ese mes |
| `servicio` | Netflix, hasta NULL | servicio de siempre |
| `servicio` | Deuda Mendoza, desde 2026-08, hasta 2027-02 | se termina en febrero |
| `servicio` | Escritura, desde 2026-10, hasta 2026-10 | pago único |

`generarDelMes()` tiene que dejar de generar gastos pasado el `hasta`.

**`activo` y `hasta` no son lo mismo, y los dos hacen falta** (en `ingreso` igual que en
`servicio`): `hasta` es un final previsto desde el alta — la deuda de Mendoza son siete cuotas y
se sabe. `activo = 0` es una baja decidida en el camino, que no estaba en el plan. Mezclarlos
obligaría a reescribir el `hasta` para dar algo de baja y se perdería el dato de hasta cuándo
tenía que durar.

Y en `CATS`: entra `"Deudas"`, para que las cuotas de escritura y de Mendoza tengan dónde ir.

## Arquitectura

```
public/calculo.mjs      lógica pura: impactos, consumos, cascada
public/index.html       <script type="module"> + import "./calculo.mjs"
src/calculo.test.mjs    importa ../public/calculo.mjs, corre con node --test
```

```js
impactos(mov, cuenta)                  // en qué resumen cae cada cuota (se muda de index.html)
consumos(movs, cuentas, mes)           // consumido por categoría, por fecha de compra
cascada({movs, cuentas, ingresos, servicios, topes}, mes)   // las líneas del mes
```

Las tres son puras: no tocan el DOM ni la red. El Worker no importa el módulo — sigue devolviendo
filas crudas y `generarDelMes()` no cambia salvo por respetar `hasta`.

Pasar `index.html` a `<script type="module">` es seguro: tiene **un solo bloque `<script>` y cero
handlers inline**, verificado, así que nada depende de que las funciones queden en `window`. No
hay service worker, así que un archivo más servido no tiene caché que invalidar.

### API

- `GET /api/state` — agrega `ingresos` y `topes` a lo que ya devuelve.
- `POST /api/ingresos`, `PATCH /api/ingresos/:id`, `DELETE /api/ingresos/:id`
- `PUT /api/topes/:cat` — crea o actualiza; `DELETE /api/topes/:cat` saca el tope.
- `PATCH /api/movs/:id` — **nuevo**, acotado a `cat` y `ambito`.
- `PATCH /api/servicios/:id` — acepta `hasta`.

## Migración

`migracion-presupuesto.sql`:

1. `ALTER TABLE servicio ADD COLUMN hasta TEXT`
2. `ALTER TABLE mov ADD COLUMN ambito TEXT`
3. `CREATE TABLE ingreso`
4. `CREATE TABLE tope`
5. `UPDATE mov SET cat = 'Auto' WHERE cat = 'Nafta'` — son 2 filas, verificado contra
   `backup-pre-limites.sql`

Y en `CATS` de `index.html`: sale `"Nafta"` (la absorbe Auto, que ahora incluye nafta, seguro,
mantenimiento y patente), entran `"Viajes"` y `"Deudas"` (ninguna existe hoy).

Hacer un backup antes, como en las migraciones anteriores.

## Fuera de alcance

- **Editar el monto, la fecha o la descripción de un gasto.** Solo se puede reclasificar (`cat`,
  `ambito`). Lo demás sigue en pendientes.
- **Multi-moneda.** La deuda de Mendoza son 500 USD, pero se carga en pesos y se ajusta a mano
  cuando se mueve el dólar. Guardar una cotización es una tabla y una pantalla más para cuatro
  pagos que terminan en febrero de 2027.
- **Reparto distinto a 50/50.**
- **Historial de topes.** Un mes pasado se calcula con los topes de hoy.
- **Que el sobrante de un tope se reparta.** Si se gastó menos que el tope, la diferencia queda
  sin repartir; verla como bonus a fin de mes es otra feature.
- Reactivar un servicio dado de baja, e importar el resumen de la tarjeta. Siguen pendientes.

## Tests

En `src/calculo.test.mjs`, con `node --test` desde la raíz.

### `impactos()` — los cuatro casos que hoy el `CLAUDE.md` pide verificar a mano

- compra el día 4 con cierre 20 → resumen del mes siguiente
- compra el día 25 con cierre 20 → dos meses después
- 12 cuotas desde diciembre terminan en enero del año +2
- la suma de las cuotas da exactamente el total (la última absorbe el redondeo)

### `consumos()`

- un gasto de crédito consume el tope del mes de compra, no del mes de impacto
- una compra en 12 cuotas consume el tope completo en el mes de compra, no una cuota
- un gasto sin categoría no consume ningún tope
- un gasto personal no consume ningún tope
- un gasto `pendiente` **sí** consume tope (está comprometido), al contrario del total del mes
- un gasto `omitido` no consume tope
- un gasto generado por un servicio consume el tope de su categoría

### `cascada()`

- un servicio pagado con tarjeta no se resta dos veces
- la línea de tarjeta suma `base_pago` si el resumen del mes no está pagado, y nunca `base_cuotas`
- el tope de una categoría consume los servicios de esa categoría
- una categoría sin tope resta lo determinado tal cual
- un gasto familiar sin categoría cae en "sin tope" y no desaparece
- un gasto personal no toca ningún total familiar
- un ingreso con `desde = hasta` cuenta solo en ese mes
- un ingreso con `hasta = NULL` cuenta en todos los meses desde `desde`
- un compromiso `omitido` no se resta ese mes
- un compromiso pasado su `hasta` no se resta
- el mes puede dar negativo
- el reparto es la mitad exacta, y el redondeo no hace aparecer ni desaparecer un peso

## Documentación a actualizar

En `CLAUDE.md`:

- La estructura de archivos: `public/calculo.mjs` y `src/calculo.test.mjs`.
- Sacar la nota de verificar `impactos()` a mano — pasa a tener tests.
- Sacar "No hay ingresos. Solo gastos, a propósito", y explicar por qué los ingresos van en tabla
  aparte y no como `tipo` en `mov`.
- Corregir "la app entera en un archivo": la aritmética pura vive en `public/calculo.mjs`.
- Agregar la regla de los topes, la de los dos relojes y la del reparto fijo del día 1.
- Agregar que un compromiso es un servicio con `hasta`.
- Marcar `migracion-presupuesto.sql` como aplicada cuando se aplique.

En `README.md`: ya está atrasado (dice "las tres tablas", no menciona `migracion-limites.sql`).
Actualizarlo de paso.
