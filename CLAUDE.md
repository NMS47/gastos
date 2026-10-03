# Gastos — contexto del proyecto

App de gastos personales para dos personas (Nico y Dani), en español rioplatense.
Reemplaza una planilla Excel con una hoja por mes que se volvió inmanejable.

## Stack

Un solo Worker de Cloudflare. Sin framework, sin build step, sin dependencias en runtime.

```
public/index.html       HTML + CSS + render. La aritmética está en calculo.mjs
public/calculo.mjs      aritmética pura: impactos, vigenteEn, consumos, cascada, anchoBarra
public/manifest.json    PWA, para instalarla en el celular
src/index.js            Worker: sirve /public via env.ASSETS y atiende /api/*
src/servicios.mjs       lógica pura de servicios (mes en UTC-3, acotado de días)
src/servicios.test.mjs  tests de servicios — correr con `node --test` desde la raíz
src/tarjetas.mjs        mesResumenCerrado: a qué resumen corresponde el que acaba de cerrar
src/tarjetas.test.mjs   tests de tarjetas — mismo `node --test`
src/calculo.test.mjs    tests de calculo.mjs — mismo `node --test`
src/frontend.test.mjs   humo del <script type="module"> de index.html — mismo `node --test`
schema.sql              tablas cuenta, mov y servicio + medios de pago iniciales
migracion-quien.sql     ALTER TABLE suelto, ya aplicado
migracion-servicios.sql tabla servicio + servicio_id/estado en mov, ya aplicado (2026-08-05)
migracion-limites.sql   límites y bases en cuenta, ya aplicado (2026-08-06)
migracion-presupuesto.sql  topes, ingresos, servicio.hasta, mov.ambito — TODAVÍA NO APLICADO
  en producción. TIENE QUE CORRERSE A MANO ANTES DE MERGEAR ESTA RAMA A MAIN: Cloudflare
  buildea solo con cada push a main, y sin la migración GET /api/state y POST /api/movs
  tiran error apenas esta rama llegue ahí.
wrangler.toml           main + [assets] + binding D1 (DB) + secret PIN
```

Base: Cloudflare D1 (SQLite). Deploy: push a GitHub, Cloudflare buildea solo.

Importante: este proyecto **no** usa Pages Functions. Se intentó con `functions/` y falló
porque Cloudflare ya no ofrece crear proyectos Pages en cuentas nuevas; todo va por el
modelo Worker + `[assets]`. No reintroducir la carpeta `functions/`.

## Modelo de datos

