# Gastos — contexto del proyecto

App de gastos personales para dos personas (Nico y Dani), en español rioplatense.
Reemplaza una planilla Excel con una hoja por mes que se volvió inmanejable.

## Stack

Un solo Worker de Cloudflare. Sin framework, sin build step, sin dependencias en runtime.

```
public/index.html    la app entera: HTML + CSS + JS vanilla en un archivo
public/manifest.json PWA, para instalarla en el celular
src/index.js         Worker: sirve /public via env.ASSETS y atiende /api/*
schema.sql           tablas cuenta y mov + medios de pago iniciales
migracion-quien.sql  ALTER TABLE suelto, ya aplicado
wrangler.toml        main + [assets] + binding D1 (DB) + secret PIN
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

mov(id, fecha, descripcion, monto, cuenta_id, cuotas, cat, quien, creado)
  fecha: YYYY-MM-DD, cuándo se hizo la compra
  quien: 'nico' | 'dani', para pintar la fila
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
- Conciliar contra el resumen real de la tarjeta.
- Importar el CSV del resumen de Visa.
