// Integración contra Postgres REAL de /barber/servicios y /barber/configuracion
// (src/lib/barber/services.ts + settings.ts + el resolveBookingPolicy de
// booking.ts que lee la columna nueva).
//
// Lo que se prueba aquí NO se puede fingir con mocks: que dos barberías no
// se ven ni se editan los servicios, que cambiar un precio deja intacto el
// `priceAtBooking` de la cita ya agendada mientras la reserva pública ya
// enseña el nuevo, que retirar un servicio con citas no lo borra, que un
// slug ocupado se rechaza (validación Y índice único), y que la política de
// reserva vive en su columna y la lee el flujo público.
//
//   docker run -d --name barber-ajustes-pg -e POSTGRES_PASSWORD=x \
//     -e POSTGRES_DB=x -p 54333:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://postgres:x@localhost:54333/x \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test src/lib/barber/__tests__/ajustes-integration.test.ts
//
// Sin DATABASE_URL las pruebas se SALTAN (no fallan). Jamás apuntar esto a
// producción: crea y borra barberías.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError } from "@/lib/barber/permissions";
import { BarberAdminError } from "@/lib/barber/branches";
import { BARBER_DEFAULT_SERVICES } from "@/lib/barber/types";
import {
  createService,
  deleteService,
  listServices,
  reorderServices,
  reseedDefaultServices,
  updateService,
} from "@/lib/barber/services";
import {
  changeBarberSlug,
  checkSlugAvailability,
  getBarberSettings,
  readBookingPolicySetting,
  saveBookingPolicy,
  saveCampaignSettings,
  saveInactivitySettings,
  saveLoyaltySettings,
  updateBarberProfile,
} from "@/lib/barber/settings";
import { getPublicServices, resolveBookingPolicy } from "@/lib/barber/booking";
import { getBarberClientsConfig } from "@/lib/barber/clients";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const db = prisma;
const RUN = `aj${Date.now().toString(36)}`;

let ctxA: BarberContext;
let ctxB: BarberContext;
/** Un BARBER (rol sin services.manage ni settings.edit) de la barbería A. */
let ctxBarberA: BarberContext;

let corteA = "";
let barbaA = "";
let corteB = "";
let apptA = "";

/**
 * Parte un .sql en sentencias respetando los bloques dollar-quoted
 * ($tag$ … $tag$), que llevan ";" adentro. Quita las líneas de comentario.
 */
function splitSql(text: string): string[] {
  const sinComentarios = text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const out: string[] = [];
  let buf = "";
  let tag: string | null = null;
  for (let i = 0; i < sinComentarios.length; i++) {
    const ch = sinComentarios[i];
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sinComentarios.slice(i));
      if (m) {
        if (tag === null) tag = m[0];
        else if (tag === m[0]) tag = null;
        buf += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (ch === ";" && tag === null) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function makeShop(tag: string): Promise<{ ctx: BarberContext; barberCtx: BarberContext }> {
  const shop = await db.barbershop.create({
    data: {
      name: `Barbería ${RUN} ${tag}`,
      slug: `${RUN}-${tag}`,
      city: "Monterrey",
      plan: "AVANZADO",
      subscriptionStatus: "active",
    },
  });
  const owner = await db.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `sb-${RUN}-${tag}-owner`,
      email: `${RUN}-${tag}@test.local`,
      firstName: "Dueño",
      lastName: tag,
      role: "OWNER",
    },
  });
  const barbero = await db.barber.create({
    data: { barbershopId: shop.id, name: `Barbero ${tag}` },
  });
  const barberUser = await db.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `sb-${RUN}-${tag}-barber`,
      email: `${RUN}-${tag}-b@test.local`,
      firstName: "Barbero",
      lastName: tag,
      role: "BARBER",
      barberId: barbero.id,
    },
  });
  return {
    ctx: {
      barberUserId: owner.id,
      barbershopId: shop.id,
      barbershop: shop,
      user: owner,
      barber: null,
      role: "OWNER",
    },
    barberCtx: {
      barberUserId: barberUser.id,
      barbershopId: shop.id,
      barbershop: shop,
      user: barberUser,
      barber: barbero,
      role: "BARBER",
    },
  };
}

