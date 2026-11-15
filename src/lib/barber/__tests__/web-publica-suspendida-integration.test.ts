// SUSPENDIDA = NO SE PUEDE ACCEDER HASTA QUE PAGUE (decisión #10 de Rafael,
// 15-nov-2026): «si está suspendida no borres nada, pero que no se pueda
// acceder hasta que pague, y ahí se reactiva y ya se ve todo otra vez».
//
// Lo público —la web /b/<slug> y sus metadatos, la reserva, la fila y «mi
// cuenta»— usa EXACTAMENTE el criterio del panel (cobros.ts →
// barberiaAlCorriente): se oculta mientras la MATRIZ esté suspendida o
// cancelada por falta de pago, nunca a quien sí pagó, y vuelve sola.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local (_base-local.ts).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/web-publica-suspendida-integration.test.ts
import "./_sin-server-only";
import Module from "node:module";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { skip } from "./_base-local";

// La página /b/<slug> arrastra hojas de estilo: en Node pelado un .css no se
// puede cargar (lo resuelve el bundler de Next). Se devuelve vacío.
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const cargaOriginal = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith(".css")) return {};
  return cargaOriginal.call(this, request, parent, isMain);
};

let prisma: typeof import("@/lib/prisma")["prisma"];
let cargarBarberWeb: typeof import("@/app/b/[slug]/_shared/shop-data")["cargarBarberWeb"];
let cargarSeoBarberWeb: typeof import("@/app/b/[slug]/_shared/shop-data")["cargarSeoBarberWeb"];
let PaginaBarberia: typeof import("@/app/b/[slug]/page")["default"];
let resolveBookingGate: typeof import("@/lib/barber/booking")["resolveBookingGate"];
let resolvePublicShop: typeof import("@/app/api/barber/walkins/_server")["resolvePublicShop"];
let resolvePortalShop: typeof import("@/lib/barber/client-portal")["resolvePortalShop"];
let hasBarberPaidAccess: typeof import("@/lib/barber/paid-access")["hasBarberPaidAccess"];
let marcarReactivacionManualBarber: typeof import("@/lib/barber/cobros")["marcarReactivacionManualBarber"];

const DIA = 86_400_000;
const RUN = `web${Date.now().toString(36)}`;
const creadas: string[] = [];
let seq = 0;

async function familia(status: string, opts: { sedeStatus?: string } = {}) {
  const n = ++seq;
  const matriz = await prisma.barbershop.create({
    data: {
      name: `Web ${n}`,
      slug: `${RUN}-${n}`,
      plan: "PROFESIONAL" as never,
      subscriptionStatus: status,
      stripeCustomerId: `cus_${RUN}_${n}`,
      stripeSubscriptionId: `sub_${RUN}_${n}`,
    },
  });
  const sede = await prisma.barbershop.create({
    data: {
      name: `Web ${n} Norte`,
      slug: `${RUN}-${n}-norte`,
      plan: "PROFESIONAL" as never,
      subscriptionStatus: opts.sedeStatus ?? status,
      parentId: matriz.id,
    },
  });
  await prisma.barberService.create({
    data: { barbershopId: matriz.id, name: "Corte", durationMin: 30, price: 180, isActive: true },
  });
  creadas.push(sede.id, matriz.id);
  return { matriz, sede };
}

async function cobro(shopId: string, periodEnd: Date) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO barber_subscription_payments (id, barbershop_id, stripe_invoice_id, status, amount_cents, period_start, period_end, paid_at)
     VALUES ($1, $2, $3, 'paid', 74900, $4, $5, $4)`,
    randomUUID(), shopId, `in_${randomUUID()}`, new Date(periodEnd.getTime() - 30 * DIA), periodEnd,
  );
}

async function stripeRenovo(shopId: string, periodEnd: Date) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO barber_subscriptions (barbershop_id, stripe_status, current_period_end, price_cents, billing_interval)
     VALUES ($1, 'active', $2, 74900, 'month')
     ON CONFLICT (barbershop_id) DO UPDATE SET stripe_status = 'active', current_period_end = EXCLUDED.current_period_end`,
    shopId, periodEnd,
  );
}

/** ¿Lo público la deja ver? Las cinco puertas, una por una. */
async function puertas(slug: string) {
  const web = await cargarBarberWeb(slug);
  const seo = await cargarSeoBarberWeb(slug);
  const reserva = await resolveBookingGate(slug);
  const fila = await resolvePublicShop(slug);
  const cuenta = await resolvePortalShop(slug);
  return {
    web: web ? !web.sinAcceso : false,
    seo: seo !== null,
    reserva: reserva.ok === true || (reserva.ok === false && reserva.reason === "planOff"),
    // La fila puede faltar por plan (NO_FEATURE); lo que importa es que no esté CERRADA.
    fila: fila.error !== "CLOSED" && fila.error !== "NOT_FOUND",
    cuenta: cuenta !== null,
  };
}
const ABIERTA = { web: true, seo: true, reserva: true, fila: true, cuenta: true };
const CERRADA = { web: false, seo: false, reserva: false, fila: false, cuenta: false };

/** La página /b/<slug> de verdad: ¿responde «no encontrada»? */
async function pagina404(slug: string): Promise<boolean> {
  try {
    await PaginaBarberia({ params: Promise.resolve({ slug }) });
    return false;
  } catch (e) {
    const digest = String((e as { digest?: string })?.digest ?? (e as Error)?.message ?? "");
    if (/NOT_FOUND|404/.test(digest)) return true;
    throw e;
  }
}