```sql
cuenta(id, nombre, tipo, cierre, venc, def,
       limite_pago, limite_cuotas, base_pago, base_cuotas, pagado_hasta)
  tipo: 'debito' (incluye efectivo y billeteras) | 'credito'
  cierre/venc: días del mes, solo para crédito
  def: 1 en el medio de pago preseleccionado al cargar
  limite_pago / limite_cuotas: topes del banco; NULL = todavía no se cargaron
  base_pago / base_cuotas: lo que ya se debía antes de usar la app
  pagado_hasta: YYYY-MM del último resumen pagado; NULL = ninguno

mov(id, fecha, descripcion, monto, cuenta_id, cuotas, cat, quien, servicio_id, estado, creado,
    ambito)
  fecha: YYYY-MM-DD, cuándo se hizo la compra (o el vencimiento, si viene de un servicio)
  quien: 'nico' | 'dani', para pintar la fila; NULL en los gastos que genera un servicio
  servicio_id: de qué servicio salió; NULL si es un gasto suelto
  estado: NULL en un gasto común. En uno generado por un servicio:
    'pendiente' — generado, todavía sin pagar; no suma al total del mes
    'pagado'    — pagado (o debitado, si el servicio es 'auto'); suma al total del mes
    'omitido'   — se salteó ese mes a propósito; no suma y no se regenera
  ambito: 'personal' | NULL = familiar. Un gasto personal no suma a ningún total familiar
    y no consume ningún tope. Eje distinto de `quien`: `quien` es quién lo cargó (para
    pintar la fila), `ambito` es de quién es la plata. Un gasto familiar también tiene
    `quien`. Mezclar los dos ejes es el error que tenía la planilla vieja.

servicio(id, nombre, monto, dia, cuenta_id, cat, modo, activo, desde, creado, hasta)
  monto: lo que se espera pagar cada mes
  dia: día del mes que vence o se debita (1-31)
  modo: 'auto' (débito automático, el gasto nace 'pagado') | 'manual' (lo pagan ellos,
    nace 'pendiente')
  activo: 0 tras dar de baja — deja de generar gastos nuevos, no borra el historial
  desde: YYYY-MM, primer mes que corresponde (el mes de alta)
  hasta: YYYY-MM, último mes que corresponde; NULL = sin fin. Un compromiso (la cuota de
    una deuda, un pago único) no es una tabla nueva: es un servicio con `hasta`. Un pago
    único es un servicio que dura un mes (desde = hasta); saltearlo es el `omitido` que ya
    existe. `activo` y `hasta` no son lo mismo y hacen falta los dos: `hasta` es un final
    previsto desde el alta (la deuda dura siete cuotas y se sabe), `activo = 0` es una baja
    decidida en el camino que no estaba en el plan. Mezclarlos obligaría a reescribir
    `hasta` para dar algo de baja, perdiendo el dato de hasta cuándo tenía que durar.

ingreso(id, nombre, monto, dia, desde, hasta, activo, creado)
  monto: lo que entra cada mes; dia: solo informativo, no dispara nada
  desde/hasta: mismo significado que en servicio. Un ingreso eventual (el aguinaldo) es
    desde = hasta; uno que no se sabe cuándo cae simplemente no se carga, así la cascada
    nunca cuenta plata que no existe

tope(cat, monto)
  cat: una categoría de CATS, PRIMARY KEY. Sin fila = sin tope para esa categoría
```

**No existe tabla de cuotas.** El impacto se calcula al renderizar, en la función
`impactos()` de `public/calculo.mjs`. Es la decisión central del diseño: un gasto en
cuotas se carga una sola vez y aparece solo en los N meses siguientes.

Regla:
- Cuenta de débito → impacta el mismo día de la compra.
- Cuenta de crédito → si el día de compra es <= `cierre`, entra en el resumen del mes
  siguiente; si es posterior, en el subsiguiente. Cada cuota suma un mes más.
- El monto de cada cuota es `round(total/n)`, y la última absorbe el redondeo para que
  la suma dé exacta.

Ojo con el ejemplo de los 12 meses: 12 cuotas desde diciembre terminan en **diciembre del
año siguiente** si la compra fue antes del cierre, y en **enero del año +2** si fue
después — un mes más porque esa compra ya arrancó en el resumen siguiente. Las dos ramas
están fijadas con test. Si se toca `impactos()`, correr `node --test`.

## Reglas de negocio que no son obvias

- **El pago del resumen de la tarjeta no se carga como gasto.** El total de una tarjeta
  en un mes ya es la suma de sus cuotas; cargarlo aparte duplicaría todo. En la planilla
  vieja esto pasaba y los totales estaban inflados.
- **Categoría y persona son ejes distintos.** La planilla vieja mezclaba "Super"/"Casa"
  con "Dani"/"Valen". Las categorías son una lista fija (`CATS` en `index.html`), nunca
  texto libre. Los medios de pago sí se editan desde la app.
- **Los ingresos viven en su propia tabla (`ingreso`), no en una columna `tipo` de `mov`.**
  Con tabla aparte, `mov` sigue significando exactamente *plata que sale* y ninguna de las
  consultas que ya funcionan necesita un filtro nuevo. Con una columna `tipo`, cada total
  pasaría a necesitar un `WHERE` extra y el día que se olvide uno los números se inflan
  sin avisar.
