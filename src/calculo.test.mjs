import test from "node:test";
import assert from "node:assert/strict";
import { impactos, ym, vigenteEn, consumos } from "../public/calculo.mjs";
import { cascada as _cascada, movsDelMes } from "../public/calculo.mjs";

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

const base = () => ({
  movs: [],
  cuentas: [
    { id: "v", tipo: "credito", cierre: 20, base_pago: 0, base_cuotas: 0, pagado_hasta: null },
    { id: "e", tipo: "debito" }
  ],
  ingresos: [{ monto: 3350000, desde: "2026-10", hasta: null, activo: 1 }],
  servicios: [],
  topes: []
});

// Todos los tests tratan a octubre de 2026 como el mes corriente.
const HOY = "2026-10";
const cascada = (d, mes, corriente = HOY) => _cascada(d, mes, corriente);

test("cascada: sin gastos, queda todo el ingreso y se parte al medio", () => {
  const c = cascada(base(), "2026-10");
  assert.equal(c.ingresos, 3350000);
  assert.equal(c.queda, 3350000);
  assert.equal(c.cadaUno, 1675000);
});

test("cascada: un ingreso con desde = hasta cuenta solo ese mes", () => {
  const d = base();
  d.ingresos.push({ monto: 1000000, desde: "2026-11", hasta: "2026-11", activo: 1 });
  assert.equal(cascada(d, "2026-10").ingresos, 3350000);
  assert.equal(cascada(d, "2026-11").ingresos, 4350000);
});

test("cascada: el tope se reserva completo aunque no se haya gastado nada", () => {
  const d = base();
  d.topes = [{ cat: "Supermercado", monto: 600000 }];
  const c = cascada(d, "2026-10");
  assert.equal(c.totalTopes, 600000);
  assert.equal(c.topes[0].consumido, 0);
  assert.equal(c.queda, 2750000);
});

test("cascada: el tope de una categoria consume los servicios de esa categoria", () => {
  const d = base();
  d.topes = [{ cat: "Auto", monto: 300000 }];
  d.movs = [{ id: "sv1-2026-10", fecha: "2026-10-28", monto: 100000, cat: "Auto",
              cuenta_id: "e", servicio_id: "1", estado: "pendiente" }];
  const c = cascada(d, "2026-10");
  assert.equal(c.topes[0].consumido, 100000);
  assert.equal(c.totalTopes, 300000);          // la reserva no cambia
  assert.equal(c.totalSinTope, 0);             // no se resta aparte
});

test("cascada: una categoria sin tope resta lo determinado tal cual", () => {
  const d = base();
  d.movs = [{ fecha: "2026-10-10", monto: 500000, cat: "Deudas", cuenta_id: "e" }];
  const c = cascada(d, "2026-10");
  assert.deepEqual(c.sinTope, [{ cat: "Deudas", monto: 500000 }]);
  assert.equal(c.queda, 2850000);
});

test("cascada: un servicio pagado con tarjeta no se resta dos veces", () => {
  const d = base();
  d.movs = [{ fecha: "2026-10-05", monto: 15000, cuotas: 1, cat: "Suscripciones",
              cuenta_id: "v", servicio_id: "1", estado: "pagado" }];
  const enOctubre = cascada(d, "2026-10");
  assert.equal(enOctubre.totalSinTope, 0);     // no esta como linea de caja
  assert.equal(enOctubre.tarjeta, 0);          // el resumen cae en noviembre
  assert.equal(cascada(d, "2026-11").tarjeta, 15000);
});

test("cascada: la tarjeta suma base_pago si el resumen del mes no esta pagado", () => {
  const d = base();
  d.cuentas[0].base_pago = 700000;
  assert.equal(cascada(d, "2026-10").tarjeta, 700000);
  d.cuentas[0].pagado_hasta = "2026-10";
  assert.equal(cascada(d, "2026-10").tarjeta, 0);
});

test("cascada: base_cuotas nunca entra en la linea de tarjeta", () => {
  const d = base();
  d.cuentas[0].base_cuotas = 900000;
  assert.equal(cascada(d, "2026-10").tarjeta, 0);
});

test("cascada: un gasto familiar sin categoria cae en la bandeja y no desaparece", () => {
  const d = base();
  d.movs = [{ id: "x", fecha: "2026-10-05", monto: 12000, cat: null, cuenta_id: "e" }];
  const c = cascada(d, "2026-10");
  assert.deepEqual(c.sinTope, [{ cat: "", monto: 12000 }]);
  assert.equal(c.sinCategoria.length, 1);
  assert.equal(c.sinCategoria[0].id, "x");
  assert.equal(c.queda, 3338000);
});

test("cascada: la bandeja incluye los sin categoria pagados con tarjeta", () => {
  const d = base();
  d.movs = [{ id: "x", fecha: "2026-10-05", monto: 12000, cuotas: 1, cat: null, cuenta_id: "v" }];
  const c = cascada(d, "2026-10");
  assert.equal(c.sinCategoria.length, 1);
  assert.equal(c.totalSinTope, 0);             // la caja ya la cuenta el resumen
});

