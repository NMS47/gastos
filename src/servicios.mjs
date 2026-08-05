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

export function diasDelMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function fechaDeServicio(mes, dia) {
  const d = Math.min(Math.max(parseInt(dia) || 1, 1), diasDelMes(mes));
  return mes + "-" + String(d).padStart(2, "0");
}

export function estadoInicial(modo) {
  return modo === "auto" ? "pagado" : "pendiente";
}
