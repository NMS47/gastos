// Aritmética pura del presupuesto. Sin DOM, sin red: testeable con `node --test`.
// Vive en public/ y no en src/ porque el [assets] de Cloudflare solo sirve esa
// carpeta: un módulo en src/ el navegador no lo puede pedir.

export const ym = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

// En qué resumen cae cada cuota de una compra.
// Débito o efectivo: impacta el mismo día. Crédito: si el día de compra es <= cierre
// entra en el resumen del mes siguiente, si no en el subsiguiente; cada cuota suma un
// mes más. La última cuota absorbe el redondeo para que la suma dé exacta.
export function impactos(mov, cuenta) {
  const d = new Date(mov.fecha + "T12:00:00");
  if (!cuenta || cuenta.tipo !== "credito")
    return [{ mes: ym(d), monto: mov.monto, nro: 1, de: 1 }];

  const mesCiclo = d.getMonth() + (d.getDate() <= (cuenta.cierre || 20) ? 1 : 2);
  const n = mov.cuotas || 1, base = Math.round(mov.monto / n), out = [];
  for (let i = 0; i < n; i++) {
    const f = new Date(d.getFullYear(), mesCiclo + i, 1);
    out.push({ mes: ym(f), nro: i + 1, de: n,
      monto: i === n - 1 ? mov.monto - base * (n - 1) : base });
  }
  return out;
}

// Un servicio o un ingreso corre en `mes`?
// `hasta` es un final previsto desde el alta; `activo = 0` es una baja decidida
// en el camino. Hacen falta los dos: ver la spec.
export function vigenteEn(fila, mes) {
  if (!fila.activo) return false;
  if (fila.desde > mes) return false;
  if (fila.hasta && fila.hasta < mes) return false;
  return true;
}

// El mes de una fecha "YYYY-MM-DD", o null si la fecha no sirve. Exportada porque
// cascada() también filtra por mes y tiene que tratar una fecha rota igual que acá.
export const mesDe = f =>
  (typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.slice(0, 7) : null);

// Cuánto se consumió de cada categoría en `mes`, por FECHA DE COMPRA y por el monto
// completo: una compra en 12 cuotas consume el total en el mes que se decidió.
// La barra mide plata comprometida, no plata que salió, así que un `pendiente`
// cuenta — al contrario del total del mes. Un `omitido` no.
// La clave "" junta los gastos sin categoría: son la bandeja de entrada.
export function consumos(movs, mes) {
  const out = {};
  for (const m of movs) {
    if (m.ambito === "personal") continue;
    if (m.estado === "omitido") continue;
    if (mesDe(m.fecha) !== mes) continue;
    const k = m.cat || "";
    out[k] = (out[k] || 0) + m.monto;
  }
  return out;
}

export function diasDelMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function fechaDeServicio(mes, dia) {
  const d = Math.min(Math.max(parseInt(dia) || 1, 1), diasDelMes(mes));
  return mes + "-" + String(d).padStart(2, "0");
}

// Los servicios del mes corriente ya existen como filas en mov: los genera
// generarDelMes() en el Worker. Para un mes futuro todavía no existen, así que hay que
// proyectarlos. Sin esto, navegar al mes que viene muestra una cascada sin luz, sin gas
// y sin las cuotas de las deudas, o sea muchísimo más optimista de lo que es.
export function movsDelMes(movs, servicios, mes, mesCorriente) {
  if (mes <= mesCorriente) return movs;
  const yaEstan = new Set(
    movs.filter(m => m.servicio_id && mesDe(m.fecha) === mes).map(m => m.servicio_id));
  const proyectados = servicios
    .filter(s => vigenteEn(s, mes) && !yaEstan.has(s.id))
    .map(s => ({
      id: "proy" + s.id + "-" + mes,
      fecha: fechaDeServicio(mes, s.dia),
      descripcion: s.nombre, monto: s.monto, cuenta_id: s.cuenta_id, cuotas: 1,
      cat: s.cat, quien: null, servicio_id: s.id,
      estado: s.modo === "auto" ? "pagado" : "pendiente",
      proyectado: true
    }));
  return movs.concat(proyectados);
}