- **`quien` es una configuración del teléfono, no un campo del formulario.** Sale de
  `localStorage.getItem("quien")`, se fija una vez en la pestaña "Este teléfono" y de ahí
  en más viaja solo en cada gasto que se carga desde ese aparato. Es lo que permite que el
  toggle "personal" no necesite un selector de persona al lado: el dueño del gasto personal
  es quien sea que esté usando el teléfono. La misma limitación que ya tienen los colores
  de fila (`.q-nico`/`.q-dani`): si alguna vez comparten un teléfono, la atribución —y con
  el gasto personal, de quién es la plata— queda mal.
- **Los gastos de servicio se generan solos, al vuelo.** No hay una fila guardada de
  antemano por servicio y mes: cada `GET /api/state` corre `generarDelMes()`, que inserta
  las que falten del mes corriente antes de responder. `POST /api/servicios` también la
  llama, para que un alta a mitad de mes tenga su gasto cargado sin esperar al próximo
  `GET`.
- **El id del gasto generado es determinístico:** `"sv" + servicio_id + "-" + mes`. Al ser
  la PRIMARY KEY de `mov`, ella sola impide duplicar el gasto de un servicio en un mes, así
  se abra la app diez veces o desde los dos teléfonos a la vez. El índice único parcial
  `idx_mov_serv_mes` queda como respaldo redundante — no lo saques pensando que la
  generación depende de él para ser segura.
- **Borrar un gasto generado por un servicio lo marca `omitido`, no lo elimina.** Un borrado
  real dejaría el hueco libre y el próximo `generarDelMes()` lo volvería a crear con el
  mismo id.
- **Un pendiente no suma al total del mes.** El total es plata que salió de verdad; filtra
  por `estado IS NULL OR estado = 'pagado'`.
- **Editar el monto de un servicio no toca los gastos ya generados.** El precio nuevo rige
  recién el mes siguiente. Es la razón de guardar filas reales en `mov` en vez de proyectar
  el monto al renderizar, como hace `impactos()` con las cuotas.
- **"Vencen este mes" (pestaña Mes) usa la fecha de vencimiento del gasto, no el mes que le
  asigna `impactos()`.** Un servicio en tarjeta de crédito puede vencer en agosto y aparecer
  en el resumen de septiembre; el aviso tiene que sonar cuando hay que pagarlo, no cuando
  impacta en el resumen.
- **El total "falta pagar" de la pestaña Servicios no filtra por servicio.** Solo los
  manuales generan pendientes, así que todo `mov` en estado `'pendiente'` ya es un manual
  sin pagar. Incluye los arrastrados de meses anteriores, a diferencia del "Total a vencer"
  de la pestaña Mes, que suma solo el mes corriente. Los dos números difieren cuando hay
  atrasados, y está bien: responden preguntas distintas.
- **El tag "pagado" va solo en los servicios manuales.** Los automáticos nacen `'pagado'` el
  día que se generan, no el día que se debitan: el gasto de Netflix se crea el 1 del mes con
  fecha 25 y ya marcado pagado. Un tag ahí diría "pagado" tres semanas antes de que salga la
  plata.
- **La fecha de hoy se calcula distinto en el frontend y en el Worker, a propósito.**
  `hoyISO()` en `index.html` usa los componentes locales del navegador
  (`getFullYear/getMonth/getDate`), porque el celular ya está en hora argentina.
  `mesActualAR()` en `src/servicios.mjs` resta 3 horas a mano, porque el Worker corre en
  servidores en UTC. No unificar esto en un `toISOString()` — en uno de los dos entornos
  daría la fecha equivocada cerca de la medianoche.
- **El límite usado no se guarda, se calcula.** Una sola regla: un gasto ocupa límite hasta
  que su resumen esté pagado, así que se compara el mes que le asigna `impactos()` contra
  `pagado_hasta`. Guardar un contador se desincronizaría al borrar o editar un gasto.
- **Una compra en N cuotas ocupa el total desde el día uno**, no de a una cuota por mes. Es
  lo que hacen los bancos con el límite de financiación.
