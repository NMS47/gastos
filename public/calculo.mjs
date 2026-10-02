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
