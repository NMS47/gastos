import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Humo del frontend: al convertir index.html a <script type="module"> el bloque pasa a
// ejecutarse en modo estricto, cosa que un <script> normal no exigía. Una asignación a
// una variable no declarada, un parámetro duplicado, un octal, etc. que antes se toleraba
// en silencio ahora tira al evaluar. No hay DOM real en `node --test`, así que este test
// no verifica que la UI se vea bien: solo que el módulo se pueda evaluar sin explotar.
// Sirve para index.html hoy y para cualquier script de frontend futuro (tareas 9 a 14)
// que se quiera sumar a esta misma red.
//
// IMPORTANTE: el `fetch` de mentira resuelve con datos reales (no rechaza). Si rechazara,
// boot() cae directo al catch y cuentas/movs quedan en [] toda la corrida: fillSelects,
// renderLoad, renderMonth y usoDeCuenta se ejecutarían, pero sus imp()/impactos() nunca
// se llamarían de verdad porque los forEach serían sobre arrays vacíos. Este test existe
// específicamente para ejercitar esos call sites, así que el mock de abajo tiene que
// darles datos: una cuenta de crédito con cierre, un gasto en cuotas sobre ella, un
// servicio pendiente y uno omitido.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, "..", "public", "index.html");

// `ingresos.desde/hasta` y `cursor` en el frontend son del mes real en que corre el test
// (cursor = new Date()), así que para que vigenteEn() los encuentre vigentes de verdad
// (tarea 9, rama de highlight de renderPlan) estos valores tienen que ser relativos a
// hoy, no un "2026-09" fijo que el año que viene ya sería pasado o futuro sin que nadie
// haya tocado este archivo.
const pad2 = n => String(n).padStart(2, "0");
const hoy = new Date();
const mesActual = `${hoy.getFullYear()}-${pad2(hoy.getMonth() + 1)}`;
const haceUnAnio = new Date(hoy.getFullYear() - 1, hoy.getMonth(), 1);
const mesHaceUnAnio = `${haceUnAnio.getFullYear()}-${pad2(haceUnAnio.getMonth() + 1)}`;

