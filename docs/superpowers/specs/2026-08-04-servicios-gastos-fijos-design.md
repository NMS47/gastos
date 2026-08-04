# Servicios y gastos fijos mensuales

Fecha: 2026-08-04

## Problema

Hoy la app solo registra gastos que alguien carga a mano. Eso deja dos huecos:

1. **Se olvidan de pagar servicios.** La luz, el agua o las expensas vencen un día del mes
   y no hay nada en la app que lo recuerde.
2. **No saben cuánto les sale fijo por mes.** El costo base — suscripciones, seguros,
   servicios — está diluido entre los gastos sueltos y no hay un número que lo resuma.

## Decisiones tomadas

- Los servicios son de **monto variable o fijo según el caso**: Netflix no cambia, Edenor sí.
  El diseño banca ambos.
- Un servicio impago **no suma al total del mes**. El total del mes sigue significando
  plata que salió de verdad. Los pendientes van aparte, con subtotal propio.
- Hay **dos clases de servicio** y la distinción es central:
  - `auto` — débito automático (Netflix en la Visa). No requiere acción. Su razón de ser
    es alimentar el número de gasto fijo mensual y que el total de la tarjeta cierre.
  - `manual` — los pagás vos. Son los únicos que pueden olvidarse.
- Los `auto` **se cargan solos** cada mes con el monto guardado, y son editables.
- **Todos los servicios son mensuales.** No hay bimestrales ni anuales, así que no existe
  columna de frecuencia ni prorrateo.
- El aviso vive en una **pestaña propia con contador**, no en un banner en Cargar.

## Enfoque elegido: materialización perezosa

Se descartaron dos alternativas:

- **Proyección virtual** (al estilo `impactos()`, sin guardar nada): editar el monto de un
  servicio reescribiría el pasado. Si Netflix aumenta hoy, los meses viejos pasarían a
  mostrar el precio nuevo. Inaceptable con la inflación local.
- **Cron Trigger de Cloudflare**: conceptualmente más limpio, pero agrega un trigger en
  `wrangler.toml` y un handler `scheduled`, y falla en silencio. No compra nada frente a
  la materialización perezosa para dos usuarios que abren la app varias veces por semana.

La generación pasa dentro del `GET /api/state`, que ya se llama en cada arranque de la app.
Antes de devolver los datos, el Worker inserta los gastos del mes corriente que falten.

## Modelo de datos

### Tabla nueva

```sql
CREATE TABLE IF NOT EXISTS servicio (
  id        TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  monto     REAL NOT NULL,        -- lo que se espera pagar
  dia       INTEGER NOT NULL,     -- día del mes que vence o se debita (1-31)
  cuenta_id TEXT NOT NULL REFERENCES cuenta(id),
  cat       TEXT,
  modo      TEXT NOT NULL CHECK (modo IN ('auto','manual')),
  activo    INTEGER NOT NULL DEFAULT 1,
  desde     TEXT NOT NULL,        -- YYYY-MM, primer mes que corresponde
  creado    TEXT NOT NULL
);
```

### Cambios en `mov`

```sql
ALTER TABLE mov ADD COLUMN servicio_id TEXT;
ALTER TABLE mov ADD COLUMN estado TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_serv_mes
  ON mov(servicio_id, substr(fecha,1,7)) WHERE servicio_id IS NOT NULL;
```

`estado` es `NULL` para un gasto común. Para los que vienen de un servicio toma uno de
tres valores:

| estado      | significa                                  | ¿suma al total del mes? |
|-------------|--------------------------------------------|-------------------------|
| `pendiente` | generado, todavía sin pagar                | no                      |
| `pagado`    | pagado (o debitado, si es `auto`)          | sí                      |
| `omitido`   | salteado este mes a propósito              | no                      |

El índice único parcial es lo que hace segura toda la generación: abrir la app diez veces
en un día, o desde los dos teléfonos a la vez, produce exactamente una fila por servicio
y mes.

## Generación

En cada `GET /api/state`, antes de responder:

1. Calcular el mes corriente **en hora argentina** (`Date.now() - 3h`), no en UTC. Sin esto,
   entre las 21:00 y las 24:00 del último día del mes el servidor ya estaría en el mes
   siguiente y generaría los servicios unas horas antes de tiempo.
