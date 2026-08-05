# Límites de tarjeta y edición de medios de pago

Fecha: 2026-08-05

## Problema

Dos huecos en la pestaña Medios:

1. **El cierre y el vencimiento de una tarjeta no se pueden corregir.** Se fijan al crear el
   medio de pago y después no hay forma de cambiarlos desde la app. Los bancos los cambian,
   y un cierre mal cargado desplaza todos los gastos de esa tarjeta al resumen equivocado,
   porque `impactos()` depende de ese número.
2. **No hay forma de saber cuánto límite queda.** Hoy hay que entrar al homebanking. La app
   ya conoce casi todos los gastos, así que puede decirlo sola.

## Decisiones tomadas

- El "usado" **se calcula al renderizar**, no se guarda como contador. Un contador
  almacenado se desincroniza apenas se borra o edita un gasto, y después no hay manera de
  saber cuál de los dos números miente. Es la misma decisión que ya tomó el proyecto con
  `impactos()` y con los totales de servicios.
- Hay **dos límites separados**: un pago y cuotas. Son los que dan los bancos acá.
- Como las tarjetas ya vienen con historia que la app no conoce, cada límite tiene una
  **base manual**: lo que ya se debía al empezar a usar esto. El usado es esa base más lo
  que la app sabe.
- El botón **"pagué el resumen"** libera el límite de un pago. No se intenta adivinar
  cuándo se paga.
- **Importar o leer el resumen de la tarjeta queda fuera.** Es un proyecto propio, ya
  anotado en los pendientes del `CLAUDE.md`. Cuando exista, la base manual deja de hacer
  falta: esta feature es el escalón intermedio.

## Modelo de datos

Cinco columnas nuevas en `cuenta`, todas con sentido solo para `tipo = 'credito'`:

```sql
limite_pago   REAL,             -- tope en un pago que da el banco
limite_cuotas REAL,             -- tope en cuotas que da el banco
base_pago     REAL NOT NULL DEFAULT 0,   -- lo que ya se debía en un pago al empezar
base_cuotas   REAL NOT NULL DEFAULT 0,   -- ídem en cuotas
pagado_hasta  TEXT              -- YYYY-MM del último resumen pagado; NULL = ninguno
```

Los límites son nullable a propósito: `NULL` significa "todavía no lo cargué", que es
distinto de cero.

## Cálculo

Una sola regla, igual para los dos límites: **un gasto ocupa límite hasta que su resumen
esté pagado.** `impactos()` ya sabe en qué resumen cae cada compra y cada cuota, así que:

```
usado_pago   = base_pago   + Σ impactos con de === 1 y mes > pagado_hasta
usado_cuotas = base_cuotas + Σ impactos con de  >  1 y mes > pagado_hasta
```

Sobre movimientos de esa cuenta únicamente, y filtrando antes con el helper `sumaAlTotal`
que ya existe: un gasto de servicio en estado `pendiente` u `omitido` no llegó a la tarjeta,
así que no ocupa límite.

`pagado_hasta` en `NULL` se compara como cadena vacía, con lo cual todo resumen es
posterior y todo cuenta. Es el comportamiento correcto para una tarjeta cuyo resumen nunca
se marcó como pagado.

## "Pagué el resumen"

Hace dos cosas:

1. Avanza `pagado_hasta` al mes del resumen que se acaba de pagar.
2. Pone `base_pago` en cero.

Lo segundo es la clave: todo lo que se debía en un pago entró en ese resumen y quedó
saldado, así que de ahí en más el número sale solo de los gastos cargados. Es el momento en
que la app deja de depender de lo que se escribió a mano.

`base_cuotas` **no** se pone en cero, porque las cuotas viejas siguen corriendo varios meses
más y la app no conoce su cronograma. Queda editable, con un texto en el formulario que
aclara que conviene bajarla cuando se vea desactualizada.

### Qué mes se guarda

Tocar el botón significa "pagué el resumen que cerró último". Hay que traducir eso al mes
que `impactos()` le asigna a ese resumen, y no es evidente:

```
mes_resumen_cerrado = mes actual + (hoy <= cierre ? 0 : 1)
```

Con cierre 20: si hoy es 5 de agosto, el último resumen cerró el 20 de julio y contiene
compras del 21 de junio al 20 de julio. Una compra del 10 de julio cae, según `impactos()`,
en el resumen de **agosto** — así que ese resumen es "agosto" y `pagado_hasta` queda en
`2026-08`. Si en cambio hoy es 25 de agosto, el último resumen cerró el 20 de agosto y es
el de **septiembre**.

Equivocarse acá por un mes libera de más o de menos, así que conviene verificar los dos
casos.

## API

| Método | Ruta                              | Qué hace |
|--------|-----------------------------------|----------|
| PATCH  | `/api/cuentas/:id`                | Edita `nombre`, `cierre`, `venc`, los dos límites y las dos bases. Devuelve la cuenta actualizada |
| POST   | `/api/cuentas/:id/resumen-pagado` | Avanza `pagado_hasta` y pone `base_pago` en 0. Devuelve la cuenta actualizada |

`PATCH /api/cuentas/:id` no existe hoy: se puede crear y borrar un medio, pero no
modificarlo. Sigue el mismo patrón de actualización parcial que
`PATCH /api/servicios/:id`, distinguiendo campo ausente de campo con valor, para que un
`0` explícito no se confunda con "no lo mandes".

