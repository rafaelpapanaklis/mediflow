// «Números del negocio» de la ficha de /admin/barberias (ws6-t1) contra
// Postgres LOCAL: agregados por mes (cortes en Mérida), matriz + sucursales
// con desglose por sede, una sucursal sola, sin fugas entre barberías, el
// dinero con la MISMA cuenta que Inicio/Reportes, y la ruta solo para admins.
// Nada de Stripe ni de Meta.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test --test-concurrency=1 src/lib/barber/__tests__/admin-numeros-integration.test.ts
//
// Necesita sql/barber_caja_completa.sql y sql/barber_tienda.sql pegados en esa base local.
import { sesion } from "./_permisos-arnes";
import { skip } from "./_base-local";
import Module from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const admin: { token: string | null } = { token: null };
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const cargaPrevia = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  const mod = cargaPrevia.call(this, request, parent, isMain);
  if (request !== "next/headers") return mod;
  const base = mod as { cookies: () => Promise<{ get: (n: string) => unknown }> };
  return {
    ...base,
    cookies: async () => {
      const c = await base.cookies();
      return { ...c, get: (n: string) => (n === "admin_token" && admin.token ? { name: n, value: admin.token } : c.get(n)) };
    },
  };
};

const RUN = `anum${Date.now().toString(36)}`;
type Prisma = typeof import("@/lib/prisma").prisma;
let prisma: Prisma;
let lib: typeof import("@/lib/barber/admin-numeros");
let dineroLib: typeof import("@/lib/barber/caja-dinero");
let ruta: typeof import("@/app/api/admin/barberias/[id]/numeros/route");
const ids = { a: "", a2: "", b: "", ua: "", ua2: "", ub: "", adminUser: "", svcA: "", svcA2: "" };
const TOKEN = `${RUN}-token-admin`;

// El mes que se mide = el mes ANTERIOR al de hoy (completo); «anterior» = el de antes.
let MES = "";
let PREV = "";
/** Hora de Mérida (UTC−6) de un día del mes medido → instante UTC. */
let merida: (dia: number, h: number, min?: number) => Date;
let meridaPrev: (dia: number, h: number) => Date;
let ultimoDia = 28;