- **"Pagué el resumen" borra `base_pago` pero no `base_cuotas`.** Lo que se debía en un pago
  entró entero en ese resumen; las cuotas viejas siguen corriendo y la app no conoce su
  cronograma, así que esa base se baja a mano.
- **Sin día de cierre, "pagué el resumen" falla en vez de asumir un default.** El mes que se
  guarda en `pagado_hasta` sale de `mesResumenCerrado()`, que necesita el `cierre` de la
  tarjeta; sin él no hay forma de saber qué resumen cerró, y asumir un 20 fecharía el pago
  con el cierre de otra tarjeta y liberaría el límite equivocado sin avisar.
- **La regla única de los topes: con tope se reserva todo, sin tope se resta lo
  determinado.** Si una categoría tiene tope, se reserva el tope completo y todo lo de esa
  categoría lo consume — servicios incluidos. Si no tiene tope, se resta lo determinado tal
  cual. Una sola regla resuelve lo que parecían tres excepciones: Auto mezcla gastos fijos
  (seguro, patente) y sueltos (nafta) en la misma barra sin separarlos; un pago único como
  la escritura se resta entero porque su categoría no tiene tope, sin inventarle uno; y
  Servicios no lleva tope a propósito, porque nadie quiere ponerle un límite a lo que cobra
  la luz.
- **Los topes y el resumen de tarjeta miden con relojes distintos, a propósito.** Los topes
  se miden por fecha de compra, sin importar el medio de pago; el resumen de tarjeta se
  resta en el mes en que se paga. El tope tiene que sonar cuando se decide gastar — en la
  caja del súper — no 40 días después cuando llega el resumen. Consecuencia: mientras dure
  la transición de bajar el uso de la tarjeta, un mes carga el supermercado de agosto
  (dentro del resumen) y reserva el de octubre (dentro de los topes) a la vez. No es doble
  conteo: es lo que pasa en la vida real cuando se vive con la tarjeta, se paga el pasado y
  se compromete el presente en el mismo mes. La doble carga se va encogiendo sola a medida
  que baja el uso de tarjeta.
- **Un gasto `pendiente` consume el tope de su categoría aunque no sume al total del mes.**
  Ya está comprometido — el seguro del auto que vence el 28 va a salir seguro — y el tope
  existe justamente para que esa plata no se prometa dos veces. Es lo contrario de lo que
  hace el total del mes, que deja los pendientes afuera porque todavía no salieron. Un
  `omitido` no consume tope: se salteó a propósito, esa plata no sale.
- **Una compra en cuotas consume el tope completo en el mes de compra, no una cuota por
  mes.** Mismo criterio que ya usa la app con el límite de financiación de la tarjeta: el
  tope limita lo que se *decide* gastar, y en 12 cuotas se decidió gastar el total. Financiar
  no tiene que sentirse gratis este mes — es justo el hábito que esto ayuda a cortar.
- **`base_cuotas` nunca entra en la línea de tarjeta de la cascada.** Son cuotas viejas
  corriendo cuyo cronograma la app no conoce, así que repartirlas por mes sería inventar.
  Consecuencia práctica: mientras haya `base_cuotas` sin desglosar, la línea de tarjeta
  queda más baja que el resumen real y el presupuesto personal sale más optimista de lo que
  es. La salida no es código: cargar esas compras viejas como `mov` reales con su cantidad
  de cuotas y poner `base_cuotas` en cero.
- **El reparto personal es fijo del día 1, 50/50, no uno en vivo sobre lo gastado.** La app
  calcula `ingresos − tarjeta − sin tope − topes` y lo divide por dos desde el primer día
  del mes. El tope de una categoría se reserva completo aunque no se haya gastado nada
  todavía, así que el número no se mueve según lo que el otro cargó ayer: un número que
  cambia todos los días no sirve para dejar de discutir, que es el problema que esto
  resuelve. El mes puede dar negativo, y se muestra negativo — un cero piadoso escondería
  justo lo que hay que ver.