// Un mes más (o menos, con n negativo) que `mes`, en formato "YYYY-MM".
const ymMas = (mes, n) => {
  const [y, m] = mes.split("-").map(Number);
  return ym(new Date(y, m - 1 + n, 1));
};

// Proyecta no solo `mes`, sino cada mes entre mesCorriente+1 y `mes` (los dos inclusive).
// La tarjeta lo necesita: una compra con tarjeta de crédito no impacta en el mes en que
// se decide, sino uno o dos meses después, según el cierre. Pedirle a movsDelMes
// proyección solo de `mes` deja afuera la compra del mes anterior que es justamente la
// que cae en el resumen de `mes` — por eso un servicio de tarjeta desaparecía de la
// cascada a partir de mesCorriente + 2. Fuera de la tarjeta nadie necesita este rango:
// los topes y la bandeja miden por fecha de compra dentro de `mes` nomás, así que siguen
// usando movsDelMes de un solo mes.
export function movsHastaMes(movs, servicios, mes, mesCorriente) {
  if (mes <= mesCorriente) return movs;
  let out = movs;
  for (let m = ymMas(mesCorriente, 1); m <= mes; m = ymMas(m, 1))
    out = movsDelMes(out, servicios, m, mesCorriente);
  return out;
}

// Las líneas del mes. La regla única: si una categoría tiene tope se reserva el tope
// completo y todo lo de esa categoría lo consume; si no tiene tope se resta lo
// determinado tal cual. Un gasto de crédito ya está contado en la línea de tarjeta del
// mes en que se paga, así que no se resta de nuevo como caja.
export function cascada({ movs, cuentas, ingresos, servicios, topes }, mes, mesCorriente) {
  const total = ingresos.filter(i => vigenteEn(i, mes)).reduce((a, i) => a + i.monto, 0);
  const todos = movsDelMes(movs, servicios, mes, mesCorriente);

  const credito = new Map(cuentas.filter(c => c.tipo === "credito").map(c => [c.id, c]));
  const familiar = m => m.ambito !== "personal" && m.estado !== "omitido";

  // El resumen que se paga en `mes`: las cuotas que caen acá, más base_pago si ese
  // resumen todavía no se pagó. base_cuotas nunca entra: la app no conoce su cronograma,
  // así que repartirlo por mes sería inventar. Ver la spec.
  // Usa movsHastaMes, no `todos`: un servicio de tarjeta de un mes intermedio (entre
  // mesCorriente y `mes`) todavía no tiene fila propia, y sin proyectarlo impactos() no
  // tiene nada que ubicar en el resumen de `mes`.
  const todosTarjeta = movsHastaMes(movs, servicios, mes, mesCorriente);
  let tarjeta = 0;
  for (const m of todosTarjeta) {
    const c = credito.get(m.cuenta_id);
    if (!c || !familiar(m) || !mesDe(m.fecha)) continue;
    for (const i of impactos(m, c)) if (i.mes === mes) tarjeta += i.monto;
  }
  for (const c of credito.values())
    if (c.base_pago && (!c.pagado_hasta || c.pagado_hasta < mes)) tarjeta += c.base_pago;

  const porCat = consumos(todos, mes);
  const conTope = topes.map(t => ({ cat: t.cat, tope: t.monto, consumido: porCat[t.cat] || 0 }));
  const totalTopes = conTope.reduce((a, t) => a + t.tope, 0);
  const catsConTope = new Set(topes.map(t => t.cat));

  // Caja de las categorías sin tope. Solo débito y efectivo: lo de crédito ya está
  // en `tarjeta`, sumarlo acá lo contaría dos veces en la misma moneda.
  // La bandeja, en cambio, lista TODOS los sin categoría del mes sin importar el medio:
  // se quieren clasificar igual, se hayan pagado como se hayan pagado.
  const sinTopeMap = {};
  const sinCategoria = [];
  for (const m of todos) {
    if (!familiar(m) || mesDe(m.fecha) !== mes) continue;
    if (!m.cat && !m.proyectado) sinCategoria.push(m);
    if (catsConTope.has(m.cat)) continue;
    const c = cuentas.find(x => x.id === m.cuenta_id);
    if (c && c.tipo === "credito") continue;
    const k = m.cat || "";
    sinTopeMap[k] = (sinTopeMap[k] || 0) + m.monto;
  }
  const sinTope = Object.entries(sinTopeMap).map(([cat, monto]) => ({ cat, monto }));
  const totalSinTope = sinTope.reduce((a, s) => a + s.monto, 0);

  const queda = total - tarjeta - totalSinTope - totalTopes;
  // Math.floor para que 2 * cadaUno nunca sea más que lo que hay: el peso impar
  // queda sin repartir en vez de aparecer de la nada.
  const cadaUno = queda > 0 ? Math.floor(queda / 2) : 0;

  // Siempre las dos claves, siempre número: la UI muestra dos filas y nunca una tercera.
  const personal = { nico: 0, dani: 0 };
  for (const m of todos) {
    if (m.ambito !== "personal" || mesDe(m.fecha) !== mes) continue;
    personal[m.quien === "dani" ? "dani" : "nico"] += m.monto;
  }

  return { ingresos: total, tarjeta, sinTope, totalSinTope,
           topes: conTope, totalTopes, sinCategoria, queda, cadaUno, personal };
}