2. Para cada `servicio` con `activo = 1` y `desde <= mesActual`, hacer un
   `INSERT OR IGNORE INTO mov (...)` con:
   - `fecha` = `mesActual` + `dia`, **acotando el día al último del mes** (día 31 en
     febrero se guarda como el 28 o 29).
   - `descripcion` = `servicio.nombre`
   - `monto` = `servicio.monto`
   - `cuenta_id`, `cat` = los del servicio
   - `cuotas` = 1
   - `quien` = `NULL` (no lo cargó ninguno de los dos, no se pinta)
   - `servicio_id` = `servicio.id`
   - `estado` = `'pagado'` si `modo = 'auto'`, `'pendiente'` si `modo = 'manual'`

**Solo se genera el mes corriente.** No se rellenan meses viejos si estuvieron sin abrir la
app, para que no aparezcan de golpe pendientes de mayo que en realidad ya pagaron.

Un servicio dado de alta a mitad de mes genera su gasto de ese mismo mes, porque `desde` se
setea al mes corriente en el alta.

## API

| Método | Ruta                    | Qué hace |
|--------|-------------------------|----------|
| GET    | `/api/state`            | Corre la generación y devuelve `{cuentas, movs, servicios}` |
| POST   | `/api/servicios`        | Alta. `desde` se setea al mes corriente en el servidor |
| PATCH  | `/api/servicios/:id`    | Edita `nombre`, `monto`, `dia`, `cuenta_id`, `cat`, `modo`, `activo` |
| DELETE | `/api/servicios/:id`    | Solo si nunca generó gastos; si no, 409 sugiriendo desactivar |
| POST   | `/api/movs/:id/pagar`   | Body `{monto}`. Pone `estado='pagado'` y el monto real. **No toca `fecha`** |
| DELETE | `/api/movs/:id`         | Si tiene `servicio_id`, pasa a `estado='omitido'` en vez de borrar |

Validaciones del alta y la edición de servicio, en línea con lo que ya hace `movs`:
`nombre` no vacío y recortado a 40 caracteres, `monto > 0`, `dia` entre 1 y 31,
`cuenta_id` existente, `modo` en `('auto','manual')`.

Editar el `monto` de un servicio **no** toca los gastos ya generados. El precio nuevo rige
del mes siguiente en adelante. Esa es toda la razón por la que se guardan filas reales.

Pagar tampoco cambia la `fecha`: queda la del vencimiento. Si se moviera al día del pago,
un pago tardío saltaría de mes y rompería tanto el índice único como el mes al que el gasto
pertenece. Pagar la luz de julio el 2 de agosto sigue siendo un gasto de julio.

## UI

### Nav

Pasa a cuatro pestañas: Cargar, Mes, Servicios, Medios. La de Servicios lleva un punto rojo
cuando hay al menos un `pendiente` con fecha de vencimiento ya cumplida — **incluidos los de
meses anteriores**. Una boleta de julio que quedó sin pagar sigue avisando en agosto; si el
aviso se limitara al mes corriente, el olvido que la feature viene a resolver se volvería
permanente el día 1. La pantalla de Cargar no se toca: sigue siendo el camino de 4 taps.

### Pestaña Servicios

Arriba, el número principal, con el mismo tratamiento visual que el total del mes:

```
GASTO FIJO MENSUAL
$187.400
   automáticos $52.400  ·  los pagás vos $135.000
```

Sale de sumar el `monto` de los servicios con `activo = 1`. Cuenta directa, sin prorrateos.

Abajo, los servicios en dos grupos separados:

```
DÉBITO AUTOMÁTICO
  Netflix          Visa · día 5                     $7.400
  Spotify          Visa · día 12                    $5.000
  Seguro auto      MP Crédito · día 3              $40.000

LOS PAGÁS VOS
  Edenor           MP · vence 15   ● pendiente     $18.000  [Pagar]
  Aysa             MP · vence 20   ● pendiente     $12.000  [Pagar]
  Expensas         MP · vence 10   ✓ pagado      $105.000
```