test("cascada: un gasto personal no toca ningun total familiar", () => {
  const d = base();
  d.movs = [{ fecha: "2026-10-05", monto: 40000, cat: "Ropa", cuenta_id: "e",
              ambito: "personal", quien: "nico" }];
  const c = cascada(d, "2026-10");
  assert.equal(c.totalSinTope, 0);
  assert.equal(c.queda, 3350000);
  assert.equal(c.personal.nico, 40000);
});

test("cascada: el mes puede dar negativo y cadaUno queda en cero", () => {
  const d = base();
  d.topes = [{ cat: "Supermercado", monto: 4000000 }];
  const c = cascada(d, "2026-10");
  assert.equal(c.queda, -650000);
  assert.equal(c.cadaUno, 0);
});

test("cascada: el redondeo no hace aparecer ni desaparecer un peso", () => {
  const d = base();
  d.ingresos = [{ monto: 5, desde: "2026-10", hasta: null, activo: 1 }];
  const c = cascada(d, "2026-10");
  assert.equal(c.cadaUno, 2);
  assert.ok(c.cadaUno * 2 <= c.queda);
});

test("movsDelMes: en el mes corriente devuelve los movs tal cual", () => {
  const movs = [{ id: "a", fecha: "2026-10-05", monto: 1 }];
  assert.equal(movsDelMes(movs, [{ id: "s", activo: 1, desde: "2026-01", hasta: null,
    nombre: "Luz", monto: 90000, dia: 10, cuenta_id: "e", cat: "Servicios", modo: "auto" }],
    "2026-10", HOY).length, 1);
});

test("movsDelMes: en un mes futuro proyecta los servicios vigentes", () => {
  const sv = [{ id: "s", activo: 1, desde: "2026-01", hasta: null, nombre: "Luz",
                monto: 90000, dia: 10, cuenta_id: "e", cat: "Servicios", modo: "auto" }];
  const r = movsDelMes([], sv, "2026-11", HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].fecha, "2026-11-10");
  assert.equal(r[0].monto, 90000);
  assert.equal(r[0].estado, "pagado");
  assert.equal(r[0].proyectado, true);
});

test("movsDelMes: no proyecta un servicio que ya tiene su fila en ese mes", () => {
  const sv = [{ id: "s", activo: 1, desde: "2026-01", hasta: null, nombre: "Luz",
                monto: 90000, dia: 10, cuenta_id: "e", cat: "Servicios", modo: "auto" }];
  const movs = [{ id: "svs-2026-11", fecha: "2026-11-10", monto: 90000, servicio_id: "s" }];
  assert.equal(movsDelMes(movs, sv, "2026-11", HOY).length, 1);
});

test("movsDelMes: no proyecta un compromiso pasado su hasta", () => {
  const sv = [{ id: "s", activo: 1, desde: "2026-08", hasta: "2027-02", nombre: "Mendoza",
                monto: 725000, dia: 10, cuenta_id: "e", cat: "Deudas", modo: "manual" }];
  assert.equal(movsDelMes([], sv, "2027-02", HOY).length, 1);
  assert.equal(movsDelMes([], sv, "2027-03", HOY).length, 0);
});

test("cascada: un mes futuro resta los servicios aunque todavia no tengan fila", () => {
  const d = base();
  d.servicios = [{ id: "s", activo: 1, desde: "2026-01", hasta: null, nombre: "Luz",
                   monto: 90000, dia: 10, cuenta_id: "e", cat: "Servicios", modo: "auto" }];
  // En octubre el Worker ya generó la fila, así que no hay nada que proyectar.
  assert.equal(cascada(d, "2026-10").totalSinTope, 0);
  // En noviembre la fila no existe todavía: sin proyección la cascada mentiría 90.000.
  const nov = cascada(d, "2026-11");
  assert.deepEqual(nov.sinTope, [{ cat: "Servicios", monto: 90000 }]);
  assert.equal(nov.queda, 3260000);
});

// Review Focus 2: fila huerfana de una categoria que ya no esta en CATS.
test("cascada: un tope de una categoria que ya no existe se sigue restando y se lista", () => {
  const d = base();
  d.topes = [{ cat: "Nafta", monto: 250000 }];
  const c = cascada(d, "2026-10");
  assert.equal(c.totalTopes, 250000);
  assert.equal(c.topes[0].cat, "Nafta");
});

// Review Focus 5: nunca una tercera persona fantasma.
test("cascada: un gasto personal sin quien se agrupa bajo nico", () => {
  const d = base();
  d.movs = [{ fecha: "2026-10-05", monto: 100, cuenta_id: "e", ambito: "personal", quien: null }];
  const c = cascada(d, "2026-10");
  assert.deepEqual(Object.keys(c.personal).sort(), ["dani", "nico"]);
  assert.equal(c.personal.nico, 100);
  assert.equal(c.personal.dani, 0);
});
