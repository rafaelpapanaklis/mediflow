/**
 * Las cuatro ramas de Sabina JUNTAS: el candado de permisos por usuario (#254)
 * gobierna a las herramientas que llegaron a la vez que él — dinero (#257),
 * Caja (#256) y clínico (#255) —, y el candado de Caja sigue siendo la bandera.
 *
 *   npm run test:sabina-candados-integrados
 *
 * Cada rama se probó sola contra el `main` en que nació. Lo que ninguna podía
 * probar es lo que pasa al juntarlas:
 *
 *  1. 🔴 Para CADA herramienta del catálogo del motor (las 23, no una lista a
 *     mano): si el usuario tiene su key y el Super Admin se la quita a Sabina,
 *     sale `sin_permiso` con causa «sabina» y la base no se toca. Una herramienta
 *     que llegue mañana entra sola en esta prueba.
 *  2. 🔴 Dinero, con las herramientas reales: quitarle a Sabina un permiso de
 *     facturación deja sin tarjeta a cobrar, facturar y avisar, y la frase dice
 *     que fue el Super Admin, no «no tienes permiso».
 *  3. 🔴 El botón: una tarjeta de cobro preparada ANTES del recorte no se ejecuta
 *     después.
 *  4. 🔴 El motor entero: sin permiso de cobrar y con el modelo mandando a «la
 *     tarjeta», la respuesta no promete una tarjeta que no existe (#258) y nombra
 *     al Super Admin (#254).
 *  5. 🔴 Caja: el candado es la bandera `canAccessCaja`, no una key. Ni marcando
 *     TODO para Sabina se abre sin la bandera; y quitarle a Sabina `billing.view`
 *     sí la cierra aunque la bandera esté puesta.
 */
import "../engine-sin-server-only"; // PRIMERO: engine.ts y engine-propuestas.ts arrastran "server-only"
import "../tools/__tests__/preparar"; // prisma real prohibido: todo va por dobles
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// `avisar_saldo_whatsapp` lee la ventana de 24 h del Inbox con el prisma global.
mock.module("@/lib/whatsapp/inbox-log", {
  namedExports: { lastInboundAtForPhone: async () => new Date(Date.now() - 60 * 60_000) },
});

import { ALL_PERMISSIONS, getEffectivePermissions, type PermissionKey } from "@/lib/auth/permissions";
import { fraseSinPermiso, mandaAConfirmarTarjeta } from "../engine-core";
import { accionDeHerramienta, propuestaDeDatos, type SabinaAccion } from "../engine-acciones";
import { ACCIONES_SABINA, SABINA_TOOLS } from "../engine-catalog";
import { ejecutarSabina, type LlamarModelo, type TurnoModelo } from "../engine";
import { confirmarPropuesta, guardarPropuesta } from "../engine-propuestas";
import { crearBaseDePropuestas } from "../engine-propuestas-doble";
import { SABINA_SIN_PERMISOS, causaSinPermiso, type AjustesSabina } from "../permisos-sabina";
import { crearSabinaCtx, type SabinaCtx, type SabinaTool } from "../tipos";
import { correrHerramienta } from "../tools/base";
import { CANDADO_CAJA, candadoCaja } from "../tools/candado-caja";
import { CL_A, TZ_A, U_ADMIN, datosDinero } from "../dinero/__tests__/dinero-siembra";
import { crearBase, type BaseDoble } from "../tools/__tests__/doble-base";

/* ── utilería ───────────────────────────────────────────────────────── */

const ROL = "ADMIN";
const DEL_ADMIN = getEffectivePermissions({ role: ROL, permissionsOverride: [] });

/** La clínica de dinero, con la bandera de Caja del ADMIN a elección. */
function base(bandera = true): BaseDoble {
  const d = datosDinero();
  d.users = d.users.map((u: any) => (u.id === U_ADMIN ? { ...u, canAccessCaja: bandera } : u));
  return crearBase(d as any);
}