// Payload de /api/state, con los mismos nombres de columna que devuelve `SELECT *` en
// src/index.js (ver schema.sql y migracion-presupuesto.sql: mov tiene `ambito`, servicio
// tiene `hasta`). Un solo objeto acá arriba para que sea fácil sumarle `ingresos`/`topes`
// cuando las tareas 6, 7 y 9 los agreguen a la respuesta real.
const ESTADO_MOCK = {
  cuentas: [
    { id: "ef", nombre: "Efectivo", tipo: "debito", cierre: null, venc: null, def: 0,
      limite_pago: null, limite_cuotas: null, base_pago: 0, base_cuotas: 0, pagado_hasta: null },
    // def:1 a propósito: fillSelects() deja esta cuenta preseleccionada en el <select>,
    // así renderLoad() entra sola a la rama esCred sin que el test tenga que simular un
    // click. Con cierre:20 ejercita exactamente el umbral que impactos() decide.
    { id: "vi", nombre: "Visa", tipo: "credito", cierre: 20, venc: 5, def: 1,
      limite_pago: null, limite_cuotas: null, base_pago: 0, base_cuotas: 0, pagado_hasta: null },
  ],
  movs: [
    // Débito, una sola cuota: pasa por la rama no-crédito de impactos().
    { id: "m1", fecha: "2026-09-15", descripcion: "Supermercado", monto: 5000, cuenta_id: "ef",
      cuotas: 1, cat: "Supermercado", quien: "nico", servicio_id: null, estado: null,
      creado: "2026-09-15T10:00:00.000Z", ambito: null },
    // Crédito en 6 cuotas: el único mov que de verdad hace recorrer el loop de cuotas de
    // impactos() dentro de renderMonth (filas y fut) y de usoDeCuenta.
    { id: "m2", fecha: "2026-09-10", descripcion: "Heladera", monto: 300000, cuenta_id: "vi",
      cuotas: 6, cat: "Hogar", quien: "dani", servicio_id: null, estado: null,
      creado: "2026-09-10T12:00:00.000Z", ambito: null },
    // Generado por un servicio manual, todavía sin pagar: no suma a sumaAlTotal, pero
    // ejercita la rama de servicios pendientes en renderServicios.
    { id: "sv-srv1-2026-09", fecha: "2026-09-25", descripcion: "Netflix", monto: 4000,
      cuenta_id: "vi", cuotas: 1, cat: "Suscripciones", quien: null, servicio_id: "srv1",
      estado: "pendiente", creado: "2026-09-01T00:00:00.000Z", ambito: null },
    // Generado por un servicio y salteado ese mes: ejercita la rama "omitido".
    { id: "sv-srv2-2026-09", fecha: "2026-09-05", descripcion: "Gimnasio", monto: 8000,
      cuenta_id: "ef", cuotas: 1, cat: "Salud", quien: null, servicio_id: "srv2",
      estado: "omitido", creado: "2026-09-01T00:00:00.000Z", ambito: null },
  ],
  servicios: [
    { id: "srv1", nombre: "Netflix", monto: 4000, dia: 25, cuenta_id: "vi", cat: "Suscripciones",
      modo: "manual", activo: 1, desde: "2026-01", creado: "2026-01-01T00:00:00.000Z", hasta: null },
    { id: "srv2", nombre: "Gimnasio", monto: 8000, dia: 5, cuenta_id: "ef", cat: "Salud",
      modo: "manual", activo: 1, desde: "2026-01", creado: "2026-01-01T00:00:00.000Z", hasta: null },
  ],
  // Tarea 9 (renderPlan): tres ingresos para que corran las tres ramas de la lista —
  // recurrente y vigente (se resalta), único de este mes (etiqueta "solo <mes>") y uno
  // dado de baja (etiqueta "de baja", y no vigente por más que su `desde` ya haya
  // empezado). Y dos topes: uno de una categoría real (Supermercado) y uno de una
  // categoría que ya no está en CATS, para ejercitar la etiqueta "vieja" que permite
  // sacarlo.
  ingresos: [
    { id: "ing1", nombre: "Sueldo", monto: 1500000, dia: 5, desde: mesHaceUnAnio, hasta: null,
      activo: 1, creado: "2026-01-01T00:00:00.000Z" },
    { id: "ing2", nombre: "Aguinaldo", monto: 700000, dia: 18, desde: mesActual, hasta: mesActual,
      activo: 1, creado: "2026-01-01T00:00:00.000Z" },
    { id: "ing3", nombre: "Changa vieja", monto: 50000, dia: 1, desde: mesHaceUnAnio, hasta: null,
      activo: 0, creado: "2026-01-01T00:00:00.000Z" },
  ],
  topes: [
    { cat: "Supermercado", monto: 600000 },
    { cat: "Delivery", monto: 30000 },
  ],
};

// Saca el cuerpo del único <script type="module"> de index.html. Si en algún momento
// hay más de uno, mejor que este test explote con un mensaje claro a que elija el
// bloque equivocado en silencio.
function extraerScriptModulo(html) {
  const bloques = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.equal(bloques.length, 1,
    `index.html debería tener un solo <script type="module">; este test necesita ` +
    `actualizarse si eso cambió (encontré ${bloques.length}).`);
  return bloques[0][1];
}

