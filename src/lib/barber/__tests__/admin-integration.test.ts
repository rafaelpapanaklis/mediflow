// Integración contra Postgres REAL de la capa /admin/barberias.
//
// Lo que se prueba aquí NO se puede fingir con mocks: que responder desde el
// admin deja el mensaje con la etiqueta ADMIN en el MISMO hilo que lee la
// barbería, que el MRR del vertical no arrastra ni un peso del dental, que
// la nota es obligatoria de verdad y que la bitácora falla SUAVE mientras
// sql/barber_admin.sql no esté aplicado.
//
//   docker run -d --name barber-admin-pg -e POSTGRES_PASSWORD=barber \
//     -e POSTGRES_DB=barber -p 54331:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://postgres:barber@localhost:54331/barber \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test src/lib/barber/__tests__/admin-integration.test.ts
//
// Sin DATABASE_URL las pruebas se SALTAN (no fallan). Jamás apuntar esto a
// producción: crea y borra barberías.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import {
  BarberAdminError,
  BARBER_MANUAL_SUSPENDED_STATUS,
  addBarberAdminReply,
  changeBarbershopPlan,
  getBarberSupportMetrics,
  getBarberTicketForAdmin,
  getBarberVerticalMetrics,
  getBarbershopDetailForAdmin,
  listAdminBarberTickets,
  listBarberAdminActions,
  listBarbershopsForAdmin,
  setBarbershopSuspension,
} from "@/lib/barber/admin";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const db = prisma;
const RUN = `a${Date.now().toString(36)}`;
const ACTOR = { id: "admin-test-1", email: "rafael@dalecontrol.test" };

let shopId = "";
let branchId = "";
let ownerId = "";
let ticketId = "";
let clinicId = "";

before(async () => {
  if (!HAS_DB) return;

  // Precios del vertical en la tabla (la fuente única). El MRR de más abajo
  // se compara contra ESTOS números, nunca contra literales del código.
  await db.barberPlanConfig.upsert({
    where: { planId: "BASICO" },
    update: { priceMonthly: "199.00", messageQuota: 200 },
    create: {
      planId: "BASICO",
      name: "Básico",
      priceMonthly: "199.00",
      maxBarbers: 1,
      maxBranches: 1,
      messageQuota: 200,
      features: {},
    },
  });
  await db.barberPlanConfig.upsert({
    where: { planId: "AVANZADO" },
    update: { priceMonthly: "329.00", messageQuota: 600 },
    create: {
      planId: "AVANZADO",
      name: "Avanzado",
      priceMonthly: "329.00",
      maxBarbers: 5,
      maxBranches: 1,
      messageQuota: 600,
      features: {},
    },
  });

  const shop = await db.barbershop.create({
    data: {
      name: `Barbería ${RUN}`,
      slug: `${RUN}-matriz`,
      city: "Monterrey",
      plan: "BASICO",
      subscriptionStatus: "active",
      messagesUsedPeriod: 40,
    },
  });
  shopId = shop.id;

  const branch = await db.barbershop.create({
    data: {
      name: `Barbería ${RUN} Norte`,
      slug: `${RUN}-norte`,
      parentId: shop.id,
      isMainBranch: false,
      branchName: "Norte",
      plan: "BASICO",
      subscriptionStatus: "active",
      messagesUsedPeriod: 15,
    },
  });
  branchId = branch.id;

  const owner = await db.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `${RUN}-owner`,
      email: `${RUN}-owner@test.local`,
      firstName: "Dueño",
      lastName: "Prueba",
      role: "OWNER",
    },
  });
  ownerId = owner.id;

  await db.barber.create({ data: { barbershopId: shop.id, name: "Beto", isActive: true } });

  const ticket = await db.barberSupportTicket.create({
    data: {
      barbershopId: shop.id,
      createdByUserId: owner.id,
      subject: "No me llegan los recordatorios",
      category: "BUG",
      priority: "HIGH",
    },
  });
  ticketId = ticket.id;

  await db.barberSupportMessage.create({
    data: {
      ticketId: ticket.id,
      barbershopId: shop.id,
      authorType: "SHOP",
      authorUserId: owner.id,
      body: "Los clientes dicen que no reciben nada.",
    },
  });
});