before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).prisma;
  lib = await import("@/lib/barber/admin-numeros");
  dineroLib = await import("@/lib/barber/caja-dinero");
  ruta = await import("@/app/api/admin/barberias/[id]/numeros/route");
  const act = await import("@/lib/barber/uso/actividad");
  const meses = act.mesesDelSelector(new Date());
  MES = meses[1].clave;
  PREV = meses[2].clave;
  const [y, m] = MES.split("-").map(Number);
  const [py, pm] = PREV.split("-").map(Number);
  ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  merida = (d, h, min = 0) => new Date(Date.UTC(y, m - 1, d, h + 6, min));
  meridaPrev = (d, h) => new Date(Date.UTC(py, pm - 1, d, h + 6));

  const shop = (slug: string, extra: Record<string, unknown> = {}) =>
    prisma.barbershop.create({
      data: { name: `Num ${slug}`, slug: `${RUN}-${slug}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Merida", ...extra },
    });
  const a = await shop("a");
  const a2 = await shop("a2", { parentId: a.id, isMainBranch: false, branchName: "Norte" });
  const b = await shop("b");
  const user = (s: string, tag: string, isActive = true) =>
    prisma.barberUser.create({
      data: { barbershopId: s, supabaseId: `${RUN}-${tag}`, email: `${RUN}-${tag}@test.local`, firstName: "N", lastName: tag, role: "OWNER", isActive },
    });
  const ua = await user(a.id, "ua");
  await user(a.id, "ua-baja", false);
  const ua2 = await user(a2.id, "ua2");
  const ub = await user(b.id, "ub");
  const au = await prisma.adminUser.create({ data: { email: `${RUN}@admin.test`, passwordHash: "x" } });
  await prisma.adminSession.create({
    data: { adminUserId: au.id, tokenHash: createHash("sha256").update(TOKEN).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const svc = (s: string) => prisma.barberService.create({ data: { barbershopId: s, name: "Corte", price: 200, durationMin: 30 } });
  const svcA = await svc(a.id);
  const svcA2 = await svc(a2.id);
  Object.assign(ids, { a: a.id, a2: a2.id, b: b.id, ua: ua.id, ua2: ua2.id, ub: ub.id, adminUser: au.id, svcA: svcA.id, svcA2: svcA2.id });

  // Barberos: A 2 activos + 1 retirado; A2 1; B 3.
  for (const [s, n, act2] of [[a.id, 2, true], [a.id, 1, false], [a2.id, 1, true], [b.id, 3, true]] as const) {
    for (let i = 0; i < n; i++) await prisma.barber.create({ data: { barbershopId: s, name: `B${i}`, isActive: act2 } });
  }

  // Clientes: A 3 (2 dados de alta en el mes), A2 1 (en el mes), B 4.
  const cli = (s: string, tag: string, createdAt: Date) =>
    prisma.barberClient.create({ data: { barbershopId: s, name: `Cliente ${tag}`, phone: `${RUN}${tag}`, createdAt } });
  const c1 = await cli(a.id, "1", merida(2, 10));
  const c2 = await cli(a.id, "2", merida(20, 10));
  await cli(a.id, "3", meridaPrev(5, 10));
  const c4 = await cli(a2.id, "4", merida(3, 10));
  for (let i = 0; i < 4; i++) await cli(b.id, `b${i}`, merida(4, 10));

  // Citas del mes: A → 2 hechas (con cliente), 1 cancelada, 1 no llegó; A2 → 1 hecha; B → 5 hechas.
  const cita = (s: string, status: string, startAt: Date, clientId: string | null = null) =>
    prisma.barberAppointment.create({
      data: { barbershopId: s, status: status as never, startAt, endAt: new Date(startAt.getTime() + 1_800_000), clientId },
    });
  await cita(a.id, "DONE", merida(5, 11), c1.id);
  await cita(a.id, "DONE", merida(6, 11), c2.id);
  await cita(a.id, "CANCELLED", merida(7, 11), c1.id);
  await cita(a.id, "NO_SHOW", merida(8, 11), c2.id);
  await cita(a2.id, "DONE", merida(9, 11), c4.id);
  // Del mes anterior: no cuenta en el mes medido.
  await cita(a.id, "DONE", meridaPrev(9, 11), c1.id);
  for (let i = 0; i < 5; i++) await cita(b.id, "DONE", merida(10 + i, 11));

  // Tickets del mes. A: efectivo 200 + 20 de propina; tarjeta 300; uno cancelado de 500 (no cuenta);
  // un walk-in con servicio y cliente (da estrella) de 150 a las 23:30 del ÚLTIMO día (UTC ya es el mes siguiente).
  const venta = (s: string, user: string, pm: string, subtotal: number, tip: number, createdAt: Date, extra: Record<string, unknown> = {}, serviceId: string | null = null) =>
    prisma.barberSale.create({
      data: {
        barbershopId: s,
        soldByUserId: user,
        paymentMethod: pm as never,
        subtotal,
        tip,
        total: subtotal + tip,
        createdAt,
        ...extra,
        items: { create: [{ description: serviceId ? "Corte" : "Pomada", qty: 1, unitPrice: subtotal, serviceId }] },
      },
    });
  await venta(a.id, ua.id, "CASH", 200, 20, merida(5, 12));
  await venta(a.id, ua.id, "CARD", 300, 0, merida(6, 12));
  await venta(a.id, ua.id, "CASH", 500, 0, merida(7, 12), { notes: `[CANCELADA] ${new Date().toISOString()} prueba` });
  await venta(a.id, ua.id, "SPEI", 150, 0, merida(ultimoDia, 23, 30), { clientId: c2.id }, ids.svcA);
  // A2: transferencia 100.
  await venta(a2.id, ua2.id, "SPEI", 100, 0, merida(9, 12));
  // Mes anterior (A): efectivo 400.
  await venta(a.id, ua.id, "CASH", 400, 0, meridaPrev(10, 12));
  // B: 9,999 que NO pueden aparecer en A.
  await venta(b.id, ub.id, "CASH", 9999, 0, merida(5, 12));

  // Gastos del mes: A 80 en efectivo + 1 anulado (no cuenta); A2 20 con tarjeta.
  const gasto = (s: string, u: string, amount: number, method: string, at: Date, voided = false) =>
    prisma.$executeRaw`INSERT INTO "barber_cash_movements" ("id","barbershopId","type","method","amount","category","createdByUserId","createdAt","voidedAt","voidedByUserId")
      VALUES (${randomUUID()}, ${s}, 'EXPENSE', ${method}, ${amount}, 'insumos', ${u}, ${at}, ${voided ? at : null}, ${voided ? u : null})`;
  await gasto(a.id, ua.id, 80, "CASH", merida(6, 13));
  await gasto(a.id, ua.id, 999, "CASH", merida(6, 14), true);
  await gasto(a2.id, ua2.id, 20, "CARD", merida(9, 13));

  // Membresías: A 1 vigente + 1 vencida; B 1 vigente.
  const plan = await prisma.barberMembership.create({ data: { barbershopId: a.id, name: "Mensual", price: 500 } });
  const planB = await prisma.barberMembership.create({ data: { barbershopId: b.id, name: "Mensual", price: 500 } });
  const futuro = new Date(Date.now() + 10 * 86400000);
  await prisma.barberClientMembership.create({ data: { barbershopId: a.id, clientId: c1.id, membershipId: plan.id, endAt: futuro } });
  await prisma.barberClientMembership.create({ data: { barbershopId: a.id, clientId: c2.id, membershipId: plan.id, endAt: new Date(Date.now() - 86400000) } });
  const cb = await prisma.barberClient.findFirst({ where: { barbershopId: b.id } });
  await prisma.barberClientMembership.create({ data: { barbershopId: b.id, clientId: cb!.id, membershipId: planB.id, endAt: futuro } });

  // Tienda (A): uno creado en el mes sin pagar, uno pagado en línea en el mes ($350).
  const pedido = (s: string, folio: string, status: string, pay: string, total: number, createdAt: Date, paidAt: Date | null) =>
    prisma.$executeRaw`INSERT INTO "barber_product_orders" ("id","barbershop_id","branch_id","folio","client_name","client_phone","items","total","status","pay_method","paid_at","created_at","mp_payment_id")
      VALUES (${randomUUID()}, ${s}, ${s}, ${`${RUN}${folio}`}, 'Cliente', '000', '[{"productId":"p","name":"Pomada","unitPrice":1,"qty":1}]'::jsonb,
              ${total}, ${status}, ${pay}, ${paidAt}, ${createdAt}, ${paidAt ? `${RUN}${folio}` : null})`;
  await pedido(a.id, "p1", "PENDING", "STORE", 120, merida(11, 10), null);
  await pedido(a.id, "p2", "PAID_ONLINE", "MERCADOPAGO", 350, merida(12, 10), merida(12, 10, 5));
});

after(async () => {
  if (skip) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const sid = shops.map((s) => s.id);
  await prisma.$executeRaw`DELETE FROM "barber_product_orders" WHERE "barbershop_id" = ANY(${sid}::text[])`;
  await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY(${sid}::text[])`;
  await prisma.barberClientMembership.deleteMany({ where: { barbershopId: { in: sid } } });
  await prisma.barberMembership.deleteMany({ where: { barbershopId: { in: sid } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: sid } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: sid } } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: sid } } });
  await prisma.barbershop.deleteMany({ where: { parentId: { in: sid } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: sid } } });
  if (ids.adminUser) await prisma.adminUser.deleteMany({ where: { id: ids.adminUser } });
  await prisma.$disconnect();
});

