// ═══════════════════════════════════════════════════════════════════════
// El aviso «nadie puede reservar» de Inicio, POR SEDE (ws6-t6, 16-nov-2026).
//
// Lo que vio Rafael: guardó su horario en la sede principal y Inicio seguía
// diciendo «Nadie puede reservar en línea: no hay ni un horario cargado».
// La cookie del selector apuntaba a una sede CERRADA y vacía: Inicio la deja
// consultar (resolveBranchScope), pero Horarios/Agenda/Caja operan la propia
// (withActiveBranch). El aviso hablaba de la sede cerrada sin nombrarla.
//
// Se reproduce la cadena de prueba de panel.108: matriz con barberos y
// horario, una sucursal CERRADA vacía y una sucursal ACTIVA sin barberos.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/aviso-por-sede-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import Module from "node:module";
// El pintado de Inicio usa useRouter (botón «Actualizar»): fuera de Next se dobla.
{
  const M = Module as unknown as { _load: (r: string, ...rest: unknown[]) => unknown };
  const real = M._load;
  M._load = function (r: string, ...rest: unknown[]) {
    if (r === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/barber/inicio" };
    if (r.endsWith(".css")) return {};
    return real.call(this, r, ...rest);
  };
}
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { getInicioSummary } from "../stats";
import { BARBER_BRANCH_ALL } from "@/lib/barber/branch-cookie";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

const RUN = `av${Date.now().toString(36)}`;
const PRO = { publicBooking: true, cash: true, analytics: true };

let ctx: BarberContext;
let matriz = "";
let cerrada = "";
let vacia = "";

before(async () => {
  if (!HAS_DB) return;
  const m = await prisma.barbershop.create({
    data: { name: "Barbería Prueba", slug: `${RUN}-m`, plan: "PROFESIONAL", subscriptionStatus: "active", isMainBranch: true },
  });
  matriz = m.id;
  cerrada = (
    await prisma.barbershop.create({
      data: { name: "Barbería Prueba", branchName: "Sede Vieja", slug: `${RUN}-c`, plan: "PROFESIONAL", subscriptionStatus: "active", parentId: m.id, isActive: false },
    })
  ).id;
  vacia = (
    await prisma.barbershop.create({
      data: { name: "Barbería Prueba", branchName: "Norte", slug: `${RUN}-n`, plan: "PROFESIONAL", subscriptionStatus: "active", parentId: m.id },
    })
  ).id;
  const user = await prisma.barberUser.create({
    data: { barbershopId: m.id, supabaseId: `${RUN}-owner`, email: `${RUN}@test.local`, firstName: "Rafael", lastName: "P", role: "OWNER" },
  });
  ctx = { barberUserId: user.id, barbershopId: m.id, barbershop: m, user, barber: null, role: "OWNER" };
  const b = await prisma.barber.create({ data: { barbershopId: m.id, name: "Uno" }, select: { id: true } });
  await prisma.barberSchedule.create({ data: { barbershopId: m.id, barberId: b.id, dayOfWeek: 1, startMinute: 600, endMinute: 1200 } });
});

after(async () => {
  if (!HAS_DB) return;
  const ids = (await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } })).map((s) => s.id);
  await prisma.barbershop.deleteMany({ where: { id: { in: ids }, parentId: { not: null } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("lo de Rafael: la cookie apunta a la sede CERRADA → Inicio ve la MISMA sede que Agenda (la principal), sin aviso", { skip }, async () => {
  const s = await getInicioSummary(ctx, { features: PRO, branchId: cerrada });
  assert.deepEqual(s.scope.branchIds, [matriz], "una sede cerrada nunca queda elegida: se pasa a la principal");
  assert.equal(s.scope.activeBranchId, matriz);
  assert.equal(s.setup.bookingBlocked, false, "la principal tiene horario");
  assert.deepEqual(s.setup.bookingBlockers, []);
  assert.equal(s.setup.viewingLabel, "Barbería Prueba");
  assert.equal(s.setup.operatingBranchId, matriz);
});

test("cambiar a una sede CERRADA (lo que hace el selector) resuelve a la principal; «toda la cadena» se respeta", { skip }, async () => {
  const { resolveBranchScope } = await import("@/lib/barber/branches");
  const scope = await resolveBranchScope(ctx, cerrada);
  assert.equal(scope.activeId, matriz);
  assert.equal(scope.isConsolidated, false);
  const todas = await resolveBranchScope(ctx, BARBER_BRANCH_ALL);
  assert.equal(todas.isConsolidated, true);
});

test("viendo la principal (con horario): sin aviso", { skip }, async () => {
  const s = await getInicioSummary(ctx, { features: PRO, branchId: matriz });
  assert.equal(s.setup.bookingBlocked, false);
  assert.equal(s.setup.viewingLabel, "Barbería Prueba");
});

test("una sede ACTIVA sin barberos dice «no tiene barberos», no «no hay horario»", { skip }, async () => {
  const s = await getInicioSummary(ctx, { features: PRO, branchId: vacia });
  assert.deepEqual(s.setup.bookingBlockers, [{ branchId: vacia, label: "Norte", slug: `${RUN}-n`, reason: "noBarbers" }]);
});

test("toda la cadena: avisa SOLO por las sedes activas que fallan, y las nombra", { skip }, async () => {
  const s = await getInicioSummary(ctx, { features: PRO, branchId: BARBER_BRANCH_ALL });
  assert.equal(s.scope.consolidated, true);
  assert.deepEqual(s.setup.bookingBlockers.map((b) => [b.label, b.reason]), [["Norte", "noBarbers"]], "la cerrada no, la principal tampoco");
});

test("pintado: el aviso nombra la sede (es y en) y la cookie en la cerrada no lo dispara", { skip }, async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { InicioView } = await import("@/components/barber/dashboard/inicio-view");
  const { getBarberT } = await import("@/i18n/dictionaries/barber");
  const pinta = (summary: Awaited<ReturnType<typeof getInicioSummary>>, locale: "es" | "en") =>
    renderToStaticMarkup(
      createElement(InicioView, { summary, t: getBarberT(locale), locale, firstName: "Rafael", branches: [], slug: `${RUN}-m` }),
    );
  // Toda la cadena: «Norte» (activa, sin barberos) sí; la cerrada no.
  const html = pinta(await getInicioSummary(ctx, { features: PRO, branchId: BARBER_BRANCH_ALL }), "es");
  assert.match(html, /Norte no tiene barberos/);
  assert.ok(html.includes(`/b/${RUN}-n/reservar`), "con la liga de ESA sede");
  assert.doesNotMatch(html, /Sede Vieja/);
  const cerradaHtml = pinta(await getInicioSummary(ctx, { features: PRO, branchId: cerrada }), "es");
  assert.doesNotMatch(cerradaHtml, /nadie puede reservar/i, "con la cookie en la cerrada se ve la principal: sin aviso");
  const en = pinta(await getInicioSummary(ctx, { features: PRO, branchId: BARBER_BRANCH_ALL }), "en");
  assert.match(en, /Norte has no barbers/);
});

test("una sede activa con barbero y SIN horario: «no hay horario» con su nombre; al cargarlo se apaga", { skip }, async () => {
  const b = await prisma.barber.create({ data: { barbershopId: vacia, name: "Dos" }, select: { id: true } });
  let s = await getInicioSummary(ctx, { features: PRO, branchId: vacia });
  assert.deepEqual(s.setup.bookingBlockers.map((x) => [x.label, x.reason]), [["Norte", "noSchedules"]]);
  await prisma.barberSchedule.create({ data: { barbershopId: vacia, barberId: b.id, dayOfWeek: 2, startMinute: 600, endMinute: 1200 } });
  s = await getInicioSummary(ctx, { features: PRO, branchId: vacia });
  assert.deepEqual(s.setup.bookingBlockers, []);
  assert.equal(s.setup.bookingBlocked, false);
});

test("sin reserva en línea en el plan no hay aviso en ninguna sede", { skip }, async () => {
  const s = await getInicioSummary(ctx, { features: { ...PRO, publicBooking: false }, branchId: BARBER_BRANCH_ALL });
  assert.deepEqual(s.setup.bookingBlockers, []);
});
