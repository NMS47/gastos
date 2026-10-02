import test from "node:test";
import assert from "node:assert/strict";
import { impactos, ym } from "../public/calculo.mjs";

const visa = { id: "v", tipo: "credito", cierre: 20 };
const efectivo = { id: "e", tipo: "debito" };

test("ym devuelve el mes con dos digitos", () => {
  assert.equal(ym(new Date(2026, 0, 5)), "2026-01");
  assert.equal(ym(new Date(2026, 11, 31)), "2026-12");
});

test("debito impacta el mismo dia de la compra", () => {
  const r = impactos({ fecha: "2026-10-05", monto: 1000, cuotas: 1 }, efectivo);
  assert.deepEqual(r, [{ mes: "2026-10", monto: 1000, nro: 1, de: 1 }]);
});

test("compra el dia 4 con cierre 20 entra en el resumen del mes siguiente", () => {
  const r = impactos({ fecha: "2026-10-04", monto: 1000, cuotas: 1 }, visa);
  assert.equal(r[0].mes, "2026-11");
});

test("compra el dia 25 con cierre 20 entra dos meses despues", () => {
  const r = impactos({ fecha: "2026-10-25", monto: 1000, cuotas: 1 }, visa);
  assert.equal(r[0].mes, "2026-12");
});

test("el dia del cierre todavia cuenta como antes", () => {
  const r = impactos({ fecha: "2026-10-20", monto: 1000, cuotas: 1 }, visa);
  assert.equal(r[0].mes, "2026-11");
});

test("12 cuotas desde diciembre terminan en enero del año +2", () => {
  const r = impactos({ fecha: "2026-12-25", monto: 1200, cuotas: 12 }, visa);
  assert.equal(r.length, 12);
  assert.equal(r[0].mes, "2027-02");
  assert.equal(r[11].mes, "2028-01");
});

test("12 cuotas antes del cierre terminan en diciembre del año siguiente", () => {
  const r = impactos({ fecha: "2026-12-05", monto: 1200, cuotas: 12 }, visa);
  assert.equal(r.length, 12);
  assert.equal(r[0].mes, "2027-01");
  assert.equal(r[11].mes, "2027-12");
});

test("la suma de las cuotas da exactamente el total", () => {
  const r = impactos({ fecha: "2026-10-05", monto: 1000, cuotas: 3 }, visa);
  assert.equal(r.reduce((a, i) => a + i.monto, 0), 1000);
  assert.equal(r[2].monto, 1000 - r[0].monto * 2);
});

// Review Focus 3: borraron el medio de pago y quedó el gasto.
test("un mov sin cuenta se cuenta en el mes de compra, sin explotar", () => {
  const r = impactos({ fecha: "2026-10-05", monto: 1000, cuotas: 1 }, undefined);
  assert.deepEqual(r, [{ mes: "2026-10", monto: 1000, nro: 1, de: 1 }]);
});
