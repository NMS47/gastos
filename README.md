# Gastos

App de gastos para dos personas: un Worker de Cloudflare que sirve el frontend estático
y atiende la API, con datos en D1. Todo dentro del plan gratuito.

```
public/index.html        la app (una sola pantalla, 4 pestañas)
public/manifest.json     para instalarla en el celular
src/index.js             Worker: sirve /public y atiende /api/*
schema.sql               las tres tablas + medios de pago iniciales
migracion-servicios.sql  servicios recurrentes, ya aplicada
wrangler.toml            config y bindings (D1 y assets)
```

## Deploy (una sola vez)

**1. Subir a GitHub** (si ya lo hiciste con la versión anterior, solo hace falta
reemplazar los archivos viejos por estos y pushear de nuevo).

```powershell
git add .
git commit -m "worker con assets"
git push
```

**2. Crear la base D1** (si ya la creaste antes, saltealo y anotá el ID que ya tenés)

```powershell
npm install -D wrangler
npx wrangler login
npx wrangler d1 create gastos
```

Copiá el `database_id` que imprime y pegalo en `wrangler.toml`, reemplazando el texto
`PEGAR-ACA-EL-ID-QUE-DEVUELVE-WRANGLER`. Commiteá y pusheá ese cambio.

```powershell
npx wrangler d1 execute gastos --remote --file=./schema.sql
```

**3. Crear el proyecto en Cloudflare**

Si ya existe un proyecto viejo tipo "solo assets", borralo. Dashboard →
**Workers & Pages → Create → Import a repository** (o "Create Worker" → conectar Git) →
elegí `gastos`. Cloudflare detecta el `wrangler.toml` y usa `main = "src/index.js"`
y `[assets] directory = "public"` automáticamente — no hace falta tocar build command.

**4. Poner el PIN**

Dashboard → tu Worker → **Settings → Variables and Secrets → Add** → nombre `PIN`,
tipo Secret, el valor que quieran. La API rechaza cualquier request sin ese PIN;
la app lo pide una vez por teléfono y lo guarda.

**5. En el celular**

Abrí la URL del Worker → *Compartir* → *Agregar a pantalla de inicio*.

## Cómo funciona

Un gasto se guarda una sola vez, con su fecha de compra. El mes en que impacta se
calcula al mostrar: débito/efectivo impacta el día de la compra; tarjeta de crédito
entra en el resumen según el día de cierre, y cada cuota suma un mes más. El pago del
resumen no se carga como gasto — el total de la tarjeta ya es la suma de sus cuotas.

## Cambios comunes

- **Categorías**: lista `CATS` en `public/index.html`.
- **Medios de pago**: se agregan/borran desde la pestaña *Medios* de la app.