after(async () => {
  if (!HAS_DB) return;
  if (shopId) await db.barbershop.deleteMany({ where: { OR: [{ id: shopId }, { parentId: shopId }] } });
  if (clinicId) await db.clinic.deleteMany({ where: { id: clinicId } });
  await db.$executeRawUnsafe("DROP TABLE IF EXISTS barber_admin_actions").catch(() => {});
  await db.$disconnect();
});

// ── A. Lista ────────────────────────────────────────────────────────────

test("la lista trae la matriz y su sucursal, con barberos y cupo del plan", { skip }, async () => {
  const rows = await listBarbershopsForAdmin({ q: RUN });
  const matriz = rows.find((r) => r.id === shopId);
  const sucursal = rows.find((r) => r.id === branchId);

  assert.ok(matriz, "la matriz debe aparecer en el roster");
  assert.equal(matriz!.isBranch, false);
  assert.equal(matriz!.branchCount, 1);
  assert.equal(matriz!.barbers, 1);
  assert.equal(matriz!.planPriceMonthly, "199.00", "el precio sale de barber_plan_configs");
  assert.equal(matriz!.messageQuota, 200);
  assert.equal(matriz!.whatsappConnected, true, "modo PLATFORM = conectada por el número nuestro");
  assert.equal(matriz!.openTickets, 1);

  assert.ok(sucursal, "la sucursal también se lista");
  assert.equal(sucursal!.isBranch, true);
  assert.equal(sucursal!.parentName, `Barbería ${RUN}`);
});

test("el filtro de sedes separa matrices de sucursales", { skip }, async () => {
  const soloMatrices = await listBarbershopsForAdmin({ q: RUN, scope: "parents" });
  const soloSucursales = await listBarbershopsForAdmin({ q: RUN, scope: "branches" });
  assert.ok(soloMatrices.every((r) => !r.isBranch));
  assert.ok(soloSucursales.every((r) => r.isBranch));
});

// ── D. Métricas: el MRR de barber NO toca el dental ─────────────────────

test("el MRR del vertical no incluye ni una suscripción del dental", { skip }, async () => {
  const antes = await getBarberVerticalMetrics();

  // Una cuenta del DENTAL, activa y cara, viva al mismo tiempo en la misma BD.
  const clinic = await db.clinic.create({
    data: {
      name: `Dental ${RUN}`,
      slug: `${RUN}-dental`,
      specialty: "GENERAL",
      trialEndsAt: new Date(Date.now() + 86400000),
      plan: "CLINIC",
      subscriptionStatus: "active",
      monthlyPrice: 9999,
    },
  });
  clinicId = clinic.id;

  const despues = await getBarberVerticalMetrics();

  assert.equal(
    despues.mrrMonthly,
    antes.mrrMonthly,
    "dar de alta una cuenta activa del dental NO puede mover el MRR de barber",
  );
  assert.equal(despues.accounts, antes.accounts, "una cuenta del dental no es una cuenta barber");

  // Y el número de barber sí es exactamente el de sus propios planes.
  const matricesActivas = await db.barbershop.findMany({
    where: { parentId: null, subscriptionStatus: { in: ["active", "trialing", "paid"] } },
    select: { plan: true },
  });
  const precios = new Map(
    (await db.barberPlanConfig.findMany({ select: { planId: true, priceMonthly: true } })).map(
      (p) => [p.planId, Number(p.priceMonthly)],
    ),
  );
  const esperado = matricesActivas.reduce((acc, s) => acc + (precios.get(s.plan) ?? 0), 0);
  assert.equal(Number(despues.mrrMonthly), esperado);

  // La sucursal NO se cuenta como cuenta (cobraría dos veces).
  assert.ok(despues.branches >= 1);
});

// ── C. Soporte: responder como ADMIN ────────────────────────────────────

