// ═══════════════════════════════════════════════════════════════════════
// CAMPAÑAS — las garantías que cuestan dinero o confianza si fallan.
//
// Las tres primeras son de BASE DE DATOS y no se pueden fingir con mocks:
// que un dado de baja NUNCA entre a una lista, que nadie reciba dos veces
// la misma campaña, y que una barbería jamás vea clientes de otra. Por eso
// van contra Postgres real.
//
//   docker run -d --name barber-campanas-pg -e POSTGRES_PASSWORD=barber \
//     -e POSTGRES_DB=barber -p 54333:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://postgres:barber@localhost:54333/barber \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test \
//     src/lib/barber/__tests__/campanas.test.ts
//
// Sin DATABASE_URL se SALTAN las de integración (no fallan); las puras
// corren siempre. JAMÁS apuntarlas a producción: crean y borran barberías.
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import {
  BARBER_CAMPAIGN_AUDIENCES,
  CAMPAIGN_LEDGER_KEY,
  CAMPAIGN_OPT_OUT_KEY,
  estimateBarberCampaignCost,
  listBarberCampaignAudience,
  listBarberCampaignOptOuts,
  readCampaignLedger,
  readCampaignOptOut,
  renderCampaignPromo,
  sanitizeCampaignPromo,
  setBarberCampaignOptOut,
} from "../campaigns";
import { BARBER_WA_PRICE_USD } from "../whatsapp-core";
import {
  barberPlanHasFeature,
  BARBER_FEATURE_KEYS,
  FALLBACK_BARBER_PLAN_CONFIG,
} from "../plan-shared";
import { CAMPAIGNS_FEATURE } from "@/app/api/barber/campaigns/_server";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const RUN = `c${Date.now().toString(36)}`;
/** Base NUMÉRICA para los teléfonos: mxTenDigits exige 10 dígitos reales,
 *  y un id en base36 trae letras que lo harían fallar por "sin teléfono". */
const PHONE_BASE = String(Date.now()).slice(-8);
const phoneOf = (n: number) => `55${PHONE_BASE.slice(0, 6)}${String(n).padStart(2, "0")}`;
const DAY = 86_400_000;

// ═══════════════ 1. Costo — la cifra que ve la barbería ═══════════════

test("el costo de 50 mensajes es el de MARKETING, no el de utilidad", () => {
  const cost = estimateBarberCampaignCost(50);
  assert.equal(cost.category, "MARKETING");
  assert.equal(cost.unitUsd, BARBER_WA_PRICE_USD.MARKETING);
  assert.equal(cost.messages, 50);
  // 50 × 0.0324 = 1.62 USD. Si esto cambia es porque cambió el precio de
  // Meta, y entonces hay que cambiarlo en whatsapp-core, no aquí.
  assert.equal(cost.totalUsd, 1.62);
  // Y que de verdad sea ~4x el de utilidad, que es el argumento con el que
  // la pantalla justifica pedir confirmación.
  assert.ok(cost.unitUsd > BARBER_WA_PRICE_USD.UTILITY * 3.5);
});

test("el costo nunca se redondea a cero en tandas chicas", () => {
  const one = estimateBarberCampaignCost(1);
  assert.ok(one.totalUsd > 0, "un mensaje tiene que costar algo visible");
  assert.equal(one.totalUsd, 0.0324);
  assert.equal(estimateBarberCampaignCost(0).totalUsd, 0);
  assert.equal(estimateBarberCampaignCost(-5).messages, 0);
});

// ═══════════════ 2. El texto que le llega al cliente ══════════════════

test("las fichas se cambian por el dato de cada cliente", () => {
  const out = renderCampaignPromo("Hola {nombre}, tu {servicio} con {barbero} te espera.", {
    nombre: "Luis",
    servicio: "Corte + barba",
    barbero: "Memo",
  });
  assert.equal(out, "Hola Luis, tu Corte + barba con Memo te espera.");
});

test("una ficha sin dato desaparece: nunca sale un {servicio} crudo", () => {
  const out = renderCampaignPromo("Te esperamos para tu {servicio} pronto.", {
    nombre: "Luis",
  });
  assert.ok(!out.includes("{servicio}"), "no puede salir la ficha cruda");
  assert.equal(out, "Te esperamos para tu pronto.");
});

test("una ficha desconocida se deja tal cual, no se borra sola", () => {
  const out = renderCampaignPromo("Promo {inventada} aquí", {});
  assert.equal(out, "Promo {inventada} aquí");
});