Los `auto` se listan sin botón ni estado: su función es sumar al número de arriba, no pedir
acción. Los `manual` muestran el estado del mes corriente.

Si quedaron pendientes de meses anteriores, van arriba de todo el grupo manual, marcados
como vencidos y con el mes al que corresponden:

```
LOS PAGÁS VOS
  Edenor           MP · venció el 15/07   ● vencido    $18.000  [Pagar]
  Aysa             MP · vence 20          ● pendiente  $12.000  [Pagar]
```

**Flujo de pago:** el botón Pagar convierte la fila en un input de monto precargado con el
monto esperado, más un botón de confirmar. Se usa input inline y no `prompt()`, porque el
`prompt` del navegador abre teclado de texto en el celular y esto es plata. Al confirmar,
la fila pasa a `pagado` con el monto real y entra al total del mes.

Más abajo, el formulario de alta: nombre, monto, día, medio de pago, categoría y un select
de modo (débito automático / lo pago yo). Cada servicio se puede desactivar — es lo que
hacés al cancelar Netflix: deja de generar gastos y no ensucia el historial.

### Pestaña Mes

- Nueva sección "Pendientes de pagar" con subtotal, visible solo si hay pendientes ese mes.
- Las filas que vienen de un servicio llevan un tag `fijo`.
- Los totales (`mtotal`, `pormedio`, `futuro`) filtran `estado IS NULL OR estado = 'pagado'`.
- Las filas de servicio quedan neutras, sin el azul ni el rosa de `quien`.

## Casos borde

- **Día 31 en un mes de 30.** Se acota al último día del mes al generar.
- **Cambio de mes en hora argentina.** La generación usa UTC-3, no UTC.
- **Saltear un mes.** Borrar el gasto de un servicio lo marca `omitido`; no cuenta en los
  totales y no se regenera.
- **Borrar un medio de pago usado por un servicio.** El chequeo actual en
  `DELETE /api/cuentas/:id` solo mira `mov`. Hay que extenderlo a `servicio` y devolver 409.
- **Borrar un servicio con historial.** Se rechaza con 409 y se sugiere desactivarlo, para
  no dejar gastos huérfanos apuntando a un servicio inexistente.
- **Dos teléfonos abriendo la app a la vez.** El índice único parcial lo cubre.

## Verificación

El proyecto no tiene framework de tests. La verificación es manual, contra la app corriendo
con `npx wrangler dev`:

1. Alta de un servicio `auto` con día 5 en una tarjeta de crédito con cierre 20 → al
   recargar aparece el gasto del mes corriente ya `pagado`, y en la vista Mes cae en el
   resumen del mes siguiente (lo que ya hace `impactos()`).
2. Alta de un servicio `manual` → aparece como `pendiente`, suma al subtotal de pendientes
   y **no** al total del mes.
3. Pagar ese pendiente con un monto distinto al esperado → pasa a `pagado`, el total del mes
   sube por el monto real, el subtotal de pendientes baja.
4. Recargar la app cinco veces seguidas → no se duplica ningún gasto.
5. Borrar un gasto de servicio y recargar → queda omitido, no reaparece.
6. Editar el monto de un servicio → el gasto del mes ya generado no cambia.
7. Servicio con día 31, generado en un mes de 30 días → la fecha queda en el día 30.
8. Intentar borrar un medio de pago usado por un servicio → 409 con mensaje claro.
9. Dejar un pendiente sin pagar y pasar al mes siguiente → sigue apareciendo como vencido
   arriba del grupo manual, y el punto rojo del nav sigue encendido.

## Migración

Archivo nuevo `migracion-servicios.sql`, con el `CREATE TABLE`, los dos `ALTER TABLE` y el
índice único. Se aplica una sola vez:

```
npx wrangler d1 execute gastos --remote --file=./migracion-servicios.sql
```

`schema.sql` se actualiza en paralelo para que una base creada de cero quede igual.

## Fuera de alcance

- Notificaciones push. Descartado: requiere service worker y permisos, y en iPhone solo
  funciona si instalan la PWA.
- Frecuencias que no sean mensuales.
- Conciliar los servicios contra el resumen real de la tarjeta.
