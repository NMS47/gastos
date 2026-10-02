// Lógica pura de servicios recurrentes. Sin D1, sin fetch: testeable con `node --test`.

// Argentina no aplica horario de verano, siempre UTC-3.
const OFFSET_AR_MS = 3 * 60 * 60 * 1000;

// Un Date corrido a hora argentina, para leerlo con los getters getUTC*.
export function hoyAR(ahora = new Date()) {
  return new Date(ahora.getTime() - OFFSET_AR_MS);
}

export function mesActualAR(ahora = new Date()) {
  const d = hoyAR(ahora);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

// Viven en public/calculo.mjs porque el frontend tambien las necesita y no puede
// importar de src/. El Worker si puede importar de public/: wrangler lo bundlea.
export { diasDelMes, fechaDeServicio } from "../public/calculo.mjs";

export function estadoInicial(modo) {
  return modo === "auto" ? "pagado" : "pendiente";
}
