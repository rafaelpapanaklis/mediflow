// «Origen» de la ficha de /admin/barberias (ws6-t1) contra Postgres LOCAL:
// la barbería que llegó referida por un socio lo dice (también desde su
// sucursal); la que llegó sola dice «directo».
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test --test-concurrency=1 src/lib/barber/__tests__/admin-origen-integration.test.ts
//
// Necesita sql/barber_afiliados.sql pegado en esa base local.
import { skip } from "./_base-local";
import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const RUN = `aori${Date.now().toString(36)}`;
type Prisma = typeof import("@/lib/prisma").prisma;
let prisma: Prisma;
let lib: typeof import("@/lib/barber/admin-origen");
const ids = { socio: "", a: "", a2: "", sola: "" };

before(async () => {
  if (skip) return;
  prisma = (await import("@/lib/prisma")).prisma;
  lib = await import("@/lib/barber/admin-origen");
  const shop = (slug: string, extra: Record<string, unknown> = {}) =>
    prisma.barbershop.create({
      data: { name: `Origen ${slug}`, slug: `${RUN}-${slug}`, plan: "BASICO", subscriptionStatus: "active", timezone: "America/Merida", ...extra },
    });
  const socio = await shop("socio");
  const a = await shop("a");
  const a2 = await shop("a2", { parentId: a.id, isMainBranch: false, branchName: "Norte" });
  const sola = await shop("sola");
  Object.assign(ids, { socio: socio.id, a: a.id, a2: a2.id, sola: sola.id });
  const cuenta = randomUUID();
  await prisma.$executeRaw`INSERT INTO "barber_affiliate_accounts" ("id","barbershopId","referralCode","updatedAt")
    VALUES (${cuenta}, ${socio.id}, ${`${RUN}COD`}, now())`;
  await prisma.$executeRaw`INSERT INTO "barber_affiliate_referrals" ("id","barbershopId","accountId","referredBarbershopId","code","status","firstTouchAt","signedUpAt","firstPaidAt","updatedAt")
    VALUES (${randomUUID()}, ${socio.id}, ${cuenta}, ${a.id}, ${`${RUN}COD`}, 'PAYING', ${"2026-10-01 10:00:00"}::timestamp, ${"2026-10-02 10:00:00"}::timestamp, ${"2026-10-03 10:00:00"}::timestamp, now())`;
  // Columnas timestamp SIN zona guardadas en UTC (como las escribe Prisma): se insertan como texto UTC.
});

after(async () => {
  if (skip) return;
  const sid = Object.values(ids).filter(Boolean);
  await prisma.$executeRaw`DELETE FROM "barber_affiliate_referrals" WHERE "barbershopId" = ANY(${sid}::text[])`;
  await prisma.$executeRaw`DELETE FROM "barber_affiliate_accounts" WHERE "barbershopId" = ANY(${sid}::text[])`;
  await prisma.barbershop.deleteMany({ where: { parentId: { in: sid } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: sid } } });
  await prisma.$disconnect();
});

test("referida por un socio: quién, código, alta y primer pago; también desde su sucursal", { skip }, async () => {
  for (const id of [ids.a, ids.a2]) {
    const o = await lib.cargarOrigenBarberia(id);
    assert.equal(o.disponible, true);
    assert.deepEqual(o.referida, {
      porId: ids.socio,
      porNombre: "Origen socio",
      codigo: `${RUN}COD`,
      estado: "PAYING",
      alta: "2026-10-02T10:00:00.000Z",
      primerPago: "2026-10-03T10:00:00.000Z",
    });
  }
});

test("llegó sola: directo (sin socio); el socio no aparece como referido de nadie más", { skip }, async () => {
  assert.deepEqual(await lib.cargarOrigenBarberia(ids.sola), { disponible: true, referida: null });
  assert.deepEqual(await lib.cargarOrigenBarberia(ids.socio), { disponible: true, referida: null });
});
