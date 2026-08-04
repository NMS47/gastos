# Gastos

App de gastos para dos personas. Frontend estático + API en Cloudflare Pages Functions + base D1.
Todo dentro del plan gratuito: 100.000 requests/día en Functions, 5 GB y 100.000 escrituras/día en D1, sin pausas por inactividad.

```
public/index.html          la app entera (una sola pantalla, 3 pestañas)
public/manifest.json       para instalarla en el celular
functions/api/[[path]].js  la API
schema.sql                 las dos tablas + los medios de pago iniciales
wrangler.toml              config del proyecto y el binding a D1
```

## Deploy (una sola vez, ~15 minutos)

**1. Subir a GitHub**

```bash
cd gastos-app
git init && git add . && git commit -m "gastos"
git remote add origin git@github.com:USUARIO/gastos.git
git push -u origin main
```

El repo puede ser privado; Cloudflare lo lee igual.

**2. Crear la base**

```bash
npm install -D wrangler
npx wrangler login
npx wrangler d1 create gastos
```

Copiá el `database_id` que imprime y pegalo en `wrangler.toml`. Después:

```bash
npx wrangler d1 execute gastos --remote --file=./schema.sql
```

**3. Conectar el proyecto**

Cloudflare dashboard → *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → elegí el repo.
Build command: **vacío**. Build output directory: **`public`**.

Hacé commit del `wrangler.toml` con el `database_id` ya pegado y volvé a pushear; el binding `DB` sale de ahí.
Si preferís hacerlo a mano: *Settings* → *Bindings* → *D1 database*, variable `DB` → base `gastos`.

**4. Poner el PIN**

*Settings* → *Variables and Secrets* → agregá `PIN` con el valor que quieran (tipo secret).
La API rechaza cualquier request sin ese PIN. La app lo pide una vez por teléfono y lo guarda.

Si tenés un dominio propio en Cloudflare, la alternativa mejor es Cloudflare Access (gratis hasta 50 usuarios): login con Google y sólo los mails de ustedes dos entran, sin PIN. Sobre `*.pages.dev` también se puede, pero la configuración es más molesta.

**5. En el celular**

Abrí `https://gastos.pages.dev` (o tu dominio) → *Compartir* → *Agregar a pantalla de inicio*.
Queda como una app: se abre en la pestaña de carga con el teclado numérico listo.

## Cómo funciona

Un gasto se guarda **una sola vez**, con su fecha de compra. El mes en que impacta se calcula al mostrar:

- Medio de débito, efectivo o billetera → impacta el día de la compra.
- Tarjeta de crédito → si comprás hasta el día de cierre entra en ese resumen, si no en el siguiente; cada cuota suma un mes más.

Por eso las cuotas no se cargan a mano: cargás "Fravega, $830.000, 12 cuotas, Visa" y aparece sola en los 12 meses que corresponde, marcada `4/12`. Cambiar el día de cierre de una tarjeta recalcula todo lo viejo.

El pago del resumen de la tarjeta **no se carga como gasto**: el total de la tarjeta en un mes ya es la suma de sus cuotas. Si lo cargaras, contarías el mismo gasto dos veces.

## Cambios comunes

- **Categorías**: la lista está en `CATS`, arriba del `<script>` en `index.html`.
- **Medios de pago**: se agregan y borran desde la app, en la pestaña *Medios*. La estrella marca el que viene seleccionado por defecto.
- **Ingresos**: no están. Si los querés, hace falta una columna `tipo` en `mov` y sumar/restar según corresponda.