before(async () => {
  if (!HAS_DB) return;

  // Columnas sueltas que el schema Prisma no conoce. Las de clientes y
  // campañas se declaran igual que en sus .sql (sin el bucket de Storage,
  // que en un Postgres pelado no existe); la de reserva sale del .sql real.
  await db.$executeRawUnsafe(`ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT true`);
  await db.$executeRawUnsafe(`ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyThreshold" INTEGER NOT NULL DEFAULT 10`);
  await db.$executeRawUnsafe(`ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyReward" TEXT`);
  await db.$executeRawUnsafe(`ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "inactiveDays" INTEGER NOT NULL DEFAULT 60`);
  await db.$executeRawUnsafe(`ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "campaignCooldownDays" INTEGER NOT NULL DEFAULT 21`);
  await db.$executeRawUnsafe(`ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "campaignTemplates" JSONB`);
  for (const statement of splitSql(readFileSync("sql/barber_settings.sql", "utf8"))) {
    await db.$executeRawUnsafe(statement);
  }

  const a = await makeShop("a");
  const b = await makeShop("b");
  ctxA = a.ctx;
  ctxBarberA = a.barberCtx;
  ctxB = b.ctx;

  const [sCorteA, sBarbaA] = await Promise.all([
    db.barberService.create({
      data: { barbershopId: ctxA.barbershopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal("180.00"), category: "corte", sortOrder: 0 },
    }),
    db.barberService.create({
      data: { barbershopId: ctxA.barbershopId, name: "Barba", durationMin: 20, price: new Prisma.Decimal("140.00"), category: "barba", sortOrder: 1 },
    }),
  ]);
  corteA = sCorteA.id;
  barbaA = sBarbaA.id;
  const sCorteB = await db.barberService.create({
    data: { barbershopId: ctxB.barbershopId, name: "Corte B", durationMin: 30, price: new Prisma.Decimal("200.00"), category: "corte", sortOrder: 0 },
  });
  corteB = sCorteB.id;

  // Una cita FUTURA en A con el corte a 180: el precio queda congelado ahí.
  const client = await db.barberClient.create({
    data: { barbershopId: ctxA.barbershopId, name: "Cliente A", phone: `55${RUN.slice(-8).padStart(8, "1")}` },
  });
  const startAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const appt = await db.barberAppointment.create({
    data: {
      barbershopId: ctxA.barbershopId,
      clientId: client.id,
      barberId: ctxBarberA.barber!.id,
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      status: "CONFIRMED",
      services: { create: [{ serviceId: corteA, priceAtBooking: new Prisma.Decimal("180.00") }] },
    },
  });
  apptA = appt.id;
});

after(async () => {
  if (!HAS_DB) return;
  const ids = [ctxA?.barbershopId, ctxB?.barbershopId].filter(Boolean) as string[];
  if (ids.length) {
    // La FK barber_appointment_services.serviceId es NoAction: el cascade de
    // la barbería truena si la cita sigue apuntando al servicio. Se borra en
    // orden (misma trampa que documenta borrar una barbería en producción).
    await db.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: { in: ids } } } });
    await db.barberAppointment.deleteMany({ where: { barbershopId: { in: ids } } });
    await db.barbershop.deleteMany({ where: { id: { in: ids } } });
  }
  await db.$disconnect();
});

// ── Permisos ────────────────────────────────────────────────────────────

test("un BARBER no puede listar el catálogo de administración ni leer la configuración", { skip }, async () => {
  await assert.rejects(listServices(ctxBarberA), BarberForbiddenError);
  await assert.rejects(getBarberSettings(ctxBarberA), BarberForbiddenError);
  await assert.rejects(updateService(ctxBarberA, corteA, { price: "1" }), BarberForbiddenError);
});