// Ancho de una barra en porcentaje. Un tope en 0 significa "no se toca": la barra
// va llena si hubo consumo y vacía si no, en vez de dividir por cero.
export function anchoBarra(consumido, tope) {
  if (!tope) return consumido > 0 ? 100 : 0;
  return Math.min(100, Math.round(consumido / tope * 100));
}

// El punto y la coma no son intercambiables en es-AR, aunque esta app casi nunca
// muestre decimales (CLAUDE.md: "Montos con toLocaleString('es-AR'), sin decimales").
// Regla completa, en orden:
//   1. Se descartan los espacios y TODOS los puntos: el punto siempre es separador de
//      miles ("1.700.000" es un millón setecientos mil), nunca decimal.
//   2. Si el string termina en una coma seguida de 1 o 2 dígitos, esa es la coma
//      decimal real (p. ej. "600,50" pegado de un resumen de banco): se descartan
//      TODAS LAS DEMÁS comas que aparezcan antes de ella — son de miles, no otro
//      decimal — y recién esa última coma se convierte en punto.
//   3. Si no termina así (la sigue 0, o 3 o más dígitos, o no hay coma al final), no
//      hay decimal: se descartan todas las comas, todas son de miles.
// El paso 2 es el que faltó en la vuelta anterior: se convertía la última coma pero se
// dejaban las comas previas sueltas, así que "1,234,50" quedaba "1,234.50" y
// parseFloat cortaba en la primera coma y devolvía 1 en vez de 1234.5 — mal
// silenciosamente, sin error y sin dar 0, el peor tipo de bug en una app de plata.
export function parseMonto(v) {
  if (!v) return 0;
  let s = String(v).trim().replace(/\s/g, "").replace(/\./g, "");
  const decimal = s.match(/,(\d{1,2})$/);
  s = decimal
    ? s.slice(0, decimal.index).replace(/,/g, "") + "." + decimal[1]
    : s.replace(/,/g, "");
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : 0;
}

// El signo va antes del símbolo de pesos, no entre el símbolo y el número: "-$200.000",
// no "$-200.000". El número más importante de la cascada (cuánto queda para repartir)
// se vuelve negativo justo cuando el mes no cubre sus compromisos, así que es lo primero
// que ve alguien en ese caso, y "$-200.000" lee como un error de la app.
export function fmt(n) {
  const r = Math.round(n);
  return (r < 0 ? "-$" : "$") + Math.abs(r).toLocaleString("es-AR");
}
