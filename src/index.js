// Worker único: sirve los archivos estáticos de /public y atiende /api/*.
// Reemplaza el viejo modelo de Pages Functions.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
      const [cuentas, movs] = await env.DB.batch([
        env.DB.prepare("SELECT * FROM cuenta ORDER BY def DESC, nombre"),
        env.DB.prepare("SELECT * FROM mov ORDER BY fecha DESC, creado DESC LIMIT 2000")
      ]);
      return json({ cuentas: cuentas.results, movs: movs.results });
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