// ── Aislamiento entre barberías ─────────────────────────────────────────

test("cada barbería ve SOLO sus servicios", { skip }, async () => {
  const a = await listServices(ctxA);
  const b = await listServices(ctxB);
  assert.deepEqual(a.services.map((s) => s.name).sort(), ["Barba", "Corte"]);
  assert.deepEqual(b.services.map((s) => s.name), ["Corte B"]);
  assert.ok(!a.services.some((s) => s.id === corteB));
});

test("editar, borrar o reordenar un servicio ajeno responde 404 y no toca nada", { skip }, async () => {
  await assert.rejects(updateService(ctxA, corteB, { price: "1" }), (e: unknown) => e instanceof BarberAdminError && e.status === 404);
  await assert.rejects(deleteService(ctxA, corteB), (e: unknown) => e instanceof BarberAdminError && e.status === 404);
  await assert.rejects(reorderServices(ctxA, [corteB]), (e: unknown) => e instanceof BarberAdminError && e.status === 404);
  const intacto = await db.barberService.findUnique({ where: { id: corteB } });
  assert.equal(Number(intacto!.price), 200);
});

// ── Precio congelado en la cita ─────────────────────────────────────────

test("cambiar el precio: la reserva pública lo enseña nuevo y la cita agendada conserva el viejo", { skip }, async () => {
  const antes = await listServices(ctxA);
  const corte = antes.services.find((s) => s.id === corteA)!;
  assert.equal(corte.upcomingCount, 1, "la cita futura cuenta como próxima");
  assert.equal(corte.deletable, false, "con una cita ya no se puede borrar");

  const r = await updateService(ctxA, corteA, { price: "220" });
  assert.equal(r.previousPrice, 180);
  assert.equal(r.service.price, 220);

  const publico = await getPublicServices(ctxA.barbershopId);
  assert.equal(publico.find((s) => s.id === corteA)!.price, 220, "la reserva pública ve el precio nuevo");

  const congelado = await db.barberAppointmentService.findFirst({ where: { appointmentId: apptA, serviceId: corteA } });
  assert.equal(Number(congelado!.priceAtBooking), 180, "priceAtBooking no se toca");

  // Mismo precio otra vez: no hay "cambio" que avisar.
  const r2 = await updateService(ctxA, corteA, { price: "220.00" });
  assert.equal(r2.previousPrice, null);
});