before(async () => {
  if (skip) return;
  ({ prisma } = await import("@/lib/prisma"));
  ({ cargarBarberWeb, cargarSeoBarberWeb } = await import("@/app/b/[slug]/_shared/shop-data"));
  ({ default: PaginaBarberia } = await import("@/app/b/[slug]/page"));
  ({ resolveBookingGate } = await import("@/lib/barber/booking"));
  ({ resolvePublicShop } = await import("@/app/api/barber/walkins/_server"));
  ({ resolvePortalShop } = await import("@/lib/barber/client-portal"));
  ({ hasBarberPaidAccess } = await import("@/lib/barber/paid-access"));
  ({ marcarReactivacionManualBarber } = await import("@/lib/barber/cobros"));
});

after(async () => {
  if (skip) return;
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas }, parentId: { not: null } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas } } });
  await prisma.$disconnect();
});

test("suspendida (past_due) o cancelada: la web, sus metadatos, la reserva, la fila y «mi cuenta» se cierran — matriz Y sucursal", { skip }, async () => {
  for (const status of ["past_due", "canceled", "unpaid", "suspended"]) {
    const { matriz, sede } = await familia(status);
    assert.deepEqual(await puertas(matriz.slug), CERRADA, `${status} · matriz`);
    assert.deepEqual(await puertas(sede.slug), CERRADA, `${status} · sucursal`);
    assert.equal(await pagina404(matriz.slug), true, `${status} · /b/<slug> responde no encontrada`);
  }
});

test("la MATRIZ manda: una sucursal cuya matriz canceló se cierra aunque su propia fila diga active", { skip }, async () => {
  const { sede } = await familia("canceled", { sedeStatus: "active" });
  assert.deepEqual(await puertas(sede.slug), CERRADA);
});

test("vencida por fecha (sin que Stripe renovara): se cierra y queda past_due; nada se borra", { skip }, async () => {
  const { matriz, sede } = await familia("active");
  await cobro(matriz.id, new Date(Date.now() - 1.5 * DIA));
  assert.deepEqual(await puertas(sede.slug), CERRADA);
  const filas = await prisma.barbershop.findMany({ where: { id: { in: [matriz.id, sede.id] } }, select: { subscriptionStatus: true } });
  assert.deepEqual(filas.map((f) => f.subscriptionStatus).sort(), ["past_due", "past_due"]);
  assert.equal(await prisma.barberService.count({ where: { barbershopId: matriz.id } }), 1, "sus servicios siguen ahí");
});

test("quien SÍ pagó nunca se oculta: Stripe renovó y sigue active aunque falte su invoice.paid", { skip }, async () => {
  const { matriz, sede } = await familia("active");
  await cobro(matriz.id, new Date(Date.now() - 1.5 * DIA));
  await stripeRenovo(matriz.id, new Date(Date.now() + 28 * DIA));
  assert.deepEqual(await puertas(matriz.slug), ABIERTA);
  assert.deepEqual(await puertas(sede.slug), ABIERTA);
  assert.equal(await pagina404(matriz.slug), false);
});

test("las cortesías (active sin cobros) y la de prueba con su sucursal siguen visibles", { skip }, async () => {
  const cortesia = await familia("active");
  await prisma.barbershop.update({ where: { id: cortesia.matriz.id }, data: { stripeSubscriptionId: null } });
  assert.deepEqual(await puertas(cortesia.matriz.slug), ABIERTA);
  assert.deepEqual(await puertas(cortesia.sede.slug), ABIERTA);
  // Reactivada a mano con un cobro viejo: también (es cortesía de DaleControl).
  const manual = await familia("active");
  await cobro(manual.matriz.id, new Date(Date.now() - 40 * DIA));
  await marcarReactivacionManualBarber(manual.matriz.id);
  assert.deepEqual(await puertas(manual.matriz.slug), ABIERTA);
});

test("vuelve sola en cuanto paga: el cobro nuevo la deja al corriente y todo se ve otra vez", { skip }, async () => {
  const { matriz, sede } = await familia("past_due");
  await cobro(matriz.id, new Date(Date.now() - 3 * DIA));
  assert.deepEqual(await puertas(sede.slug), CERRADA);
  // Lo que escribe el webhook al llegar el invoice.paid (probado en suspension-integration).
  await cobro(matriz.id, new Date(Date.now() + 30 * DIA));
  await prisma.barbershop.updateMany({ where: { id: { in: [matriz.id, sede.id] } }, data: { subscriptionStatus: "active" } });
  assert.deepEqual(await puertas(matriz.slug), ABIERTA);
  assert.deepEqual(await puertas(sede.slug), ABIERTA);
  assert.equal(await pagina404(matriz.slug), false);
});

test("el panel y lo público dicen lo mismo (un solo criterio)", { skip }, async () => {
  const casos: Array<[string, (m: { id: string }) => Promise<void>]> = [
    ["al día", async (m) => cobro(m.id, new Date(Date.now() + 10 * DIA))],
    ["vencida", async (m) => cobro(m.id, new Date(Date.now() - 2 * DIA))],
    ["renovada", async (m) => {
      await cobro(m.id, new Date(Date.now() - 2 * DIA));
      await stripeRenovo(m.id, new Date(Date.now() + 28 * DIA));
    }],
  ];
  for (const [nombre, preparar] of casos) {
    const { matriz } = await familia("active");
    await preparar(matriz);
    const fila = (await prisma.barbershop.findUnique({ where: { id: matriz.id } }))!;
    const panel = await hasBarberPaidAccess({ barbershopId: matriz.id, barbershop: fila } as never);
    const web = !(await cargarBarberWeb(matriz.slug))!.sinAcceso;
    assert.equal(web, panel, nombre);
  }
});
