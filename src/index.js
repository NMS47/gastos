import { mesActualAR, fechaDeServicio, estadoInicial } from "./servicios.mjs";

// Worker único: sirve los archivos estáticos de /public y atiende /api/*.
// Reemplaza el viejo modelo de Pages Functions.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Materializa los gastos del mes corriente de cada servicio activo.
// El índice único parcial (servicio_id, mes) hace que repetir esto no duplique nada,
// así que es seguro llamarlo en cada arranque de la app y desde los dos teléfonos a la vez.
async function generarDelMes(env) {
  const mes = mesActualAR();
  const { results } = await env.DB.prepare(
    "SELECT * FROM servicio WHERE activo = 1 AND desde <= ?"
  ).bind(mes).all();
  if (!results.length) return;

  const creado = new Date().toISOString();
  await env.DB.batch(results.map(s => env.DB.prepare(
    "INSERT OR IGNORE INTO mov (id,fecha,descripcion,monto,cuenta_id,cuotas,cat,quien,servicio_id,estado,creado) " +
    "VALUES (?,?,?,?,?,1,?,NULL,?,?,?)"
  ).bind(
    id(), fechaDeServicio(mes, s.dia), s.nombre, s.monto,
    s.cuenta_id, s.cat, s.id, estadoInicial(s.modo), creado
  )));
}