test("el texto se aplana: Meta rechaza un parámetro con saltos de línea", () => {
  const out = sanitizeCampaignPromo("  dos\nlíneas\ty  tabs  ");
  assert.equal(out, "dos líneas y tabs");
  assert.ok(!out.includes("\n"));
  assert.ok(sanitizeCampaignPromo("x".repeat(500)).length <= 300);
});

// ═══════════════ 3. Lectura de las llaves reservadas ══════════════════

test("una ficha sin bitácora se lee vacía, no truena", () => {
  const empty = readCampaignLedger(null);
  assert.equal(empty.lastAnyAt, null);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.last, {});
  assert.equal(readCampaignOptOut(null), null);
  assert.equal(readCampaignOptOut({ otraCosa: 1 }), null);
});

test("la bitácora solo acepta audiencias del catálogo", () => {
  const led = readCampaignLedger({
    [CAMPAIGN_LEDGER_KEY]: {
      last: { inactive: "2026-01-01T00:00:00.000Z", inventada: "2026-01-01T00:00:00.000Z" },
      lastAnyAt: "2026-01-01T00:00:00.000Z",
      total: 3,
    },
  });
  assert.equal(led.last.inactive, "2026-01-01T00:00:00.000Z");
  assert.equal((led.last as Record<string, string>).inventada, undefined);
  assert.equal(led.total, 3);
});

// ═══════════════ Fixtures de integración ══════════════════════════════

interface Shop {
  id: string;
  ctx: BarberContext;
}

const shops: Record<"A" | "B", Shop> = {} as any;
/** Clientes inactivos de A, del que más gastó al que menos. */
const clientsA: string[] = [];
let clientB = "";

