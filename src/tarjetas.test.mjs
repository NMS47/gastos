import test from "node:test";
import assert from "node:assert/strict";
import { mesResumenCerrado } from "./tarjetas.mjs";

test("antes del cierre, el último resumen cerrado es el del mes corriente", () => {
  // 5 de agosto, cierre 20: el último resumen cerró el 20 de julio y contiene
  // compras del 21/6 al 20/7. Una compra del 10/7 cae, según impactos(), en el
  // resumen de agosto.
  assert.equal(mesResumenCerrado(20, new Date("2026-08-05T15:00:00Z")), "2026-08");
});

test("después del cierre, el último resumen cerrado es el del mes siguiente", () => {
  // 25 de agosto, cierre 20: cerró el del 20 de agosto, que es el resumen de septiembre.
  assert.equal(mesResumenCerrado(20, new Date("2026-08-25T15:00:00Z")), "2026-09");
});

test("el día del cierre todavía cuenta como antes (umbral inclusive)", () => {
  assert.equal(mesResumenCerrado(20, new Date("2026-08-20T15:00:00Z")), "2026-08");
  assert.equal(mesResumenCerrado(20, new Date("2026-08-21T15:00:00Z")), "2026-09");
});

test("cruza el año correctamente", () => {
  assert.equal(mesResumenCerrado(20, new Date("2026-12-25T15:00:00Z")), "2027-01");
  assert.equal(mesResumenCerrado(20, new Date("2026-12-05T15:00:00Z")), "2026-12");
});

test("usa hora argentina, no UTC", () => {
  // 31/07 22:00 en Argentina = 01/08 01:00 UTC. En hora argentina el día es 31,
  // posterior al cierre 20, así que el resumen cerrado es el de agosto.
  assert.equal(mesResumenCerrado(20, new Date("2026-08-01T01:00:00Z")), "2026-08");
  // Y el 1 de agosto a las 01:00 argentinas el día es 1, anterior al cierre.
  assert.equal(mesResumenCerrado(20, new Date("2026-08-01T04:00:00Z")), "2026-08");
});