// Un elemento DOM de mentira. Las propiedades que el frontend realmente lee y escribe
// (value, textContent, innerHTML, hidden, disabled, checked, dataset, options) guardan
// lo que les asignen, como un elemento real. Cualquier otra propiedad — classList,
// closest, querySelector, style, lo que sea que agregue una tarea futura — devuelve otro
// elemento de mentira encadenable o un no-op, así nunca explota por "no es función" ni
// por leer una propiedad de undefined. Por diseño no hace falta tocarlo cuando el
// frontend crezca.
function fakeElement() {
  const estado = {
    value: "", textContent: "", innerHTML: "", className: "",
    hidden: false, disabled: false, checked: false,
    dataset: {}, options: { length: 0 }, style: {},
  };
  const base = () => fakeElement();
  return new Proxy(base, {
    get(_t, prop) {
      if (prop in estado) return estado[prop];
      switch (prop) {
        case "addEventListener":
        case "removeEventListener":
        case "setAttribute":
        case "removeAttribute":
        case "appendChild":
        case "after":
        case "remove":
        case "focus":
        case "select":
        case "click":
          return () => {};
        case "getAttribute":
          return () => null;
        case "closest":
        case "querySelector":
          return () => fakeElement();
        case "querySelectorAll":
          return () => [];
        case "classList":
          return { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
        case "selectedOptions":
          return [{ text: "" }];
        case "nextElementSibling":
          return null;
        case Symbol.toPrimitive:
          return (hint) => (hint === "number" ? 0 : "");
        default:
          return fakeElement();
      }
    },
    set(_t, prop, value) {
      estado[prop] = value;
      return true;
    },
    apply() {
      return fakeElement();
    },
  });
}

// Instala los stubs globales y devuelve getElementById para que el test, antes de
// importar, pueda precargar algún input como lo haría una persona tipeando.
function instalarStubsDeNavegador(estadoMock) {
  const cache = new Map();
  const getElementById = (id) => {
    if (!cache.has(id)) cache.set(id, fakeElement());
    return cache.get(id);
  };
  globalThis.document = {
    getElementById,
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
    addEventListener: () => {},
  };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  // Resuelve con datos reales: api() espera un objeto con status/ok/json(), como un
  // Response de verdad. boot() necesita que esto resuelva (no que rechace) para que
  // cuentas/movs/servicios se llenen y los render* corran con datos.
  globalThis.fetch = () => Promise.resolve({
    status: 200, ok: true,
    json: () => Promise.resolve(estadoMock),
  });
  globalThis.window = globalThis;
  globalThis.confirm = () => false;
  globalThis.prompt = () => null;
  return { getElementById };
}

// boot() no se exporta ni se puede await-ear desde afuera: es un fire-and-forget al
// final del script. Como ahora el fetch resuelve (no rechaza), hay una cadena real de
// promesas después del import() (await fetch → await r.json() → await api() en boot())
// antes de que corran fillSelects/renderLoad/renderMonth/renderServicios/renderAcc. Un
// setTimeout de un número fijo de ms sería una carrera contra esa cadena. En cambio,
// esto le da vueltas al event loop encadenando setImmediate: cada vuelta vacía la cola de
// microtasks pendiente antes de la siguiente, así que después de unas pocas vueltas la
// cadena de boot() —que es de 3-4 saltos— ya terminó. Está acotado (no es un while
// infinito) pero no es un reloj: no le importa cuánto tiempo real pasa, solo que el loop
// dé suficientes vueltas.
async function drenarEventLoop(vueltas = 30) {
  for (let i = 0; i < vueltas; i++) await new Promise((r) => setImmediate(r));
}

async function evaluarScriptFrontend(estadoMock, { precargarForm } = {}) {
  const { getElementById } = instalarStubsDeNavegador(estadoMock);
  if (precargarForm) precargarForm(getElementById);

  const html = readFileSync(indexPath, "utf8");
  const codigo = extraerScriptModulo(html);

  // Se escribe dentro de public/ — no en un directorio temporal cualquiera — para que
  // el import relativo "./calculo.mjs" del script resuelva contra el módulo real. El
  // nombre lleva un uuid para no pisar nada si corre más de una vez en paralelo.
  const tempPath = path.join(__dirname, "..", "public", `.frontend-smoke-${randomUUID()}.mjs`);
  writeFileSync(tempPath, codigo);

  const erroresNoControlados = [];
  const onRejection = (err) => erroresNoControlados.push(err);
  process.on("unhandledRejection", onRejection);

  try {
    await import(pathToFileURL(tempPath).href);
    await drenarEventLoop();
  } finally {
    process.off("unhandledRejection", onRejection);
    rmSync(tempPath, { force: true });
  }

  return erroresNoControlados;
}

test('el <script type="module"> de index.html evalúa sin explotar (modo estricto, con datos reales)', async () => {
  const errores = await evaluarScriptFrontend(ESTADO_MOCK, {
    // Nadie tipeó nada en el form de "Cargar": sin esto, $("monto").value sigue en ""
    // y renderLoad() nunca llama a impactos() aunque la cuenta preseleccionada sea de
    // crédito. Simula que ya hay un monto y una cantidad de cuotas cargados.
    precargarForm: (getElementById) => {
      getElementById("monto").value = "9000";
      getElementById("cuotas").value = "3";
    },
  });
  assert.deepEqual(errores, []);
});
