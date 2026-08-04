import test from "node:test";
import assert from "node:assert/strict";
import { mesActualAR, diasDelMes, fechaDeServicio, estadoInicial } from "./servicios.mjs";

test("mesActualAR usa hora argentina, no UTC", () => {
  // 31/07 22:00 en Argentina todavía es julio, aunque en UTC ya sea agosto.
  assert.equal(mesActualAR(new Date("2026-08-01T01:00:00Z")), "2026-07");
  // 01/08 01:00 en Argentina ya es agosto.
  assert.equal(mesActualAR(new Date("2026-08-01T04:00:00Z")), "2026-08");
});

test("diasDelMes contempla años bisiestos", () => {
  assert.equal(diasDelMes("2026-02"), 28);
  assert.equal(diasDelMes("2024-02"), 29);
  assert.equal(diasDelMes("2026-04"), 30);
  assert.equal(diasDelMes("2026-12"), 31);
});

test("fechaDeServicio acota el día al último del mes", () => {
  assert.equal(fechaDeServicio("2026-02", 31), "2026-02-28");
  assert.equal(fechaDeServicio("2024-02", 31), "2024-02-29");
  assert.equal(fechaDeServicio("2026-04", 31), "2026-04-30");
});

test("fechaDeServicio respeta un día válido y lo rellena a dos dígitos", () => {
  assert.equal(fechaDeServicio("2026-08", 5), "2026-08-05");
  assert.equal(fechaDeServicio("2026-08", 20), "2026-08-20");
});

test("fechaDeServicio nunca devuelve día cero ni negativo", () => {
  assert.equal(fechaDeServicio("2026-08", 0), "2026-08-01");
  assert.equal(fechaDeServicio("2026-08", -3), "2026-08-01");
});

test("estadoInicial: los automáticos nacen pagados, los manuales pendientes", () => {
  assert.equal(estadoInicial("auto"), "pagado");
  assert.equal(estadoInicial("manual"), "pendiente");
});