test("el precio se guarda en Decimal con 2 decimales; un precio inválido es 400", { skip }, async () => {
  const r = await updateService(ctxA, barbaA, { price: "149.5" });
  assert.equal(r.service.price, 149.5);
  const row = await db.barberService.findUnique({ where: { id: barbaA } });
  assert.equal(row!.price.toFixed(2), "149.50");
  await assert.rejects(updateService(ctxA, barbaA, { price: "abc" }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
  await assert.rejects(updateService(ctxA, barbaA, { price: "10.123" }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
  // 2 min redondea al escalón de 5 → 0 → por debajo del mínimo. (3 → 5 se acepta.)
  await assert.rejects(updateService(ctxA, barbaA, { durationMin: 2 }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
  await assert.rejects(updateService(ctxA, barbaA, { durationMin: "muchos" }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
  // Guardar sin cambios no es un error: devuelve la fila tal cual.
  const sinCambios = await updateService(ctxA, barbaA, { price: "149.50" });
  assert.equal(sinCambios.previousPrice, null);
  assert.equal(sinCambios.service.price, 149.5);
});

// ── Retirar, nunca borrar ───────────────────────────────────────────────

test("retirar un servicio con citas no lo borra ni rompe el historial", { skip }, async () => {
  const r = await updateService(ctxA, corteA, { isActive: false });
  assert.equal(r.service.isActive, false);

  const sigue = await db.barberService.findUnique({ where: { id: corteA } });
  assert.ok(sigue, "la fila sigue existiendo");
  const cita = await db.barberAppointmentService.findFirst({ where: { appointmentId: apptA } });
  assert.equal(cita!.serviceId, corteA, "la cita sigue apuntando al servicio");

  const publico = await getPublicServices(ctxA.barbershopId);
  assert.ok(!publico.some((s) => s.id === corteA), "retirado = fuera de la reserva pública");

  await assert.rejects(deleteService(ctxA, corteA), (e: unknown) => e instanceof BarberAdminError && e.status === 409);
  const sigue2 = await db.barberService.findUnique({ where: { id: corteA } });
  assert.ok(sigue2, "el 409 no borró nada");

  const back = await updateService(ctxA, corteA, { isActive: true });
  assert.equal(back.service.isActive, true);
});

test("un servicio sin citas ni ventas sí se puede borrar", { skip }, async () => {
  const nuevo = await createService(ctxA, { name: "Cejas", durationMin: 10, price: "60", category: "Facial" });
  assert.equal(nuevo.category, "facial", "la categoría se guarda en minúsculas");
  assert.equal(nuevo.deletable, true);
  await deleteService(ctxA, nuevo.id);
  assert.equal(await db.barberService.findUnique({ where: { id: nuevo.id } }), null);
});

// ── Orden y resiembra ───────────────────────────────────────────────────

test("reordenar escribe sortOrder consecutivo y los no enviados van detrás", { skip }, async () => {
  const cat = await reorderServices(ctxA, [barbaA]);
  assert.deepEqual(cat.services.map((s) => s.id), [barbaA, corteA]);
  assert.deepEqual(cat.services.map((s) => s.sortOrder), [0, 1]);
});

test("resembrar solo con el catálogo vacío", { skip }, async () => {
  await assert.rejects(reseedDefaultServices(ctxB), (e: unknown) => e instanceof BarberAdminError && e.status === 409);
  await db.barberService.deleteMany({ where: { barbershopId: ctxB.barbershopId } });
  const cat = await reseedDefaultServices(ctxB);
  assert.equal(cat.services.length, BARBER_DEFAULT_SERVICES.length);
  assert.deepEqual(
    cat.services.map((s) => s.name),
    BARBER_DEFAULT_SERVICES.map((s) => s.name),
  );
  // La barbería A no recibió nada.
  const a = await listServices(ctxA);
  assert.equal(a.services.length, 2);
});

// ── Configuración: datos y slug ─────────────────────────────────────────

test("los datos del negocio se editan solo en la barbería de la sesión", { skip }, async () => {
  const p = await updateBarberProfile(ctxA, { name: "  El Filo  ", phone: "81 1234 5678", timezone: "America/Monterrey" });
  assert.equal(p.name, "El Filo");
  assert.equal(p.timezone, "America/Monterrey");
  const b = await db.barbershop.findUnique({ where: { id: ctxB.barbershopId } });
  assert.equal(b!.name, `Barbería ${RUN} b`);
  await assert.rejects(updateBarberProfile(ctxA, { timezone: "Marte/Olympus" }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
  await assert.rejects(updateBarberProfile(ctxA, { name: "   " }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
  await assert.rejects(updateBarberProfile(ctxA, { email: "no-es-correo" }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
});

test("el slug: rechaza uno ocupado, uno reservado y sin confirmación; acepta uno libre normalizado", { skip }, async () => {
  const ocupado = await checkSlugAvailability(ctxA, `${RUN}-b`);
  assert.equal(ocupado.available, false);
  assert.equal(ocupado.problem, "taken");

  const propio = await checkSlugAvailability(ctxA, `${RUN}-a`);
  assert.equal(propio.current, true);

  assert.equal((await checkSlugAvailability(ctxA, "admin")).problem, "reserved");
  assert.equal((await checkSlugAvailability(ctxA, "ab")).problem, "short");

  await assert.rejects(changeBarberSlug(ctxA, `${RUN}-b`, true), (e: unknown) => e instanceof BarberAdminError && e.status === 409);
  await assert.rejects(changeBarberSlug(ctxA, `${RUN}-libre`, false), (e: unknown) => e instanceof BarberAdminError && e.status === 400);

  const r = await changeBarberSlug(ctxA, `  ${RUN} Nuevo Slug!  `, true);
  assert.equal(r.changed, true);
  assert.equal(r.slug, `${RUN}-nuevo-slug`);
  const a = await db.barbershop.findUnique({ where: { id: ctxA.barbershopId } });
  assert.equal(a!.slug, `${RUN}-nuevo-slug`);
  const b = await db.barbershop.findUnique({ where: { id: ctxB.barbershopId } });
  assert.equal(b!.slug, `${RUN}-b`, "la otra barbería no se toca");
});

// ── Fidelidad / inactividad / campañas (reusan clients.ts y campaigns.ts) ─

test("fidelidad e inactividad se guardan por barbería vía clients.ts", { skip }, async () => {
  const r = await saveLoyaltySettings(ctxA, { threshold: 7, reward: "Barba gratis", enabled: true });
  assert.equal(r.ok, true);
  assert.equal(r.value.threshold, 7);
  const vivo = await getBarberClientsConfig(ctxA);
  assert.equal(vivo.loyaltyThreshold, 7);
  assert.equal(vivo.loyaltyReward, "Barba gratis");
  const otra = await getBarberClientsConfig(ctxB);
  assert.equal(otra.loyaltyThreshold, 10, "la barbería B sigue con el default");

  const inact = await saveInactivitySettings(ctxA, { days: 45 });
  assert.equal(inact.ok, true);
  assert.equal((await getBarberClientsConfig(ctxA)).inactiveDays, 45);

  await assert.rejects(saveLoyaltySettings(ctxA, { threshold: 0 }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
  await assert.rejects(saveInactivitySettings(ctxA, { days: 2 }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
});

test("los días de descanso entre campañas se guardan vía campaigns.ts", { skip }, async () => {
  const r = await saveCampaignSettings(ctxA, { cooldownDays: 30 });
  assert.equal(r.ok, true);
  assert.equal(r.value.cooldownDays, 30);
  const view = await getBarberSettings(ctxA);
  assert.equal(view.campaigns.cooldownDays, 30);
  assert.equal((await getBarberSettings(ctxB)).campaigns.cooldownDays, 21);
  await assert.rejects(saveCampaignSettings(ctxA, { cooldownDays: 1 }), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
});

// ── Política de reserva ─────────────────────────────────────────────────

test("la política de reserva vive en su columna y la lee el flujo público", { skip }, async () => {
  const antes = await readBookingPolicySetting(ctxA);
  assert.equal(antes.persisted, true, "sql/barber_settings.sql aplicado");
  assert.equal(antes.policy, "manual");
  assert.equal(await resolveBookingPolicy(ctxA.barbershopId), "manual");

  const r = await saveBookingPolicy(ctxA, "auto");
  assert.equal(r.ok, true);
  assert.equal(await resolveBookingPolicy(ctxA.barbershopId), "auto");
  assert.equal(await resolveBookingPolicy(ctxB.barbershopId), "manual", "la otra barbería sigue en manual");

  await assert.rejects(saveBookingPolicy(ctxA, "lo-que-sea"), (e: unknown) => e instanceof BarberAdminError && e.status === 400);
  const view = await getBarberSettings(ctxA);
  assert.equal(view.booking.policy, "auto");
});

test("la vista de configuración no expone secretos", { skip }, async () => {
  const view = await getBarberSettings(ctxA);
  const json = JSON.stringify(view);
  assert.ok(!/whatsappToken|stripeCustomerId|stripeSubscriptionId|wabaId|phoneNumberId/.test(json));
  assert.deepEqual(Object.keys(view.profile).sort(), [
    "address", "branchName", "city", "email", "isMainBranch", "logoUrl", "name", "phone", "state", "timezone",
  ]);
});