`resumen-pagado` es su propio endpoint y no un `PATCH`, porque es una operación compuesta
con semántica propia. Sigue el patrón que ya usa `POST /api/cuentas/:id/default`.

Validaciones, en línea con el resto de la API: `nombre` recortado a 40 caracteres y no
vacío; `cierre` y `venc` entre 1 y 31; límites y bases mayores o iguales a cero; los campos
de crédito se ignoran si la cuenta es de débito.

## UI

### Pestaña Medios

Las cuentas de débito no cambian: una línea, como hoy. Las de crédito pasan a:

```
★ Visa                                        editar
  crédito · cierra 20 · paga 5

  UN PAGO                        $30.000 / $150.000
  ▓▓▓▓░░░░░░░░░░░░░░░░░░░░

  CUOTAS                         $85.000 / $300.000
  ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░

  pagué el resumen                             borrar
```

La barra reutiliza la clase `.bar` que ya existe. **Con 90% de uso o más pasa de verde
`--accent` a rojo `--danger`** (el umbral es inclusivo: exactamente 90% ya es rojo): el
valor de este número está en avisar cuando queda poco aire.

Si el límite todavía no se cargó, no se dibuja ninguna barra ni se inventa un porcentaje —
va un texto invitando a cargarlo. Una barra vacía sin contexto se lee como "no debés nada",
que es exactamente lo contrario de la verdad.

Si el usado supera el límite, la barra se dibuja al 100% y el número se muestra tal cual,
sin recortar. Pasarse del límite es información, no un error a esconder.

### Editar

El botón despliega la fila en un formulario inline, con el mismo patrón que el botón Pagar
de servicios. Campos: nombre, día de cierre, día de pago, límite en un pago, límite en
cuotas, base en un pago, base en cuotas. Botones de guardar y cancelar.

Para una cuenta de débito el formulario muestra solo el nombre, porque el resto no aplica.

### Pagué el resumen

Pide confirmación con `confirm()` antes de ejecutar, porque avanza el mes de corte y borra
la base de un pago. Recuperarlo implica volver a escribir a mano lo que se debía.

## Casos borde

- **Límite sin cargar (`NULL`).** No se dibuja barra; texto invitando a cargarlo. Nunca se
  divide por cero ni por `NULL`.
- **Usado por encima del límite.** Barra al 100%, número real sin recortar.
- **`pagado_hasta` en `NULL`.** Todo cuenta, que es lo correcto para una tarjeta cuyo
  resumen nunca se marcó pagado.
- **Gastos de servicio pendientes u omitidos.** No ocupan límite; se filtran con
  `sumaAlTotal`.
- **Cuenta de débito.** No muestra límites ni el botón de resumen, y la API ignora esos
  campos si llegan.
- **Editar el cierre cambia dónde caen los gastos.** Es el efecto buscado, pero mueve
  gastos de un resumen a otro retroactivamente. El formulario lo advierte con un texto.

## Verificación

El proyecto no tiene framework de tests para el frontend; sí tiene `node --test` para la
lógica pura de `src/servicios.mjs`. Si el cálculo de límites se extrae a una función pura,
se testea ahí; si no, la verificación es manual con `npx wrangler dev`:

1. Cargar una tarjeta con límite en un pago de 150.000 y base 30.000 → muestra
   `$30.000 / $150.000` sin ningún gasto cargado.
2. Agregar un gasto de 20.000 en un pago con esa tarjeta → pasa a `$50.000 / $150.000`.
3. Agregar un gasto de 60.000 en 6 cuotas → el de un pago no se mueve; el de cuotas sube
   60.000, no 10.000, porque las seis cuotas ocupan límite desde el momento de la compra.
4. Tocar "pagué el resumen" y confirmar → la base de un pago queda en cero y el usado baja
   a lo que corresponde a resúmenes posteriores.
4b. Verificar el mes que guarda `pagado_hasta` en los dos lados del cierre: con una tarjeta
   de cierre 20, una vez con fecha del sistema anterior al 20 y otra posterior. Un mes de
   error acá libera de más o de menos.
5. Llevar el uso por encima del 90% → la barra pasa a roja.
6. Llevar el uso por encima del 100% → barra llena, número real sin recortar.
7. Editar el día de cierre de una tarjeta con gastos cargados → los gastos se mueven de
   resumen, y el usado se recalcula solo.
8. Una cuenta de débito no muestra barras ni el botón de resumen.
9. Un gasto de servicio en estado `pendiente` no ocupa límite; al pagarlo, sí.

## Migración

Archivo nuevo `migracion-limites.sql` con los cinco `ALTER TABLE`, más la misma cabecera de
operador que tiene `migracion-servicios.sql`: backup previo, orden respecto del deploy, y
qué hacer si falla a la mitad. `schema.sql` se actualiza en paralelo.

Esta migración es puramente aditiva y las columnas son nullable o tienen default, así que
las cuentas existentes quedan válidas sin backfill.

## Fuera de alcance

- Importar o parsear el resumen de la tarjeta para extraer cierre, vencimiento y gastos.
  Proyecto propio; cuando exista, reemplaza la base manual.
- Mostrar el límite disponible en la pantalla de carga al elegir la tarjeta.
- Alertas o notificaciones al acercarse al límite.
