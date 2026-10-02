import test from "node:test";
import assert from "node:assert/strict";
import { impactos, ym, vigenteEn, consumos } from "../public/calculo.mjs";

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

test("vigenteEn: sin hasta, corre desde desde y para siempre", () => {
  const f = { activo: 1, desde: "2026-10", hasta: null };
  assert.equal(vigenteEn(f, "2026-09"), false);
  assert.equal(vigenteEn(f, "2026-10"), true);
  assert.equal(vigenteEn(f, "2030-01"), true);
});

test("vigenteEn: desde igual a hasta corre un solo mes", () => {
  const f = { activo: 1, desde: "2026-11", hasta: "2026-11" };
  assert.equal(vigenteEn(f, "2026-10"), false);
  assert.equal(vigenteEn(f, "2026-11"), true);
  assert.equal(vigenteEn(f, "2026-12"), false);
});

test("vigenteEn: dado de baja no corre, aunque el hasta no haya llegado", () => {
  assert.equal(vigenteEn({ activo: 0, desde: "2026-01", hasta: "2027-02" }, "2026-10"), false);
});

test("consumos: suma por categoria, por fecha de compra", () => {
  const movs = [
    { fecha: "2026-10-05", monto: 100, cat: "Supermercado" },
    { fecha: "2026-10-20", monto: 50, cat: "Supermercado" },
    { fecha: "2026-11-01", monto: 999, cat: "Supermercado" }
  ];
  assert.deepEqual(consumos(movs, "2026-10"), { Supermercado: 150 });
});

test("consumos: una compra en 12 cuotas consume el total en el mes de compra", () => {
  const movs = [{ fecha: "2026-10-05", monto: 1200, cuotas: 12, cat: "Hogar" }];
  assert.deepEqual(consumos(movs, "2026-10"), { Hogar: 1200 });
});

test("consumos: un pendiente consume, un omitido no", () => {
  const movs = [
    { fecha: "2026-10-28", monto: 100, cat: "Auto", estado: "pendiente" },
    { fecha: "2026-10-28", monto: 500, cat: "Auto", estado: "omitido" },
    { fecha: "2026-10-10", monto: 30, cat: "Auto", estado: "pagado" }
  ];
  assert.deepEqual(consumos(movs, "2026-10"), { Auto: 130 });
});

test("consumos: un gasto personal no consume ningun tope", () => {
  const movs = [{ fecha: "2026-10-05", monto: 100, cat: "Ropa", ambito: "personal" }];
  assert.deepEqual(consumos(movs, "2026-10"), {});
});

test("consumos: los sin categoria van a la clave vacia", () => {
  const movs = [
    { fecha: "2026-10-05", monto: 12, cat: null },
    { fecha: "2026-10-06", monto: 8, cat: "" }
  ];
  assert.deepEqual(consumos(movs, "2026-10"), { "": 20 });
});

// Review Focus 1: un mov sin fecha no puede dejar la cascada en blanco.
test("consumos: ignora un mov con fecha ausente o mal formada", () => {
  const movs = [
    { monto: 999, cat: "Supermercado" },
    { fecha: "", monto: 999, cat: "Supermercado" },
    { fecha: "2026-10-05", monto: 100, cat: "Supermercado" }
  ];
  assert.deepEqual(consumos(movs, "2026-10"), { Supermercado: 100 });
});