async function getNumeros(id: string, mes?: string) {
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(`http://localhost/api/admin/barberias/${id}/numeros${mes ? `?mes=${mes}` : ""}`);
  const res = await ruta.GET(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as any };
}

test("matriz + sucursal: totales del mes y desglose por sede (Mérida, sin la otra barbería)", { skip }, async () => {
  const n = (await lib.numerosDelNegocio(ids.a, MES))!;
  assert.equal(n.mes.clave, MES);
  assert.equal(n.anterior.clave, PREV);
  assert.equal(n.esSucursal, false);
  assert.deepEqual(n.sedes.map((s) => [s.id, s.esMatriz]), [[ids.a, true], [ids.a2, false]]);
  assert.equal(n.sedes[1].nombre, "Norte");

  const t = n.total;
  assert.equal(t.clientes, 4);
  assert.equal(t.clientesNuevos, 3);
  assert.deepEqual(t.citas, { total: 5, hechas: 3, canceladas: 1, noLlego: 1 });
  assert.equal(t.barberosActivos, 3);
  assert.equal(t.usuariosPanel, 2);
  assert.equal(t.membresiasActivas, 1);
  assert.deepEqual(t.pedidos, { delMes: 2, pagadosEnLinea: 1, cobradoEnLinea: 350 });
  // 3 citas hechas con cliente + 1 walk-in con servicio y cliente.
  assert.equal(t.estrellasDadas, 4);

  // Dinero: 220 + 300 + 150 (A) + 100 (A2) = 770; propinas 20; el cancelado no cuenta.
  const d = t.dinero!;
  assert.equal(d.cobrado, 770);
  assert.equal(d.propinas, 20);
  assert.equal(d.ingresos, 750);
  assert.equal(d.tickets, 4);
  assert.equal(d.promedio, 187.5);
  assert.equal(d.porMetodo.CASH.total, 220);
  assert.equal(d.porMetodo.CARD.total, 300);
  assert.equal(d.porMetodo.SPEI.total, 250);
  assert.equal(d.gastos, 100);
  assert.equal(d.gastosCount, 2);

  // Mes anterior y cambio: 400 → 770 = +92.5 %.
  assert.equal(n.dineroAnterior!.cobrado, 400);
  assert.equal(n.cambioCobradoPct, 92.5);

  // Por sede.
  const [sa, sa2] = n.sedes;
  assert.equal(sa.clientes, 3);
  assert.equal(sa.clientesNuevos, 2);
  assert.equal(sa.dinero!.cobrado, 670);
  assert.equal(sa.dinero!.gastos, 80);
  assert.equal(sa.estrellasDadas, 3);
  assert.equal(sa2.clientes, 1);
  assert.equal(sa2.dinero!.cobrado, 100);
  assert.equal(sa2.dinero!.gastos, 20);
  assert.deepEqual(sa2.citas, { total: 1, hechas: 1, canceladas: 0, noLlego: 0 });
  // Lo de las sedes suma el total.
  assert.equal(sa.dinero!.cobrado + sa2.dinero!.cobrado, d.cobrado);
  assert.ok(!JSON.stringify(n).includes("9999"), "nada de la otra barbería");
});

