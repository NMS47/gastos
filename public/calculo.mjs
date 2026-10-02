// Aritmética pura del presupuesto. Sin DOM, sin red: testeable con `node --test`.
// Vive en public/ y no en src/ porque el [assets] de Cloudflare solo sirve esa
// carpeta: un módulo en src/ el navegador no lo puede pedir.

export const ym = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

// En qué resumen cae cada cuota de una compra.
// Debito o efectivo: impacta el mismo dia. Credito: si el dia de compra es <= cierre
// entra en el resumen del mes siguiente, si no en el subsiguiente; cada cuota suma un
// mes mas. La ultima cuota absorbe el redondeo para que la suma de exacta.
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
// cascada() tambien filtra por mes y tiene que tratar una fecha rota igual que acá.
export const mesDe = f =>
  (typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.slice(0, 7) : null);

// Cuanto se consumio de cada categoria en `mes`, por FECHA DE COMPRA y por el monto
// completo: una compra en 12 cuotas consume el total en el mes que se decidio.
// La barra mide plata comprometida, no plata que salio, asi que un `pendiente`
// cuenta — al contrario del total del mes. Un `omitido` no.
// La clave "" junta los gastos sin categoria: son la bandeja de entrada.
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
// generarDelMes() en el Worker. Para un mes futuro todavia no existen, asi que hay que
// proyectarlos. Sin esto, navegar al mes que viene muestra una cascada sin luz, sin gas
// y sin las cuotas de las deudas, o sea muchisimo mas optimista de lo que es.
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

// Las lineas del mes. La regla unica: si una categoria tiene tope se reserva el tope
// completo y todo lo de esa categoria lo consume; si no tiene tope se resta lo
// determinado tal cual. Un gasto de credito ya esta contado en la linea de tarjeta del
// mes en que se paga, asi que no se resta de nuevo como caja.
export function cascada({ movs, cuentas, ingresos, servicios, topes }, mes, mesCorriente) {
  const total = ingresos.filter(i => vigenteEn(i, mes)).reduce((a, i) => a + i.monto, 0);
  const todos = movsDelMes(movs, servicios, mes, mesCorriente);

  const credito = new Map(cuentas.filter(c => c.tipo === "credito").map(c => [c.id, c]));
  const familiar = m => m.ambito !== "personal" && m.estado !== "omitido";

  // El resumen que se paga en `mes`: las cuotas que caen acá, mas base_pago si ese
  // resumen todavia no se pago. base_cuotas nunca entra: la app no conoce su cronograma,
  // asi que repartirlo por mes seria inventar. Ver la spec.
  let tarjeta = 0;
  for (const m of todos) {
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

  // Caja de las categorias sin tope. Solo debito y efectivo: lo de credito ya esta
  // en `tarjeta`, sumarlo acá lo contaria dos veces en la misma moneda.
  // La bandeja, en cambio, lista TODOS los sin categoria del mes sin importar el medio:
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
  // Math.floor para que 2 * cadaUno nunca sea mas que lo que hay: el peso impar
  // queda sin repartir en vez de aparecer de la nada.
  const cadaUno = queda > 0 ? Math.floor(queda / 2) : 0;

  // Siempre las dos claves, siempre numero: la UI muestra dos filas y nunca una tercera.
  const personal = { nico: 0, dani: 0 };
  for (const m of todos) {
    if (m.ambito !== "personal" || mesDe(m.fecha) !== mes) continue;
    personal[m.quien === "dani" ? "dani" : "nico"] += m.monto;
  }

  return { ingresos: total, tarjeta, sinTope, totalSinTope,
           topes: conTope, totalTopes, sinCategoria, queda, cadaUno, personal };
}