/** El ctx tal cual lo arma `/api/sabina`: pasando por el recorte de `crearSabinaCtx`. */
async function ctxAdmin(ajustes: AjustesSabina | null, db: BaseDoble): Promise<SabinaCtx> {
  const c = await crearSabinaCtx(
    { clinicId: CL_A, userId: U_ADMIN, role: ROL, permissionsOverride: [], clinic: { timezone: TZ_A } },
    { leerAjustes: async () => ajustes },
  );
  assert.ok(c, "con sesión completa tiene que haber ctx");
  return { ...c, db };
}

/** Lo que el Super Admin deja a Sabina: todo lo del ADMIN menos `quitar`. */
const sinEstas = (...quitar: string[]): AjustesSabina => ({
  activa: true,
  permisos: DEL_ADMIN.filter((k) => !quitar.includes(k)),
});

const herramienta = (nombre: string): SabinaTool => {
  const t = SABINA_TOOLS.find((h) => h.nombre === nombre);
  assert.ok(t, `el motor no ve ${nombre}`);
  return t;
};

const LAS_NUEVAS = [
  // dinero (#257)
  "facturas_de_paciente",
  "cobrar_factura",
  "crear_factura",
  "avisar_saldo_whatsapp",
  // caja (#256)
  "caja",
  // clínico (#255)
  "recetas",
  "estudios_del_paciente",
  "analisis_y_notas_de_estudio",
  // la clínica (ws1-t5)
  "procedimientos_y_precios",
  "equipo_clinica",
  // comparar sedes (ws1-t4)
  "comparar_sedes",
  // lo que se escapa (ws1-t8)
  "oportunidades_perdidas",
];

/* ══════════════════════════════════════════════════════════════════════
 * 1 · TODO el catálogo del motor queda recortado
 * ══════════════════════════════════════════════════════════════════════ */

test("el catálogo del motor trae las herramientas de las cuatro ramas", () => {
  const nombres = SABINA_TOOLS.map((t) => t.nombre);
  for (const n of LAS_NUEVAS) assert.ok(nombres.includes(n), `falta ${n}`);
  assert.equal(nombres.length, 27);
});

