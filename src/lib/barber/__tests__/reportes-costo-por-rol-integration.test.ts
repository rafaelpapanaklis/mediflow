// QA B (15-nov-2026) · Reportes: el costo y el margen de los productos solo
// los ve quien administra el catálogo (products.manage).
//
// En panel.108, con Recepción y con el Barbero, Reportes enseñaba «Margen
// $109.50 (54.9%)» en «Productos más vendidos» (de ahí sale el costo), y el
// CSV traía la columna Costo, aunque en Productos el costo ya no les llega.
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/reportes-costo-por-rol-integration.test.ts
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

const PRO = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const RUN = `rcost${Date.now().toString(36)}`;

let prisma: typeof import("@/lib/prisma")["prisma"];
let stats: typeof import("@/lib/barber/stats");
let shopId: string;
let barberId: string;
const ctxs: Record<string, BarberContext> = {};

// Etiquetas del CSV: cada llave se escribe tal cual (L.cost → "cost").
const L = new Proxy({}, { get: (_t, k) => (k === "sections" ? new Proxy({}, { get: (_x, j) => String(j) }) : String(k)) }) as never;

async function persona(tag: string, role: "OWNER" | "RECEPTION" | "BARBER", withBarber = false) {
  const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-${tag}`, email: `${RUN}-${tag}@test.local`, firstName: tag, lastName: "Prueba", role, barberId: withBarber ? barberId : null },
  });
  const barber = withBarber ? await prisma.barber.findUniqueOrThrow({ where: { id: barberId } }) : null;
  ctxs[tag] = { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber, role };
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  stats = await import("@/lib/barber/stats");
  const cash = await import("@/lib/barber/cash");
  shopId = (await prisma.barbershop.create({ data: { name: "Barbería Costos", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active" } })).id;
  barberId = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Beto", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(40) } })).id;
  const product = await prisma.barberProduct.create({ data: { barbershopId: shopId, name: "Aceite QA", price: new Prisma.Decimal(199.5), cost: new Prisma.Decimal(90), stock: 5 } });
  await persona("dueno", "OWNER");
  await persona("recepcion", "RECEPTION");
  await persona("barbero", "BARBER", true);
  await cash.openCashSession(ctxs.dueno, { openingAmount: 0 });
  await cash.createSale(ctxs.dueno, { barberId, items: [{ kind: "product", id: product.id, qty: 1 }], paymentMethod: "CASH" }, PRO);
});

after(async () => {
  if (!HAS_DB) return;
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: shopId } }).catch(() => {});
  await prisma.barberSale.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberStockMovement.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberProduct.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

test("el dueño ve costo y margen del producto, en pantalla y en el CSV", { skip }, async () => {
  const r = await stats.getReportsSummary(ctxs.dueno, { range: "month", features: PRO });
  const p = r.topProducts.find((x) => x.name === "Aceite QA");
  assert.ok(p, "el producto vendido sale en el reporte");
  assert.equal(p!.cost, 90);
  assert.equal(p!.margin, 109.5);
  assert.equal(r.can.productCost, true);
  assert.match(stats.buildReportsCsv(r, L), /Aceite QA,1,199\.5,90,109\.5,54\.9/);
});

test("🔴 Recepción y el Barbero: el producto sale, pero sin costo ni margen (ni en el CSV)", { skip }, async () => {
  for (const tag of ["recepcion", "barbero"]) {
    const r = await stats.getReportsSummary(ctxs[tag], { range: "month", features: PRO });
    const p = r.topProducts.find((x) => x.name === "Aceite QA");
    assert.ok(p, `${tag}: el producto vendido sale`);
    assert.equal(p!.revenue, 199.5, tag);
    assert.equal(p!.cost, null, `${tag}: costo`);
    assert.equal(p!.margin, null, `${tag}: margen`);
    assert.equal(p!.marginPct, null, `${tag}: margen %`);
    assert.equal(r.can.productCost, false, tag);
    const csv = stats.buildReportsCsv(r, L);
    assert.match(csv, /Aceite QA,1,199\.5,100/, `${tag}: fila sin costo (nombre, piezas, ingreso, reparto)`);
    assert.doesNotMatch(csv, /cost,margin,marginPct/, `${tag}: el CSV no trae columnas de costo`);
    assert.doesNotMatch(csv, /199\.5,90,109\.5/, `${tag}: ni los números`);
  }
});