async function api(request, env) {
  if (!env.DB) return json({ error: "Falta el binding DB a D1" }, 500);

  if (env.PIN && request.headers.get("x-pin") !== env.PIN)
    return json({ error: "PIN incorrecto" }, 401);

  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [res, rid, action] = seg;
  const m = request.method;

  try {
    if (res === "state" && m === "GET") {
      await generarDelMes(env);
      const [cuentas, movs, servicios] = await env.DB.batch([
        env.DB.prepare("SELECT * FROM cuenta ORDER BY def DESC, nombre"),
        env.DB.prepare("SELECT * FROM mov ORDER BY fecha DESC, creado DESC LIMIT 2000"),
        env.DB.prepare("SELECT * FROM servicio ORDER BY activo DESC, modo, nombre")
      ]);
      return json({ cuentas: cuentas.results, movs: movs.results, servicios: servicios.results });
    }

    if (res === "movs" && m === "POST") {
      const b = await request.json();
      const monto = Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "")) return json({ error: "Fecha inválida" }, 400);
      const cuenta = await env.DB.prepare("SELECT id FROM cuenta WHERE id = ?").bind(b.cuenta_id).first();
      if (!cuenta) return json({ error: "Medio de pago inexistente" }, 400);

      const row = {
        id: id(),
        fecha: b.fecha,
        descripcion: (b.descripcion || "").trim().slice(0, 120) || "Sin nombre",
        monto,
        cuenta_id: b.cuenta_id,
        cuotas: Math.min(Math.max(parseInt(b.cuotas) || 1, 1), 60),
        cat: b.cat || null,
        quien: b.quien === "dani" ? "dani" : "nico",
        creado: new Date().toISOString()
      };
      await env.DB.prepare(
        "INSERT INTO mov (id,fecha,descripcion,monto,cuenta_id,cuotas,cat,quien,creado) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(row.id, row.fecha, row.descripcion, row.monto, row.cuenta_id, row.cuotas, row.cat, row.quien, row.creado).run();
      return json(row, 201);
    }

    if (res === "movs" && rid && m === "DELETE") {
      await env.DB.prepare("DELETE FROM mov WHERE id = ?").bind(rid).run();
      return json({ ok: true });
    }

    if (res === "cuentas" && !rid && m === "POST") {
      const b = await request.json();
      const nombre = (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const tipo = b.tipo === "credito" ? "credito" : "debito";
      const row = {
        id: "c" + id(),
        nombre,
        tipo,
        cierre: tipo === "credito" ? (parseInt(b.cierre) || 20) : null,
        venc: tipo === "credito" ? (parseInt(b.venc) || 5) : null,
        def: 0
      };
      await env.DB.prepare("INSERT INTO cuenta (id,nombre,tipo,cierre,venc,def) VALUES (?,?,?,?,?,0)")
        .bind(row.id, row.nombre, row.tipo, row.cierre, row.venc).run();
      return json(row, 201);
    }

    if (res === "cuentas" && rid && action === "default" && m === "POST") {
      await env.DB.batch([
        env.DB.prepare("UPDATE cuenta SET def = 0"),
        env.DB.prepare("UPDATE cuenta SET def = 1 WHERE id = ?").bind(rid)
      ]);
      return json({ ok: true });
    }

    if (res === "cuentas" && rid && m === "DELETE") {
      const usada = await env.DB.prepare("SELECT 1 FROM mov WHERE cuenta_id = ? LIMIT 1").bind(rid).first();
      if (usada) return json({ error: "Ese medio tiene gastos cargados" }, 409);
      await env.DB.prepare("DELETE FROM cuenta WHERE id = ?").bind(rid).run();
      return json({ ok: true });
    }

    if (res === "servicios" && !rid && m === "POST") {
      const b = await request.json();
      const nombre = (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const monto = Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const dia = Math.min(Math.max(parseInt(b.dia) || 1, 1), 31);
      const modo = b.modo === "auto" ? "auto" : "manual";
      const cuenta = await env.DB.prepare("SELECT id FROM cuenta WHERE id = ?").bind(b.cuenta_id).first();
      if (!cuenta) return json({ error: "Medio de pago inexistente" }, 400);

      const row = {
        id: "s" + id(),
        nombre, monto, dia,
        cuenta_id: b.cuenta_id,
        cat: b.cat || null,
        modo,
        activo: 1,
        desde: mesActualAR(),
        creado: new Date().toISOString()
      };
      await env.DB.prepare(
        "INSERT INTO servicio (id,nombre,monto,dia,cuenta_id,cat,modo,activo,desde,creado) VALUES (?,?,?,?,?,?,?,1,?,?)"
      ).bind(row.id, row.nombre, row.monto, row.dia, row.cuenta_id, row.cat, row.modo, row.desde, row.creado).run();
      return json(row, 201);
    }

    if (res === "servicios" && rid && m === "PATCH") {
      const b = await request.json();
      const actual = await env.DB.prepare("SELECT * FROM servicio WHERE id = ?").bind(rid).first();
      if (!actual) return json({ error: "Servicio inexistente" }, 404);

      const nombre = b.nombre === undefined ? actual.nombre : (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const monto = b.monto === undefined ? actual.monto : Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const dia = b.dia === undefined ? actual.dia : Math.min(Math.max(parseInt(b.dia) || 1, 1), 31);
      const modo = b.modo === undefined ? actual.modo : (b.modo === "auto" ? "auto" : "manual");
      const cat = b.cat === undefined ? actual.cat : (b.cat || null);
      const activo = b.activo === undefined ? actual.activo : (b.activo ? 1 : 0);
      let cuenta_id = actual.cuenta_id;
      if (b.cuenta_id !== undefined) {
        const cuenta = await env.DB.prepare("SELECT id FROM cuenta WHERE id = ?").bind(b.cuenta_id).first();
        if (!cuenta) return json({ error: "Medio de pago inexistente" }, 400);
        cuenta_id = b.cuenta_id;
      }

      await env.DB.prepare(
        "UPDATE servicio SET nombre=?, monto=?, dia=?, cuenta_id=?, cat=?, modo=?, activo=? WHERE id=?"
      ).bind(nombre, monto, dia, cuenta_id, cat, modo, activo, rid).run();
      return json({ ...actual, nombre, monto, dia, cuenta_id, cat, modo, activo });
    }

    if (res === "servicios" && rid && m === "DELETE") {
      const usado = await env.DB.prepare("SELECT 1 FROM mov WHERE servicio_id = ? LIMIT 1").bind(rid).first();
      if (usado) return json({ error: "Ese servicio ya generó gastos. Dale de baja en vez de borrarlo." }, 409);
      await env.DB.prepare("DELETE FROM servicio WHERE id = ?").bind(rid).run();
      return json({ ok: true });
    }

    return json({ error: "Ruta no encontrada" }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env);
    return env.ASSETS.fetch(request);
  }
};
