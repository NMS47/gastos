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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, "..", "public", "index.html");

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

function instalarStubsDeNavegador() {
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
  // Rechaza siempre: api() la atrapa con su propio try/catch (boot también tiene el
  // suyo), así que esto no debería dejar ninguna promesa sin atrapar.
  globalThis.fetch = () => Promise.reject(new Error("fetch no disponible en el smoke test"));
  globalThis.window = globalThis;
  globalThis.confirm = () => false;
  globalThis.prompt = () => null;
}

test('el <script type="module"> de index.html evalúa sin explotar (modo estricto)', async () => {
  instalarStubsDeNavegador();

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
    // boot() sigue corriendo de fondo después de que el import termina (el fetch
    // rechaza, se atrapa, y sigue con fillSelects/render*). Le damos una vuelta al
    // event loop para que, si algo ahí explota, lo agarre el listener de arriba
    // mientras el test todavía está corriendo, en vez de escaparse después.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.off("unhandledRejection", onRejection);
    rmSync(tempPath, { force: true });
  }

  assert.deepEqual(erroresNoControlados, []);
});
