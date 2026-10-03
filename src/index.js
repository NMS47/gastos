import { mesActualAR, fechaDeServicio, estadoInicial } from "./servicios.mjs";
import { mesResumenCerrado } from "./tarjetas.mjs";

// Worker único: sirve los archivos estáticos de /public y atiende /api/*.
// Reemplaza el viejo modelo de Pages Functions.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Materializa los gastos del mes corriente de cada servicio activo.
// El id es determinístico ("sv" + servicio.id + "-" + mes): así la PRIMARY KEY de mov
// por sí sola impide filas duplicadas, sin depender de que exista el índice único
// parcial idx_mov_serv_mes. Ese índice queda como respaldo redundante — no lo saques
// pensando que ya no hace falta, es la segunda barrera si algún día esto se toca.
// `hasta` corta la generacion: un compromiso de 7 cuotas deja de generar en el mes 8
// sin que haya que darlo de baja a mano. Esta condicion duplica a proposito la logica
// de vigenteEn() en public/calculo.mjs — una corre en SQL y la otra en el navegador.
// Si se cambia una, cambiar la otra.
async function generarDelMes(env) {
  const mes = mesActualAR();
  const { results } = await env.DB.prepare(
    "SELECT * FROM servicio WHERE activo = 1 AND desde <= ? AND (hasta IS NULL OR hasta >= ?)"
  ).bind(mes, mes).all();
  if (!results.length) return;

  const creado = new Date().toISOString();
  await env.DB.batch(results.map(s => env.DB.prepare(
    "INSERT OR IGNORE INTO mov (id,fecha,descripcion,monto,cuenta_id,cuotas,cat,quien,servicio_id,estado,creado) " +
    "VALUES (?,?,?,?,?,1,?,NULL,?,?,?)"
  ).bind(
    "sv" + s.id + "-" + mes, fechaDeServicio(mes, s.dia), s.nombre, s.monto,
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
      const [cuentas, movs, servicios, ingresos] = await env.DB.batch([
        env.DB.prepare("SELECT * FROM cuenta ORDER BY def DESC, nombre"),
        env.DB.prepare("SELECT * FROM mov ORDER BY fecha DESC, creado DESC LIMIT 2000"),
        env.DB.prepare("SELECT * FROM servicio ORDER BY activo DESC, modo, nombre"),
        env.DB.prepare("SELECT * FROM ingreso ORDER BY activo DESC, monto DESC")
      ]);
      return json({ cuentas: cuentas.results, movs: movs.results,
                    servicios: servicios.results, ingresos: ingresos.results });
    }

    if (res === "movs" && !rid && m === "POST") {
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

    if (res === "movs" && rid && action === "pagar" && m === "POST") {
      const b = await request.json();
      const monto = Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const mov = await env.DB.prepare("SELECT * FROM mov WHERE id = ?").bind(rid).first();
      if (!mov) return json({ error: "Gasto inexistente" }, 404);
      if (!mov.servicio_id) return json({ error: "Ese gasto no viene de un servicio" }, 400);

      // La fecha no se toca: queda la del vencimiento, así pagar tarde no
      // cambia el mes al que pertenece el gasto.
      await env.DB.prepare("UPDATE mov SET monto = ?, estado = 'pagado' WHERE id = ?")
        .bind(monto, rid).run();
      return json({ ...mov, monto, estado: "pagado" });
    }

    if (res === "movs" && rid && !action && m === "DELETE") {
      const mov = await env.DB.prepare("SELECT servicio_id FROM mov WHERE id = ?").bind(rid).first();
      // Un gasto de servicio no se borra: se marca omitido. Si se borrara, el
      // INSERT OR IGNORE del próximo arranque lo volvería a crear.
      if (mov && mov.servicio_id) {
        await env.DB.prepare("UPDATE mov SET estado = 'omitido' WHERE id = ?").bind(rid).run();
        return json({ ok: true, omitido: true });
      }
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

    if (res === "cuentas" && rid && action === "resumen-pagado" && m === "POST") {
      const c = await env.DB.prepare("SELECT * FROM cuenta WHERE id = ?").bind(rid).first();
      if (!c) return json({ error: "Medio de pago inexistente" }, 404);
      if (c.tipo !== "credito") return json({ error: "Solo las tarjetas tienen resumen" }, 400);

      // Sin día de cierre no hay forma de saber qué resumen cerró. Antes esto caía a un 20
      // por defecto, que fechaba el pago con el cierre de otra tarjeta y liberaba el límite
      // equivocado sin avisar. Mejor que falle fuerte.
      if (!c.cierre) return json({ error: "Esa tarjeta no tiene día de cierre cargado" }, 400);

      // Se guarda el mes que impactos() le asigna al resumen que YA cerró. La base de un
      // pago se borra porque todo lo que se debía entró en ese resumen y quedó saldado;
      // de acá en más el usado sale solo de los gastos cargados.
      const mes = mesResumenCerrado(c.cierre);
      await env.DB.prepare("UPDATE cuenta SET pagado_hasta = ?, base_pago = 0 WHERE id = ?")
        .bind(mes, rid).run();
      return json({ ...c, pagado_hasta: mes, base_pago: 0 });
    }

    if (res === "cuentas" && rid && m === "PATCH") {
      const b = await request.json();
      const actual = await env.DB.prepare("SELECT * FROM cuenta WHERE id = ?").bind(rid).first();
      if (!actual) return json({ error: "Medio de pago inexistente" }, 404);

      const nombre = b.nombre === undefined ? actual.nombre : (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);

      // Un límite puede quedar sin cargar: "" o null lo borran, un número lo fija.
      const lim = (v, prev) => {
        if (v === undefined) return prev;
        if (v === null || v === "") return null;
        const n = Number(v);
        return n >= 0 ? n : prev;
      };
      // Las bases siempre tienen valor; nunca son NULL.
      const base = (v, prev) => {
        if (v === undefined) return prev;
        const n = Number(v);
        return n >= 0 ? n : prev;
      };
      const dia = (v, prev) => {
        if (v === undefined) return prev;
        return Math.min(Math.max(parseInt(v) || prev || 1, 1), 31);
      };

      // Los campos de crédito no aplican a una cuenta de débito: se fuerzan a su valor neutro.
      const cred = actual.tipo === "credito";
      const cierre        = cred ? dia(b.cierre, actual.cierre) : null;
      const venc          = cred ? dia(b.venc, actual.venc) : null;
      const limite_pago   = cred ? lim(b.limite_pago, actual.limite_pago) : null;
      const limite_cuotas = cred ? lim(b.limite_cuotas, actual.limite_cuotas) : null;
      const base_pago     = cred ? base(b.base_pago, actual.base_pago) : 0;
      const base_cuotas   = cred ? base(b.base_cuotas, actual.base_cuotas) : 0;

      await env.DB.prepare(
        "UPDATE cuenta SET nombre=?, cierre=?, venc=?, limite_pago=?, limite_cuotas=?, base_pago=?, base_cuotas=? WHERE id=?"
      ).bind(nombre, cierre, venc, limite_pago, limite_cuotas, base_pago, base_cuotas, rid).run();
      return json({ ...actual, nombre, cierre, venc, limite_pago, limite_cuotas, base_pago, base_cuotas });
    }

    if (res === "cuentas" && rid && m === "DELETE") {
      const usada = await env.DB.prepare("SELECT 1 FROM mov WHERE cuenta_id = ? LIMIT 1").bind(rid).first();
      if (usada) return json({ error: "Ese medio tiene gastos cargados" }, 409);
      const enServicio = await env.DB.prepare("SELECT 1 FROM servicio WHERE cuenta_id = ? LIMIT 1").bind(rid).first();
      if (enServicio) return json({ error: "Ese medio lo usa un servicio" }, 409);
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

      const desde = mesActualAR();
      const hasta = /^\d{4}-\d{2}$/.test(b.hasta || "") ? b.hasta : null;
      if (hasta && hasta < desde) return json({ error: "El hasta no puede ser anterior al desde" }, 400);

      const row = {
        id: "s" + id(),
        nombre, monto, dia,
        cuenta_id: b.cuenta_id,
        cat: b.cat || null,
        modo,
        activo: 1,
        desde,
        hasta,
        creado: new Date().toISOString()
      };
      await env.DB.prepare(
        "INSERT INTO servicio (id,nombre,monto,dia,cuenta_id,cat,modo,activo,desde,hasta,creado) VALUES (?,?,?,?,?,?,?,1,?,?,?)"
      ).bind(row.id, row.nombre, row.monto, row.dia, row.cuenta_id, row.cat, row.modo, row.desde, row.hasta, row.creado).run();
      // Genera ya el gasto del mes corriente para este servicio, si corresponde:
      // si no, un alta a fin de mes se queda sin boleta hasta el próximo GET /api/state.
      // INSERT OR IGNORE hace que esto sea gratis para los servicios que ya la tienen.
      // Va en su propio try a propósito: el servicio ya quedó creado, así que un fallo
      // acá no puede devolver 500. El usuario reintentaría, y como no hay unicidad por
      // nombre quedarían dos servicios y dos boletas por mes para siempre.
      try { await generarDelMes(env); } catch (_) { /* se genera en el próximo /api/state */ }
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
      let hasta = actual.hasta;
      if (b.hasta !== undefined)
        hasta = /^\d{4}-\d{2}$/.test(b.hasta || "") ? b.hasta : null;
      if (hasta && hasta < actual.desde)
        return json({ error: "El hasta no puede ser anterior al desde" }, 400);

      await env.DB.prepare(
        "UPDATE servicio SET nombre=?, monto=?, dia=?, cuenta_id=?, cat=?, modo=?, activo=?, hasta=? WHERE id=?"
      ).bind(nombre, monto, dia, cuenta_id, cat, modo, activo, hasta, rid).run();
      return json({ ...actual, nombre, monto, dia, cuenta_id, cat, modo, activo, hasta });
    }

    if (res === "servicios" && rid && m === "DELETE") {
      const usado = await env.DB.prepare("SELECT 1 FROM mov WHERE servicio_id = ? LIMIT 1").bind(rid).first();
      if (usado) return json({ error: "Ese servicio ya generó gastos. Dale de baja en vez de borrarlo." }, 409);
      await env.DB.prepare("DELETE FROM servicio WHERE id = ?").bind(rid).run();
      return json({ ok: true });
    }

    if (res === "ingresos" && !rid && m === "POST") {
      const b = await request.json();
      const nombre = (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const monto = Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const desde = /^\d{4}-\d{2}$/.test(b.desde || "") ? b.desde : mesActualAR();
      const hasta = /^\d{4}-\d{2}$/.test(b.hasta || "") ? b.hasta : null;
      if (hasta && hasta < desde)
        return json({ error: "El hasta no puede ser anterior al desde" }, 400);

      const row = {
        id: id(), nombre, monto,
        dia: b.dia == null ? null : Math.min(Math.max(parseInt(b.dia) || 1, 1), 31),
        desde, hasta, activo: 1, creado: new Date().toISOString()
      };
      await env.DB.prepare(
        "INSERT INTO ingreso (id,nombre,monto,dia,desde,hasta,activo,creado) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(row.id, row.nombre, row.monto, row.dia, row.desde, row.hasta, row.activo, row.creado).run();
      return json(row, 201);
    }

    if (res === "ingresos" && rid && m === "PATCH") {
      const b = await request.json();
      const actual = await env.DB.prepare("SELECT * FROM ingreso WHERE id = ?").bind(rid).first();
      if (!actual) return json({ error: "Ingreso inexistente" }, 404);

      const nombre = b.nombre === undefined ? actual.nombre : (b.nombre || "").trim().slice(0, 40);
      if (!nombre) return json({ error: "Poné un nombre" }, 400);
      const monto = b.monto === undefined ? actual.monto : Number(b.monto);
      if (!(monto > 0)) return json({ error: "Monto inválido" }, 400);
      const dia = b.dia === undefined ? actual.dia
        : (b.dia == null ? null : Math.min(Math.max(parseInt(b.dia) || 1, 1), 31));
      const activo = b.activo === undefined ? actual.activo : (b.activo ? 1 : 0);
      let hasta = actual.hasta;
      if (b.hasta !== undefined) hasta = /^\d{4}-\d{2}$/.test(b.hasta || "") ? b.hasta : null;
      if (hasta && hasta < actual.desde)
        return json({ error: "El hasta no puede ser anterior al desde" }, 400);

      await env.DB.prepare(
        "UPDATE ingreso SET nombre=?, monto=?, dia=?, hasta=?, activo=? WHERE id=?"
      ).bind(nombre, monto, dia, hasta, activo, rid).run();
      return json({ ...actual, nombre, monto, dia, hasta, activo });
    }

    if (res === "ingresos" && rid && m === "DELETE") {
      await env.DB.prepare("DELETE FROM ingreso WHERE id = ?").bind(rid).run();
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