test("🔴 cada herramienta del motor: el usuario tiene la key, el Super Admin se la quita a Sabina → sin_permiso «sabina», sin tocar la base", async () => {
  for (const tool of SABINA_TOOLS) {
    assert.ok(DEL_ADMIN.includes(tool.permiso), `${tool.nombre}: el ADMIN no tiene ${tool.permiso}; la prueba no mediría el recorte`);

    // Con el recorte: sale por la key, antes que el candado, los parámetros y la base.
    const db = base();
    const ctx = await ctxAdmin(sinEstas(tool.permiso), db);
    const r = await correrHerramienta(tool, ctx, {});
    assert.equal(r.ok, false, `${tool.nombre} respondió con el permiso quitado`);
    assert.equal((r as any).motivo, "sin_permiso", `${tool.nombre}: ${JSON.stringify(r)}`);
    assert.equal((r as any).permiso, tool.permiso, tool.nombre);
    assert.equal(causaSinPermiso(ctx, tool.permiso), "sabina", `${tool.nombre}: la frase diría «no tienes permiso»`);
    assert.equal(db.contador.llamadas.length, 0, `${tool.nombre} consultó la base con el permiso quitado`);

    // Sin el recorte, esa misma llamada NO sale por esa key: lo de arriba lo hizo el recorte.
    const libre = await correrHerramienta(tool, await ctxAdmin(null, base()), {});
    assert.ok(
      !((libre as any).motivo === "sin_permiso" && (libre as any).permiso === tool.permiso),
      `${tool.nombre} ya salía por ${tool.permiso} sin recorte`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · Dinero (#257) con las herramientas reales
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 dinero: quitarle a Sabina cobrar, facturar o mandar WhatsApp deja sin tarjeta a esa herramienta, y solo a esa", async () => {
  const casos: Array<{ quitar: PermissionKey; nombre: string; params: Record<string, unknown> }> = [
    { quitar: "billing.charge", nombre: "cobrar_factura", params: { factura: "MF-0010", metodo: "cash" } },
    { quitar: "billing.create", nombre: "crear_factura", params: { presupuesto: "P-0001" } },
    { quitar: "whatsapp.send", nombre: "avisar_saldo_whatsapp", params: { factura: "MF-0010" } },
  ];
  for (const c of casos) {
    // Sin recorte hay tarjeta: la prueba no pasa por un fallo de siembra.
    const libre = await correrHerramienta(herramienta(c.nombre), await ctxAdmin(null, base()), c.params);
    assert.equal(libre.ok, true, `${c.nombre} sin recorte: ${JSON.stringify(libre)}`);
    assert.ok(propuestaDeDatos((libre as any).datos), `${c.nombre} sin recorte no preparó tarjeta: ${JSON.stringify(libre)}`);

    const db = base();
    const ctx = await ctxAdmin(sinEstas(c.quitar), db);
    const r = await correrHerramienta(herramienta(c.nombre), ctx, c.params);
    assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: c.quitar }, c.nombre);
    assert.equal(db.contador.llamadas.length, 0, `${c.nombre} leyó facturas con ${c.quitar} quitado`);

    // Las otras dos siguen preparando: el recorte no es «todo o nada».
    for (const otra of casos.filter((o) => o.nombre !== c.nombre)) {
      const sigue = await correrHerramienta(herramienta(otra.nombre), await ctxAdmin(sinEstas(c.quitar), base()), otra.params);
      assert.ok(propuestaDeDatos((sigue as any).datos), `quitar ${c.quitar} tumbó también ${otra.nombre}: ${JSON.stringify(sigue)}`);
    }
  }
});

test("🔴 dinero: sin ver facturación (quitado por el Super Admin), cobrar no enseña folios y la frase no le miente al doctor", async () => {
  // Sabina conserva billing.charge, así que la key de la herramienta pasa: el corte
  // es el de dentro de la acción (`sinVerFacturacion`), que mira el mismo ctx.
  for (const nombre of ["cobrar_factura", "avisar_saldo_whatsapp"]) {
    const ctx = await ctxAdmin(sinEstas("billing.view"), base());
    const r = await correrHerramienta(herramienta(nombre), ctx, { factura: "MF-0010", metodo: "cash" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const datos = (r as any).datos;
    assert.equal(datos.estado, "sin_permiso", `${nombre}: ${JSON.stringify(datos)}`);
    assert.equal(propuestaDeDatos(datos), null, `${nombre} preparó tarjeta sin billing.view`);
    assert.ok(!JSON.stringify(datos).includes("MF-0010"), `${nombre} enseñó el folio`);
    assert.match(datos.frase, /Super Admin/, `${nombre}: ${datos.frase}`);
    assert.doesNotMatch(datos.frase, /No tienes permiso/, `${nombre}: le dice «no tienes permiso» a quien sí lo tiene`);
  }

  // Y si es el USUARIO quien no lo tiene, la frase de siempre.
  const sinVer = await crearSabinaCtx(
    { clinicId: CL_A, userId: U_ADMIN, role: ROL, permissionsOverride: ["billing.charge"], clinic: { timezone: TZ_A } },
    { leerAjustes: async () => null },
  );
  const r = await correrHerramienta(herramienta("cobrar_factura"), { ...sinVer!, db: base() }, { factura: "MF-0010", metodo: "cash" });
  assert.match((r as any).datos.frase, /^No tienes permiso para ver facturación/);
});

test("🔴 dinero: cobrar un borrador pide crear facturas; si se lo quitó el Super Admin, lo dice así", async () => {
  const ctx = await ctxAdmin(sinEstas("billing.create"), base());
  const r = await correrHerramienta(herramienta("cobrar_factura"), ctx, { factura: "MF-0012", metodo: "cash" });
  const datos = (r as any).datos;
  assert.equal(datos?.estado, "sin_permiso", JSON.stringify(r));
  assert.match(datos.frase, /Super Admin/);
  assert.doesNotMatch(datos.frase, /que no tienes/);
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · El botón: lo preparado antes del recorte no se ejecuta después
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 botón: la tarjeta de cobro se preparó con permiso; el Super Admin lo quita; el botón no llega al endpoint", async () => {
  const reloj = 1_757_800_000_000;
  const ahora = () => reloj;
  const req = () =>
    new Request("https://app.dalecontrol.mx/api/sabina/propuestas/x/confirmar", {
      method: "POST",
      headers: { cookie: "sb-sesion=abc", host: "app.dalecontrol.mx", origin: "https://app.dalecontrol.mx" },
    }) as any;

  const antes = await ctxAdmin(null, base());
  const preparada = await correrHerramienta(herramienta("cobrar_factura"), antes, { factura: "MF-0010", metodo: "cash" });
  const propuesta = propuestaDeDatos((preparada as any).datos);
  assert.ok(propuesta, JSON.stringify(preparada));

  const almacen = crearBaseDePropuestas(ahora);
  const vista = await guardarPropuesta({ ctx: antes, propuesta, pedido: "cóbrale", conversacionId: null, modelo: "m", db: almacen.db, ahora, req: req() });

  let ejecutadas = 0;
  const acciones: SabinaAccion[] = ACCIONES_SABINA.map((a) =>
    a.nombre === "cobrar_factura"
      ? {
          ...a,
          ejecutar: async () => {
            ejecutadas += 1;
            return { ok: true as const, frase: "Cobrado." };
          },
        }
      : a,
  );
  assert.equal(accionDeHerramienta(herramienta("cobrar_factura"))?.permiso, "billing.charge");

  const despues = await ctxAdmin(sinEstas("billing.charge"), base());
  const d = await confirmarPropuesta({ ctx: despues, id: vista.id, req: req(), acciones, db: almacen.db, ahora });
  assert.equal(ejecutadas, 0, "el botón cobró lo que el Super Admin le quitó a Sabina");
  assert.equal(d.vista?.resultado?.tipo, "sin_permiso");
  assert.match(d.vista!.resultado!.frase, /Super Admin/);
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · El motor: #254 + #257 + #258 en el mismo turno
 * ══════════════════════════════════════════════════════════════════════ */

function turno(bloques: TurnoModelo["bloques"], stopReason: string): TurnoModelo {
  return { bloques, stopReason, tokensEntrada: 100, tokensSalida: 20, error: null };
}

test("🔴 motor: sin permiso de cobrar y el modelo manda a «la tarjeta» → ni tarjeta fantasma ni «no tienes permiso»", async () => {
  const db = base();
  const ctx = await ctxAdmin(sinEstas("billing.charge"), db);
  const turnos = [
    turno([{ type: "tool_use", id: "tu_1", name: "cobrar_factura", input: { factura: "MF-0010", metodo: "debit" } }], "tool_use"),
    // El modelo ignora el sin_permiso y hace justo lo que vivió Rafael, con palabras de cobro.
    turno([{ type: "text", text: "Perfecto, confirma el cobro con tarjeta de débito en la tarjeta." }], "end_turn"),
  ];
  let i = 0;
  const llamar: LlamarModelo = async () => turnos[Math.min(i++, turnos.length - 1)];
  const salida = await ejecutarSabina({ ctx, pregunta: "cóbrale la MF-0010 con tarjeta", tools: SABINA_TOOLS, llamar });

  assert.equal(salida.propuestas.length, 0);
  assert.equal(mandaAConfirmarTarjeta(salida.respuesta, true), false, `manda a una tarjeta que no existe: ${salida.respuesta}`);
  assert.match(salida.respuesta, /Super Admin/, salida.respuesta);
  assert.doesNotMatch(salida.respuesta, /No tienes permiso para/, salida.respuesta);
  assert.equal(db.contador.llamadas.length, 0, "se leyó la factura con el permiso quitado");
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · Caja (#256): la bandera, no la key (hallazgo 23)
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 caja: el candado sigue siendo la bandera canAccessCaja y no se convirtió en una key", () => {
  const t = herramienta("caja");
  assert.equal(t.permiso, "billing.view", "la key es la de la pantalla");
  assert.equal(t.candado, candadoCaja, "caja perdió el candado de la bandera");
  assert.equal(CANDADO_CAJA, "caja.acceso");
  // Ni es una key del catálogo de permisos, ni hay ninguna key de caja que el
  // Super Admin pueda marcar para Sabina en Equipo.
  assert.ok(!Object.prototype.hasOwnProperty.call(ALL_PERMISSIONS, CANDADO_CAJA));
  assert.deepEqual(Object.keys(ALL_PERMISSIONS).filter((k) => /caja/i.test(k)), []);
  // Y decide con la función de la pantalla, no con una copia.
  const fuente = readFileSync(path.join(process.cwd(), "src/lib/sabina/tools/candado-caja.ts"), "utf8");
  assert.match(fuente, /return canUseCaja\(usuario\)/);
});

test("🔴 caja: sin la bandera no abre ni con TODO marcado para Sabina, y la frase es la del usuario", async () => {
  const todo: AjustesSabina = { activa: true, permisos: Object.keys(ALL_PERMISSIONS) };
  const db = base(false);
  const ctx = await ctxAdmin(todo, db);
  assert.ok(!ctx.permissionsOverride.includes(CANDADO_CAJA));
  const r = await correrHerramienta(herramienta("caja"), ctx, {});
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: CANDADO_CAJA });
  assert.equal(causaSinPermiso(ctx, CANDADO_CAJA), "usuario", "el Super Admin no puede quitar ni dar la bandera");
  assert.deepEqual(
    db.contador.llamadas.map((l) => l.modelo),
    ["user"],
    "sin la bandera solo se lee al usuario, ni una fila de caja",
  );
});

test("🔴 caja: con la bandera, el Super Admin quitándole billing.view a Sabina la cierra; sin quitarlo, abre", async () => {
  const cerrada = base(true);
  const r = await correrHerramienta(herramienta("caja"), await ctxAdmin(sinEstas("billing.view"), cerrada), {});
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "billing.view" });
  assert.equal(cerrada.contador.llamadas.length, 0, "ni siquiera se miró la bandera");

  const abierta = await correrHerramienta(herramienta("caja"), await ctxAdmin(null, base(true)), {});
  assert.notEqual((abierta as any).motivo, "sin_permiso", JSON.stringify(abierta));
});

/* ══════════════════════════════════════════════════════════════════════
 * 6 · resumen_clinica: la sección omitida por el Super Admin no dice «no tienes acceso»
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 resumen: si el Super Admin le quita facturación a Sabina, el resumen no le dice «NO tienes acceso» a quien sí lo tiene", async () => {
  const ctx = await ctxAdmin(sinEstas("billing.view"), base());
  const r = await correrHerramienta(herramienta("resumen_clinica"), ctx, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const datos = (r as any).datos;
  assert.deepEqual(datos.omitidas, [{ seccion: "ingresos y deuda", permiso: "billing.view", causa: "sabina" }]);
  const resumen = (r as any).resumen as string;
  assert.doesNotMatch(resumen, /NO tienes acceso/, resumen);
  assert.ok(resumen.includes(fraseSinPermiso("billing.view", "sabina")), resumen);

  // Por el motor: el modelo dice lo que el resumen le manda y la red no le pega la frase contraria.
  const turnos = [
    turno([{ type: "tool_use", id: "tu_1", name: "resumen_clinica", input: {} }], "tool_use"),
    turno([{ type: "text", text: `Hoy va tranquila. ${fraseSinPermiso("billing.view", "sabina")}` }], "end_turn"),
  ];
  let i = 0;
  const salida = await ejecutarSabina({
    ctx: await ctxAdmin(sinEstas("billing.view"), base()),
    pregunta: "¿cómo va mi clínica?",
    tools: SABINA_TOOLS,
    llamar: async () => turnos[Math.min(i++, turnos.length - 1)],
  });
  assert.doesNotMatch(salida.respuesta, /No tienes acceso/, salida.respuesta);
  assert.equal(salida.respuesta.split("Super Admin").length - 1, 1, `la frase del Super Admin sale repetida: ${salida.respuesta}`);
});

test("apagada: ninguna de las nuevas responde", async () => {
  for (const nombre of LAS_NUEVAS) {
    const db = base();
    const ctx = await ctxAdmin({ activa: false, permisos: [] }, db);
    assert.deepEqual(ctx.permissionsOverride, [SABINA_SIN_PERMISOS]);
    const r = await correrHerramienta(herramienta(nombre), ctx, {});
    assert.equal((r as any).motivo, "sin_permiso", nombre);
    assert.equal(db.contador.llamadas.length, 0, nombre);
  }
});