test("una sola fórmula: el dinero es el de cargarDineroDeSedes / cajaResumen (Inicio y Reportes)", { skip }, async () => {
  const n = (await lib.numerosDelNegocio(ids.a, MES))!;
  const act = await import("@/lib/barber/uso/actividad");
  const mes = act.resolverMes(MES);
  const r = (await dineroLib.cargarDineroDeSedes([ids.a, ids.a2], { from: mes.desde, to: mes.hasta }, { tz: "America/Merida" }))!;
  assert.equal(n.total.dinero!.cobrado, r.dinero.charged);
  assert.equal(n.total.dinero!.ingresos, r.dinero.income);
  assert.equal(n.total.dinero!.gastos, r.dinero.expenses.total);
  assert.equal(n.total.dinero!.tickets, r.resumen.tickets.count);
});

test("la ficha de la sucursal: solo ella", { skip }, async () => {
  const n = (await lib.numerosDelNegocio(ids.a2, MES))!;
  assert.equal(n.esSucursal, true);
  assert.deepEqual(n.sedes.map((s) => s.id), [ids.a2]);
  assert.equal(n.total.clientes, 1);
  assert.equal(n.total.dinero!.cobrado, 100);
  assert.equal(n.total.estrellasDadas, 1);
});

test("otro mes: el anterior tiene sus propios números; un mes raro cae al mes en curso", { skip }, async () => {
  const p = (await lib.numerosDelNegocio(ids.a, PREV))!;
  assert.equal(p.mes.clave, PREV);
  assert.equal(p.total.dinero!.cobrado, 400);
  assert.equal(p.total.citas.hechas, 1);
  assert.equal(p.total.clientesNuevos, 1);
  const raro = (await lib.numerosDelNegocio(ids.a, "2099-99"))!;
  assert.equal(raro.mes.clave, raro.meses[0].clave);
});

test("ruta: sin admin 401 (también con sesión de barbería); con admin 200; barbería que no existe 404", { skip }, async () => {
  admin.token = null;
  sesion.supabaseId = `${RUN}-ua`;
  const sin = await getNumeros(ids.a, MES);
  assert.equal(sin.status, 401);
  assert.equal(sin.body.total, undefined);
  sesion.supabaseId = null;

  admin.token = TOKEN;
  const ok = await getNumeros(ids.a, MES);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.total.clientes, 4);
  // Solo agregados: ningún nombre ni teléfono de cliente.
  assert.equal(/Cliente |\b000\b/.test(JSON.stringify(ok.body)), false);
  assert.equal(ok.body.total.dinero.cobrado, 770);
  const nada = await getNumeros(`${RUN}-no-existe`);
  assert.equal(nada.status, 404);
  admin.token = null;
});

test("lista de /admin/barberias: columna Clientes por sede", { skip }, async () => {
  const adminLib = await import("@/lib/barber/admin");
  const filas = await adminLib.listBarbershopsForAdmin({ q: RUN });
  const por = new Map(filas.map((f) => [f.id, f.clients]));
  assert.equal(por.get(ids.a), 3);
  assert.equal(por.get(ids.a2), 1);
  assert.equal(por.get(ids.b), 4);
});
