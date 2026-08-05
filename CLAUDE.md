# Gastos — contexto del proyecto

App de gastos personales para dos personas (Nico y Dani), en español rioplatense.
Reemplaza una planilla Excel con una hoja por mes que se volvió inmanejable.

## Stack

Un solo Worker de Cloudflare. Sin framework, sin build step, sin dependencias en runtime.

```
public/index.html       la app entera: HTML + CSS + JS vanilla en un archivo
public/manifest.json    PWA, para instalarla en el celular
src/index.js            Worker: sirve /public via env.ASSETS y atiende /api/*
src/servicios.mjs       lógica pura de servicios (mes en UTC-3, acotado de días)
src/servicios.test.mjs  únicos tests del proyecto — correr con `node --test` desde la raíz
schema.sql              tablas cuenta, mov y servicio + medios de pago iniciales
migracion-quien.sql     ALTER TABLE suelto, ya aplicado
migracion-servicios.sql tabla servicio + servicio_id/estado en mov, ya aplicado
wrangler.toml           main + [assets] + binding D1 (DB) + secret PIN
```

Base: Cloudflare D1 (SQLite). Deploy: push a GitHub, Cloudflare buildea solo.

Importante: este proyecto **no** usa Pages Functions. Se intentó con `functions/` y falló
porque Cloudflare ya no ofrece crear proyectos Pages en cuentas nuevas; todo va por el
modelo Worker + `[assets]`. No reintroducir la carpeta `functions/`.

## Modelo de datos

```sql
cuenta(id, nombre, tipo, cierre, venc, def)
  tipo: 'debito' (incluye efectivo y billeteras) | 'credito'
  cierre/venc: días del mes, solo para crédito
  def: 1 en el medio de pago preseleccionado al cargar

mov(id, fecha, descripcion, monto, cuenta_id, cuotas, cat, quien, servicio_id, estado, creado)
  fecha: YYYY-MM-DD, cuándo se hizo la compra (o el vencimiento, si viene de un servicio)
  quien: 'nico' | 'dani', para pintar la fila; NULL en los gastos que genera un servicio
  servicio_id: de qué servicio salió; NULL si es un gasto suelto
  estado: NULL en un gasto común. En uno generado por un servicio:
    'pendiente' — generado, todavía sin pagar; no suma al total del mes
    'pagado'    — pagado (o debitado, si el servicio es 'auto'); suma al total del mes
    'omitido'   — se salteó ese mes a propósito; no suma y no se regenera

servicio(id, nombre, monto, dia, cuenta_id, cat, modo, activo, desde, creado)
  monto: lo que se espera pagar cada mes
  dia: día del mes que vence o se debita (1-31)
  modo: 'auto' (débito automático, el gasto nace 'pagado') | 'manual' (lo pagan ellos,
    nace 'pendiente')
  activo: 0 tras dar de baja — deja de generar gastos nuevos, no borra el historial
  desde: YYYY-MM, primer mes que corresponde (el mes de alta)
```

**No existe tabla de cuotas.** El impacto se calcula al renderizar, en la función
`impactos()` de `index.html`. Es la decisión central del diseño: un gasto en cuotas se
carga una sola vez y aparece solo en los N meses siguientes.

Regla:
- Cuenta de débito → impacta el mismo día de la compra.
- Cuenta de crédito → si el día de compra es <= `cierre`, entra en el resumen del mes
  siguiente; si es posterior, en el subsiguiente. Cada cuota suma un mes más.
- El monto de cada cuota es `round(total/n)`, y la última absorbe el redondeo para que
  la suma dé exacta.

Si se toca `impactos()`, verificar estos casos: compra el día 4 con cierre 20 → resumen
del mes siguiente; el día 25 → dos meses después; 12 cuotas desde diciembre terminan en
enero del año +2 y suman exactamente el total.

## Reglas de negocio que no son obvias

- **El pago del resumen de la tarjeta no se carga como gasto.** El total de una tarjeta
  en un mes ya es la suma de sus cuotas; cargarlo aparte duplicaría todo. En la planilla
  vieja esto pasaba y los totales estaban inflados.
- **Categoría y persona son ejes distintos.** La planilla vieja mezclaba "Super"/"Casa"
  con "Dani"/"Valen". Las categorías son una lista fija (`CATS` en `index.html`), nunca
  texto libre. Los medios de pago sí se editan desde la app.
- **No hay ingresos.** Solo gastos, a propósito. Agregarlos requiere una columna `tipo`
  en `mov` y sumar/restar en los totales.
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
- **La fecha de hoy se calcula distinto en el frontend y en el Worker, a propósito.**
  `hoyISO()` en `index.html` usa los componentes locales del navegador
  (`getFullYear/getMonth/getDate`), porque el celular ya está en hora argentina.
  `mesActualAR()` en `src/servicios.mjs` resta 3 horas a mano, porque el Worker corre en
  servidores en UTC. No unificar esto en un `toISOString()` — en uno de los dos entornos
  daría la fecha equivocada cerca de la medianoche.

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

- Editar un gasto ya cargado (hoy solo se puede borrar).
- Editar un servicio ya creado desde la app (hoy solo se puede dar de baja).
- Reactivar un servicio dado de baja sin entrar a la base a mano.
- Conciliar contra el resumen real de la tarjeta.
- Importar el CSV del resumen de Visa.