test("responder desde el admin deja el mensaje con la etiqueta ADMIN en el mismo hilo", { skip }, async () => {
  const reply = await addBarberAdminReply(ticketId, {
    body: "Ya lo vimos: era el número sin verificar. Queda arreglado.",
    actor: ACTOR,
  });
  assert.equal(reply.authorType, "ADMIN");
  assert.equal(reply.authorName, "Soporte DaleControl");

  // Lo que ve la BARBERÍA: la fila cruda del mismo modelo que consume
  // /barber/soporte. La etiqueta tiene que ser ADMIN, no otra cosa.
  const enBd = await db.barberSupportMessage.findUniqueOrThrow({ where: { id: reply.id } });
  assert.equal(enBd.authorType, "ADMIN");
  assert.equal(enBd.ticketId, ticketId);
  assert.equal(enBd.barbershopId, shopId);
  assert.equal(enBd.authorUserId, ACTOR.id, "queda quién respondió, sin FK al dental");

  const hilo = await db.barberSupportMessage.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    hilo.map((m) => m.authorType),
    ["SHOP", "ADMIN"],
    "el hilo es UNO solo: la barbería primero, nuestra respuesta después",
  );

  // La pelota pasa a la barbería.
  const ticket = await db.barberSupportTicket.findUniqueOrThrow({ where: { id: ticketId } });
  assert.equal(ticket.status, "WAITING_REPLY");

  const detalle = await getBarberTicketForAdmin(ticketId);
  assert.equal(detalle!.messages.length, 2);
  assert.equal(detalle!.ticket.needsReply, false, "ya respondimos: deja de contar como espera");
});

test("un mensaje vacío no se guarda y un adjunto de otra barbería se rechaza", { skip }, async () => {
  await assert.rejects(
    () => addBarberAdminReply(ticketId, { body: "   ", actor: ACTOR }),
    (e: unknown) => e instanceof BarberAdminError && (e as BarberAdminError).status === 400,
  );
  await assert.rejects(
    () =>
      addBarberAdminReply(ticketId, {
        body: "con adjunto ajeno",
        attachments: [{ path: "barber-support/OTRA/x.png", name: "x.png", size: 1, type: "image/png" }],
        actor: ACTOR,
      }),
    (e: unknown) => e instanceof BarberAdminError,
  );
  // Prefijo correcto pero con escapatoria: empieza bien y apunta fuera.
  await assert.rejects(
    () =>
      addBarberAdminReply(ticketId, {
        body: "con adjunto que se escapa",
        attachments: [
          {
            path: `barber-support/${shopId}/../../barber-support/OTRA/x.png`,
            name: "x.png",
            size: 1,
            type: "image/png",
          },
        ],
        actor: ACTOR,
      }),
    (e: unknown) => e instanceof BarberAdminError,
  );

  const guardados = await db.barberSupportMessage.count({
    where: { ticketId, body: { contains: "adjunto" } },
  });
  assert.equal(guardados, 0, "ninguno de los dos intentos llegó a escribirse");
});

test("la bandeja pone arriba lo que espera nuestra respuesta", { skip }, async () => {
  const otro = await db.barberSupportTicket.create({
    data: {
      barbershopId: shopId,
      createdByUserId: ownerId,
      subject: "Duda de facturación",
      category: "FACTURACION",
      createdAt: new Date(Date.now() - 3 * 86400000),
      lastMessageAt: new Date(Date.now() - 3 * 86400000),
    },
  });

  const filas = await listAdminBarberTickets({ status: "OPEN", barbershopId: shopId });
  assert.ok(filas.length >= 2);
  assert.equal(filas[0].id, otro.id, "el más viejo SIN responder va primero");
  assert.equal(filas[0].needsReply, true);
  assert.ok((filas[0].waitingHours ?? 0) >= 70, "lleva ~72 h esperando");

  const metrics = await getBarberSupportMetrics();
  assert.ok(metrics.pendingReply >= 1);
  assert.ok(metrics.unanswered24h >= 1);
});

// ── B. Acciones manuales ────────────────────────────────────────────────

test("sin nota no se suspende ni se cambia de plan", { skip }, async () => {
  await assert.rejects(
    () => setBarbershopSuspension(shopId, { suspend: true, note: "", actor: ACTOR }),
    (e: unknown) => e instanceof BarberAdminError && (e as BarberAdminError).status === 400,
  );
  await assert.rejects(
    () => setBarbershopSuspension(shopId, { suspend: true, note: "corto", actor: ACTOR }),
    (e: unknown) => e instanceof BarberAdminError,
  );
  await assert.rejects(
    () => changeBarbershopPlan(shopId, { plan: "AVANZADO", note: null, actor: ACTOR }),
    (e: unknown) => e instanceof BarberAdminError,
  );

  const sinTocar = await db.barbershop.findUniqueOrThrow({ where: { id: shopId } });
  assert.equal(sinTocar.subscriptionStatus, "active", "nada se escribió");
  assert.equal(sinTocar.plan, "BASICO");
});