- **La condición de vigencia está duplicada a propósito entre el SQL de `generarDelMes()`
  (en `src/index.js`) y `vigenteEn()` en `public/calculo.mjs`.** Una corre en SQLite para
  generar los gastos reales del mes corriente, la otra en el navegador para proyectar
  servicios de meses futuros que todavía no tienen fila en `mov`; ninguna puede llamar a la
  otra. Si se cambia una regla de vigencia (`activo`, `desde`, `hasta`), hay que cambiar las
  dos o un servicio queda vigente en una y no en la otra.
- **`parseMonto()` (en `public/calculo.mjs`) trata el punto siempre como separador de
  miles, y la coma solo a veces como decimal.** Un punto nunca es decimal: `"1.700.000"` es
  un millón setecientos mil, no 1,7. Una coma es decimal únicamente cuando es la última del
  string y la siguen 1 o 2 dígitos (`"600,50"`, pegado de un resumen de banco); en cualquier
  otro caso —incluidas todas las comas que vengan antes de esa última— es separador de
  miles. La regla es asimétrica a propósito: en es-AR el punto jamás es decimal, así que no
  hace falta mirar qué lo sigue; la coma sí puede serlo, así que hay que mirar. Colapsarla a
  "la coma siempre es decimal" es el bug que ya pasó dos veces: `"1.700.000"` se leía como
  1.7.
- **`fmt()` (en `public/calculo.mjs`) pone el signo antes del símbolo de pesos:
  `-$200.000`, no `$-200.000`.** El número más grande de la cascada (lo que queda para
  dividir) se vuelve negativo justo cuando el mes no cubre sus compromisos, así que es lo
  primero que alguien ve en ese caso, y `$-200.000` lee como un error de la app en vez de
  como una plata que falta.

## Convenciones

- Todo el texto de la UI en español rioplatense, voseo, sentence case.
- Montos con `toLocaleString("es-AR")`, sin decimales.
- La app está pensada para cargar un gasto en 4 taps desde el celular: el campo de monto
  es lo primero y lo más grande. No agregar campos obligatorios.
- Colores y tipografías salen de las variables CSS al tope de `index.html`.
  Verde `--accent` para acciones, violeta `--credit` para todo lo de cuotas/tarjeta,
  `.q-nico` azul y `.q-dani` rosa para las filas según quién cargó.

## Auth

Un PIN compartido en la variable de entorno `PIN` del Worker. El frontend lo guarda en
`localStorage` y lo manda en el header `x-pin`; la API rechaza con 401 si no coincide.
Es deliberadamente simple: son dos usuarios en una app familiar.

## Cosas pendientes / ideas

- Editar el monto, la fecha o la descripción de un gasto ya cargado (hoy solo se puede
  reclasificar la categoría desde la bandeja "Sin categoría", o borrarlo).
- Mover un gasto entre familiar y personal después de cargado. `PATCH /api/movs/:id` ya
  acepta `ambito` — se agregó junto con `cat` pensando en este caso — pero ninguna pantalla
  lo manda: el checkbox "personal" solo se lee al crear el gasto (`index.html`), y el
  `<select>` de la bandeja solo envía `{ cat }`. Es barato: falta un control en la UI, no
  el endpoint.
- Editar un servicio ya creado desde la app (el `PATCH /api/servicios/:id` existe, falta
  la UI).
- Reactivar un servicio dado de baja sin entrar a la base a mano.
- Importar el resumen de la tarjeta para extraer cierre, vencimiento y conciliar gastos.
  Reemplazaría las bases manuales de los límites.
- Multi-moneda para la deuda en USD (hoy se carga en pesos y se ajusta a mano cuando se
  mueve el dólar).
- Reparto distinto a 50/50.
- Historial de topes (hoy un mes pasado se calcula con los topes de hoy).
- Repartir el sobrante de un tope a fin de mes, cuando se gastó menos de lo reservado.
