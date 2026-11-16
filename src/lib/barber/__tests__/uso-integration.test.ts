// Uso del panel (ws6-t4) contra Postgres LOCAL: registro en lote, tope por
// usuario y minuto, sin tabla (se apaga y no truena), agregados por mes y la
// lista. Se salta sola si DATABASE_URL no es local (_base-local.ts).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test --test-concurrency=1 src/lib/barber/__tests__/uso-integration.test.ts
//
// Necesita sql/barber_usage_events.sql pegado en esa base local.
import { skip } from "./_base-local";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const RUN = `uso${Date.now().toString(36)}`;
const TZ = "America/Merida";

type Prisma = typeof import("@/lib/prisma").prisma;
let prisma: Prisma;
let reg: typeof import("@/lib/barber/uso/registro");
let act: typeof import("@/lib/barber/uso/actividad");
let core: typeof import("@/lib/barber/uso/uso-core");

const ids = { a: "", a2: "", b: "", ua: "", ua2: "", ub: "" };

before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).prisma;
  reg = await import("@/lib/barber/uso/registro");
  act = await import("@/lib/barber/uso/actividad");
  core = await import("@/lib/barber/uso/uso-core");

  const shop = (slug: string, extra: Record<string, unknown> = {}) =>
    prisma.barbershop.create({
      data: { name: `Uso ${slug}`, slug: `${RUN}-${slug}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ, ...extra },
    });
  const a = await shop("a");
  const a2 = await shop("a2", { parentId: a.id, isMainBranch: false, branchName: "Norte" });
  const b = await shop("b");
  const user = (s: string, tag: string, role = "OWNER") =>
    prisma.barberUser.create({
      data: { barbershopId: s, supabaseId: `${RUN}-${tag}`, email: `${RUN}-${tag}@test.local`, firstName: "Uso", lastName: tag.toUpperCase(), role: role as never },
    });
  Object.assign(ids, {
    a: a.id,
    a2: a2.id,
    b: b.id,
    ua: (await user(a.id, "ua")).id,
    ua2: (await user(a2.id, "ua2", "RECEPTION")).id,
    ub: (await user(b.id, "ub")).id,
  });
});

after(async () => {
  if (skip) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const sid = shops.map((s) => s.id);
  if (sid.length) {
    await prisma.$executeRaw`DELETE FROM "barber_usage_events" WHERE "barbershopId" = ANY(${sid}::text[])`.catch(() => 0);
    await prisma.barberUser.deleteMany({ where: { barbershopId: { in: sid } } });
    await prisma.barbershop.deleteMany({ where: { parentId: { in: sid } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: sid } } });
  }
  await prisma.$disconnect();
});

const quien = (barbershopId: string, userId: string, sessionId = `${RUN}-s1`) => ({ barbershopId, userId, sessionId });

async function filasDe(userId: string) {
  return prisma.$queryRaw<Array<{ type: string; screen: string; action: string | null; target: string | null; barbershopId: string }>>`
    SELECT "type", "screen", "action", "target", "barbershopId" FROM "barber_usage_events"
    WHERE "userId" = ${userId} ORDER BY "createdAt", "type"`;
}

test("registro en lote: se guarda la pantalla sin ids y SOLO textos del panel", { skip }, async () => {
  reg.olvidarUsoListo();
  const lote = core.validarLote({
    sid: `${RUN}-s1`,
    events: [
      { k: "S", p: "/barber/inicio" },
      { k: "V", p: "/barber/clientes/cmwj33u4e000297chet5iq1rg?q=juan" },
      { k: "C", p: "/barber/caja", a: "cobrar-ticket" },
      { k: "C", p: "/barber/mi-web", l: core.limpiarEtiqueta("Guardar y publicar") },
      { k: "C", p: "/barber/clientes", l: core.limpiarEtiqueta("Juan Pérez Gómez") },
      { k: "C", p: "/barber/clientes/x", l: core.limpiarEtiqueta("Escribir por WhatsApp"), h: "externo" },
      { k: "C", p: "/barber/inicio", h: "/barber/caja" },
    ],
  })!;
  const r = await reg.registrarLote(prisma, quien(ids.a, ids.ua), lote.eventos);
  assert.equal(r.off, undefined);
  assert.equal(r.guardados, 7);
  const filas = await filasDe(ids.ua);
  assert.equal(filas.length, 7);
  assert.ok(filas.every((f) => f.barbershopId === ids.a));
  assert.ok(filas.some((f) => f.screen === "/barber/clientes/[id]"));
  const acciones = filas.map((f) => f.action);
  assert.ok(acciones.includes("accion:cobrar-ticket"));
  assert.ok(acciones.includes("Guardar y publicar"));
  const todo = JSON.stringify(filas);
  assert.equal(/juan|pérez|gómez|cmwj33/i.test(todo), false, `no se guarda ningún dato de cliente: ${todo}`);
  assert.ok(filas.some((f) => f.target === "externo"));
  assert.ok(filas.some((f) => f.target === "/barber/caja"));
});

test("tope por usuario y minuto: lo que pasa del tope se tira", { skip }, async () => {
  const uno = core.validarLote({ sid: `${RUN}-s2`, events: Array.from({ length: 50 }, () => ({ k: "C", p: "/barber/caja", l: "Cobrar" })) })!.eventos;
  let guardados = 0;
  let recortados = 0;
  for (let i = 0; i < 4; i++) {
    const r = await reg.registrarLote(prisma, quien(ids.b, ids.ub, `${RUN}-s2`), uno);
    guardados += r.guardados;
    recortados += r.recortados;
  }
  assert.equal(guardados, core.USO_TOPE_SERVIDOR_MIN);
  assert.equal(recortados, 200 - core.USO_TOPE_SERVIDOR_MIN);
  // Otro usuario no se ve afectado por el tope de éste.
  const otro = await reg.registrarLote(prisma, quien(ids.a2, ids.ua2, `${RUN}-s3`), uno.slice(0, 5));
  assert.equal(otro.guardados, 5);
});

test("agregados del mes: totales, por día (Mérida), por persona, pantallas y botones — y sin fugas", { skip }, async () => {
  // Datos a mano con fechas fijas del mes pasado (el registro solo acepta horas recientes).
  const ahora = new Date();
  const mes = act.mesesDelSelector(ahora)[1]; // el mes anterior: completo
  const [y, m] = mes.clave.split("-").map(Number);
  const merida = (d: number, h: number, min = 0) => new Date(Date.UTC(y, m - 1, d, h + 6, min)); // Mérida = UTC−6
  const fila = (shop: string, user: string, sid: string, type: string, screen: string, at: Date, action: string | null = null, target: string | null = null) =>
    prisma.$executeRaw`INSERT INTO "barber_usage_events" ("id","barbershopId","userId","sessionId","type","screen","action","target","createdAt")
      VALUES (${`${RUN}-${Math.random().toString(36).slice(2)}`}, ${shop}, ${user}, ${sid}, ${type}, ${screen}, ${action}, ${target}, ${at})`;
  await fila(ids.a, ids.ua, "x1", "SESSION", "/barber/inicio", merida(3, 9));
  await fila(ids.a, ids.ua, "x1", "VIEW", "/barber/inicio", merida(3, 9));
  await fila(ids.a, ids.ua, "x1", "VIEW", "/barber/caja", merida(3, 9, 5));
  await fila(ids.a, ids.ua, "x1", "CLICK", "/barber/caja", merida(3, 9, 6), "accion:cobrar-ticket");
  await fila(ids.a, ids.ua, "x1", "CLICK", "/barber/caja", merida(3, 9, 7), "accion:cobrar-ticket");
  // 23:30 de Mérida del día 3 = 05:30 UTC del día 4: cuenta para el DÍA 3.
  await fila(ids.a, ids.ua, "x1", "CLICK", "/barber/caja", merida(3, 23, 30), null, "/barber/inicio");
  // La sucursal (otra persona) cuenta para la matriz.
  await fila(ids.a2, ids.ua2, "x2", "SESSION", "/barber/agenda", merida(10, 12));
  await fila(ids.a2, ids.ua2, "x2", "VIEW", "/barber/agenda", merida(10, 12));
  await fila(ids.a2, ids.ua2, "x2", "CLICK", "/barber/agenda", merida(10, 12, 1), "Guardar");
  // Otra barbería: NO puede aparecer.
  await fila(ids.b, ids.ub, "x3", "CLICK", "/barber/caja", merida(3, 10), "accion:cobrar-ticket");
  // Último minuto del mes anterior a éste: fuera.
  await fila(ids.a, ids.ua, "x0", "CLICK", "/barber/caja", new Date(mes.desde.getTime() - 60_000), "accion:fuera");

  const r = await act.actividadDeBarberias([ids.a, ids.a2], mes.clave, prisma, ahora);
  assert.equal(r.disponible, true);
  assert.equal(r.mes.clave, mes.clave);
  assert.deepEqual(r.totales, { diasActivos: 2, sesiones: 2, vistas: 3, clics: 4, usuarios: 2 });
  const d3 = r.dias.find((d) => d.dia === `${mes.clave}-03`)!;
  assert.deepEqual(d3, { dia: `${mes.clave}-03`, sesiones: 1, vistas: 2, clics: 3 });
  assert.equal(r.dias.find((d) => d.dia === `${mes.clave}-04`)!.clics, 0, "las 23:30 de Mérida NO se van al día siguiente");
  assert.equal(r.dias.length, new Date(Date.UTC(y, m, 0)).getUTCDate(), "un mes pasado trae todos sus días");

  const ua = r.usuarios.find((u) => u.userId === ids.ua)!;
  assert.equal(ua.clics, 3);
  assert.equal(ua.sesiones, 1);
  assert.ok(ua.ultimoAcceso, "último acceso de siempre");
  assert.equal(r.usuarios.some((u) => u.userId === ids.ub), false, "la otra barbería no aparece");
  assert.equal(r.pantallas.reduce((s, p) => s + p.vistas, 0), 3);
  assert.ok(r.pantallas.every((p) => p.nombre && !p.nombre.startsWith("/barber/")), "las pantallas del menú salen con su nombre");
  assert.deepEqual(r.acciones[0], { accion: "cobrar-ticket", clics: 2 });
  assert.equal(r.acciones.some((a) => a.accion === "fuera"), false);

  // Solo la sucursal: no ve lo de la matriz.
  const solo = await act.actividadDeBarberias([ids.a2], mes.clave, prisma, ahora);
  assert.equal(solo.totales.clics, 1);
  // Sin ids no se consulta nada (un filtro vacío NO es «todas»).
  const vacio = await act.actividadDeBarberias([], mes.clave, prisma, ahora);
  assert.equal(vacio.totales.clics, 0);
});

test("lista: último uso y clics del mes; sin uso = 0 (con la tabla)", { skip }, async () => {
  const l = await act.usoParaLista([ids.a, ids.b, ids.a2]);
  assert.equal(l.disponible, true);
  assert.ok(l.porBarberia.get(ids.a)!.ultimoUso, "la A usó el panel hoy");
  assert.equal(l.porBarberia.get(ids.b)!.clicsMes, core.USO_TOPE_SERVIDOR_MIN, "los clics de hoy de B (el tope)");
  // Los 5 toques de la primera prueba (hoy); los del mes pasado NO cuentan.
  assert.equal(l.porBarberia.get(ids.a)!.clicsMes, 5, "solo los clics de ESTE mes");
});

test("sin la tabla: el registro se apaga, la ficha dice «no disponible» y nada truena", { skip }, async () => {
  // Se aparta la tabla un momento (SOLO en la base local) y se devuelve siempre.
  await prisma.$executeRawUnsafe(`ALTER TABLE "barber_usage_events" RENAME TO "barber_usage_events_${RUN}"`);
  try {
    reg.olvidarUsoListo();
    const r = await reg.registrarLote(prisma, quien(ids.a, ids.ua), [
      { type: "VIEW", screen: "/barber/inicio", accion: null, etiqueta: null, target: null, at: null },
    ]);
    assert.deepEqual(r, { off: true, guardados: 0, recortados: 0 });
    const ficha = await act.actividadDeBarberias([ids.a], null, prisma);
    assert.equal(ficha.disponible, false);
    assert.equal(ficha.meses.length, act.MESES_EN_SELECTOR);
    const lista = await act.usoParaLista([ids.a]);
    assert.equal(lista.disponible, false);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "barber_usage_events_${RUN}" RENAME TO "barber_usage_events"`);
    reg.olvidarUsoListo();
  }
});

test("si quitan la tabla con el proceso vivo, el «sí está» se olvida y no truena", { skip }, async () => {
  reg.olvidarUsoListo();
  assert.equal(await reg.usoListo(prisma), true);
  await prisma.$executeRawUnsafe(`ALTER TABLE "barber_usage_events" RENAME TO "barber_usage_events_${RUN}"`);
  try {
    const r = await reg.registrarLote(prisma, quien(ids.a, ids.ua), [
      { type: "VIEW", screen: "/barber/inicio", accion: null, etiqueta: null, target: null, at: null },
    ]);
    assert.equal(r.off, true);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "barber_usage_events_${RUN}" RENAME TO "barber_usage_events"`);
    reg.olvidarUsoListo();
  }
});