test("la acción manual se propaga a las sucursales y la bitácora falla SUAVE sin el .sql", { skip }, async () => {
  // Sin sql/barber_admin.sql aplicado: la acción ocurre igual, avisada.
  const res = await setBarbershopSuspension(shopId, {
    suspend: true,
    note: "Impago acordado por teléfono con el dueño.",
    actor: ACTOR,
  });
  assert.equal(res.audited, false, "sin la tabla, la acción se marca como NO auditada");
  assert.equal(res.branchesUpdated, 1, "la sucursal se suspende con la matriz");

  const matriz = await db.barbershop.findUniqueOrThrow({ where: { id: shopId } });
  const sucursal = await db.barbershop.findUniqueOrThrow({ where: { id: branchId } });
  assert.equal(matriz.subscriptionStatus, BARBER_MANUAL_SUSPENDED_STATUS);
  assert.equal(sucursal.subscriptionStatus, BARBER_MANUAL_SUSPENDED_STATUS);

  assert.equal(await listBarberAdminActions(shopId), null, "sin tabla, la ficha muestra el aviso");

  // Suspender dos veces no tiene sentido: 409.
  await assert.rejects(
    () => setBarbershopSuspension(shopId, { suspend: true, note: "otra vez lo mismo", actor: ACTOR }),
    (e: unknown) => e instanceof BarberAdminError && (e as BarberAdminError).status === 409,
  );
});

test("con sql/barber_admin.sql aplicado la acción queda registrada con su nota", { skip }, async () => {
  // Prisma no admite varios statements en una sola llamada: el .sql se aplica
  // sentencia por sentencia, igual que lo haría el editor de SQL de Supabase.
  const ddl = readFileSync("sql/barber_admin.sql", "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of ddl) await db.$executeRawUnsafe(statement);

  const nota = "Cortesía por el mes que estuvo caída su agenda.";
  const res = await changeBarbershopPlan(shopId, { plan: "AVANZADO", note: nota, actor: ACTOR });
  assert.equal(res.audited, true);
  assert.equal(res.shop.plan, "AVANZADO");
  assert.equal(res.branchesUpdated, 1);

  const sucursal = await db.barbershop.findUniqueOrThrow({ where: { id: branchId } });
  assert.equal(sucursal.plan, "AVANZADO", "el plan también baja a las sucursales");

  const bitacora = await listBarberAdminActions(shopId);
  assert.ok(bitacora && bitacora.length >= 1);
  assert.equal(bitacora![0].action, "PLAN_CHANGE");
  assert.equal(bitacora![0].note, nota);
  assert.equal(bitacora![0].beforeValue, "BASICO");
  assert.equal(bitacora![0].afterValue, "AVANZADO");
  assert.equal(bitacora![0].actorEmail, ACTOR.email);
});

test("una sucursal no se suspende ni cambia de plan por su cuenta", { skip }, async () => {
  await assert.rejects(
    () => setBarbershopSuspension(branchId, { suspend: true, note: "intento sobre la sucursal", actor: ACTOR }),
    (e: unknown) => e instanceof BarberAdminError && (e as BarberAdminError).status === 400,
  );
});

// ── B. Ficha ────────────────────────────────────────────────────────────

test("la ficha suma el consumo de WhatsApp de la familia y la actividad del mes", { skip }, async () => {
  const ahora = new Date();
  await db.barberAppointment.create({
    data: {
      barbershopId: shopId,
      clientName: "Cliente de prueba",
      startAt: ahora,
      endAt: new Date(ahora.getTime() + 1800000),
      status: "DONE",
    },
  });

  const detalle = await getBarbershopDetailForAdmin(shopId);
  assert.ok(detalle);
  assert.equal(detalle!.whatsapp.usedPeriod, 55, "40 de la matriz + 15 de la sucursal");
  assert.equal(detalle!.whatsapp.quota, 600, "cupo del plan AVANZADO, leído de la tabla");
  assert.equal(detalle!.activity.appointmentsThisMonth, 1);
  assert.equal(detalle!.activity.doneThisMonth, 1);
  assert.ok(detalle!.activity.ticketsThisMonth >= 2);
  assert.equal(detalle!.branches.length, 1);
  assert.ok(detalle!.team.some((m) => m.id === ownerId));
  assert.ok(detalle!.manualActions && detalle!.manualActions.length >= 1);
});
