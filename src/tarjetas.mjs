// Lógica pura de tarjetas de crédito. Sin D1, sin fetch: testeable con `node --test`.
import { hoyAR } from "./servicios.mjs";

// El mes que impactos() le asigna al último resumen que YA cerró.
// Con cierre 20: el 5 de agosto el último resumen cerró el 20 de julio, y sus compras
// caen en el resumen de agosto → "2026-08". El 25 de agosto ya cerró el del 20 de
// agosto, que es el resumen de septiembre → "2026-09".
export function mesResumenCerrado(cierre, ahora = new Date()) {
  const d = hoyAR(ahora);
  const salto = d.getUTCDate() <= cierre ? 0 : 1;
  const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + salto, 1));
  return f.getUTCFullYear() + "-" + String(f.getUTCMonth() + 1).padStart(2, "0");
}