async function makeShop(tag: string): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbería ${tag}`,
      slug: `${RUN}-${tag.toLowerCase()}`,
      plan: "AVANZADO",
      subscriptionStatus: "active",
    },
  });
  const user = await prisma.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `${RUN}-${tag}-owner`,
      email: `${RUN}-${tag}@test.local`,
      firstName: "Dueño",
      lastName: tag,
      role: "OWNER",
    },
  });
  return {
    id: shop.id,
    ctx: {
      barberUserId: user.id,
      barbershopId: shop.id,
      barbershop: shop,
      user,
      barber: null,
      role: "OWNER",
    },
  };
}

/** Cliente que no viene desde hace `daysAgo` y que gastó `spent` en total. */
async function makeInactiveClient(
  shopId: string,
  userId: string,
  name: string,
  phone: string,
  daysAgo: number,
  spent: number,
): Promise<string> {
  const last = new Date(Date.now() - daysAgo * DAY);
  const client = await prisma.barberClient.create({
    data: {
      barbershopId: shopId,
      name,
      phone,
      lastVisitAt: last,
      totalVisits: 3,
      createdAt: new Date(Date.now() - 400 * DAY),
    },
  });
  if (spent > 0) {
    await prisma.barberSale.create({
      data: {
        barbershopId: shopId,
        clientId: client.id,
        soldByUserId: userId,
        subtotal: new Prisma.Decimal(spent),
        total: new Prisma.Decimal(spent),
        createdAt: last,
      },
    });
  }
  return client.id;
}

before(async () => {
  if (!HAS_DB) return;
  shops.A = await makeShop("A");
  shops.B = await makeShop("B");

  // Tres inactivos de A con gastos distintos, creados en orden INVERSO al
  // que deberían salir: así la prueba del orden no pasa por casualidad.
  clientsA.push(
    await makeInactiveClient(shops.A.id, shops.A.ctx.barberUserId, "Poco Gasto", phoneOf(1), 200, 150),
  );
  clientsA.push(
    await makeInactiveClient(shops.A.id, shops.A.ctx.barberUserId, "Mucho Gasto", phoneOf(2), 100, 4800),
  );
  clientsA.push(
    await makeInactiveClient(shops.A.id, shops.A.ctx.barberUserId, "Gasto Medio", phoneOf(3), 150, 900),
  );

  clientB = await makeInactiveClient(
    shops.B.id,
    shops.B.ctx.barberUserId,
    "Cliente De B",
    phoneOf(9),
    300,
    9999,
  );
});

after(async () => {
  if (!HAS_DB) return;
  for (const shop of [shops.A, shops.B]) {
    if (!shop) continue;
    await prisma.barberSale.deleteMany({ where: { barbershopId: shop.id } });
    await prisma.barberMessage.deleteMany({ where: { barbershopId: shop.id } });
    await prisma.barberClient.deleteMany({ where: { barbershopId: shop.id } });
    await prisma.barberUser.deleteMany({ where: { barbershopId: shop.id } });
    await prisma.barbershop.delete({ where: { id: shop.id } });
  }
  await prisma.$disconnect();
});

// ═══════════════ 4. Las listas ════════════════════════════════════════

test("los inactivos salen ordenados por lo que gastaban", { skip }, async () => {
  const list = await listBarberCampaignAudience(shops.A.ctx, { audience: "inactive" });
  const names = list.targets.map((x) => x.name);
  assert.deepEqual(names.slice(0, 3), ["Mucho Gasto", "Gasto Medio", "Poco Gasto"]);
  assert.equal(list.targets[0].spentMxn, 4800);
});

test("con dos barberías, ninguna ve clientes de la otra", { skip }, async () => {
  const a = await listBarberCampaignAudience(shops.A.ctx, { audience: "inactive" });
  const b = await listBarberCampaignAudience(shops.B.ctx, { audience: "inactive" });

  assert.ok(a.targets.length >= 3);
  assert.equal(b.targets.length, 1);
  assert.equal(b.targets[0].clientId, clientB);

  const idsA = new Set(a.targets.map((x) => x.clientId));
  assert.ok(!idsA.has(clientB), "A no puede ver al cliente de B");
  assert.ok(
    !b.targets.some((x) => clientsA.includes(x.clientId)),
    "B no puede ver a los clientes de A",
  );
});

// ═══════════════ 5. Baja: nunca más entra a una lista ═════════════════

test("un cliente dado de baja no aparece en NINGUNA lista de envío", { skip }, async () => {
  const victim = clientsA[1]; // "Mucho Gasto": el más valioso, el peor de perder
  const before = await listBarberCampaignAudience(shops.A.ctx, { audience: "inactive" });
  assert.ok(before.targets.find((x) => x.clientId === victim)?.eligible);

  const res = await setBarberCampaignOptOut(shops.A.ctx, { clientId: victim, optOut: true });
  assert.equal(res.ok, true);

  // Se recorren TODAS las audiencias del catálogo, no solo la de inactivos:
  // la baja es global o no sirve de nada.
  for (const def of BARBER_CAMPAIGN_AUDIENCES) {
    const list = await listBarberCampaignAudience(shops.A.ctx, { audience: def.id });
    const row = list.targets.find((x) => x.clientId === victim);
    if (!row) continue;
    assert.equal(row.eligible, false, `${def.id}: un dado de baja quedó elegible`);
    assert.equal(row.skipReason, "optOut");
  }

  // Y se puede ver y revertir a mano.
  const bajas = await listBarberCampaignOptOuts(shops.A.ctx);
  assert.ok(bajas.some((x) => x.clientId === victim));

  await setBarberCampaignOptOut(shops.A.ctx, { clientId: victim, optOut: false });
  const after = await listBarberCampaignAudience(shops.A.ctx, { audience: "inactive" });
  assert.equal(after.targets.find((x) => x.clientId === victim)?.eligible, true);
});

test("la baja NO borra las otras llaves reservadas de la ficha", { skip }, async () => {
  const id = clientsA[2];
  // Se simula una bitácora de lealtad previa, como la que escribe la caja.
  await prisma.barberClient.update({
    where: { id },
    data: { preferences: { fade: "medio", __loyalty: { redeemedVisits: 7, redemptions: [] } } },
  });

  await setBarberCampaignOptOut(shops.A.ctx, { clientId: id, optOut: true });
  const row = await prisma.barberClient.findUnique({
    where: { id },
    select: { preferences: true },
  });
  const prefs = row!.preferences as Record<string, any>;
  assert.equal(prefs.fade, "medio", "se perdió una preferencia normal");
  assert.equal(prefs.__loyalty.redeemedVisits, 7, "se perdió la bitácora de lealtad");
  assert.ok(prefs[CAMPAIGN_OPT_OUT_KEY], "no se escribió la baja");

  await setBarberCampaignOptOut(shops.A.ctx, { clientId: id, optOut: false });
});

// ═══════════════ 6. No mandar dos veces ═══════════════════════════════

test("no se manda dos veces la misma campaña al mismo cliente", { skip }, async () => {
  const id = clientsA[0];
  const audience = "inactive" as const;
  const def = BARBER_CAMPAIGN_AUDIENCES.find((a) => a.id === audience)!;

  const before = await listBarberCampaignAudience(shops.A.ctx, { audience });
  assert.equal(before.targets.find((x) => x.clientId === id)?.eligible, true);

  // Se simula el sello que deja el envío: ayer le tocó esta campaña.
  const ayer = new Date(Date.now() - DAY).toISOString();
  await prisma.barberClient.update({
    where: { id },
    data: {
      preferences: {
        [CAMPAIGN_LEDGER_KEY]: { last: { [audience]: ayer }, lastAnyAt: ayer, total: 1 },
      },
    },
  });

  const after = await listBarberCampaignAudience(shops.A.ctx, { audience });
  const row = after.targets.find((x) => x.clientId === id);
  assert.equal(row?.eligible, false, "un repetido quedó elegible");
  assert.equal(row?.skipReason, "alreadySent");
  assert.equal(row?.lastSentAt, ayer);
  assert.ok(after.skipped.alreadySent >= 1);

  // Y pasado el plazo de repetición vuelve a entrar: el candado es una
  // pausa, no un destierro.
  const viejo = new Date(Date.now() - (def.repeatAfterDays + 5) * DAY).toISOString();
  await prisma.barberClient.update({
    where: { id },
    data: {
      preferences: {
        [CAMPAIGN_LEDGER_KEY]: { last: { [audience]: viejo }, lastAnyAt: viejo, total: 1 },
      },
    },
  });
  const later = await listBarberCampaignAudience(shops.A.ctx, { audience });
  assert.equal(later.targets.find((x) => x.clientId === id)?.eligible, true);

  await prisma.barberClient.update({ where: { id }, data: { preferences: Prisma.DbNull } });
});

test("respeta el descanso entre campañas DISTINTAS al mismo cliente", { skip }, async () => {
  const id = clientsA[0];
  // Recibió OTRA campaña anteayer. Nunca ha recibido la de inactivos.
  const anteayer = new Date(Date.now() - 2 * DAY).toISOString();
  await prisma.barberClient.update({
    where: { id },
    data: {
      preferences: {
        [CAMPAIGN_LEDGER_KEY]: { last: { birthday: anteayer }, lastAnyAt: anteayer, total: 1 },
      },
    },
  });

  const list = await listBarberCampaignAudience(shops.A.ctx, { audience: "inactive" });
  const row = list.targets.find((x) => x.clientId === id);
  assert.equal(row?.eligible, false, "se le iba a escribir dos veces en dos días");
  assert.equal(row?.skipReason, "cooldown");

  await prisma.barberClient.update({ where: { id }, data: { preferences: Prisma.DbNull } });
});

test("un cliente bloqueado tampoco entra", { skip }, async () => {
  const id = clientsA[2];
  await prisma.barberClient.update({ where: { id }, data: { blockedAt: new Date() } });
  const list = await listBarberCampaignAudience(shops.A.ctx, { audience: "inactive" });
  const row = list.targets.find((x) => x.clientId === id);
  // listBarberOutreach ya los excluye de raíz; si aun así apareciera, tiene
  // que venir marcado como no elegible. Las dos formas son correctas.
  if (row) assert.equal(row.eligible, false);
  await prisma.barberClient.update({ where: { id }, data: { blockedAt: null } });
});

// ═══════════════ 7. El plan: el Básico no entra ═══════════════════════

test("un plan Básico NO tiene la feature de campañas; Avanzado y Profesional sí", () => {
  // El gate del servidor (openCampaignsGate) es exactamente
  // `barberPlanHasFeature(plan, CAMPAIGNS_FEATURE)`. Aquí se comprueba el
  // dato del que depende: si algún día alguien metiera whatsappInbox en el
  // Básico, esta prueba se cae antes de que se regale el marketing.
  assert.equal(barberPlanHasFeature(FALLBACK_BARBER_PLAN_CONFIG.BASICO, CAMPAIGNS_FEATURE), false);
  assert.equal(barberPlanHasFeature(FALLBACK_BARBER_PLAN_CONFIG.AVANZADO, CAMPAIGNS_FEATURE), true);
  assert.equal(
    barberPlanHasFeature(FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL, CAMPAIGNS_FEATURE),
    true,
  );
  // Y que la llave exista de verdad en el catálogo: una feature inventada
  // se leería como false y dejaría a TODOS fuera.
  assert.ok(BARBER_FEATURE_KEYS.includes(CAMPAIGNS_FEATURE));
});
