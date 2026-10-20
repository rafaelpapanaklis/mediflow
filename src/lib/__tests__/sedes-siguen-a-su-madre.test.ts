// ws1-t5 · auditoría del plan Clínica y sedes: A1 (las sedes siguen la suscripción de la madre), A2 (no se
// baja de Clínica con varias sedes), M1 (una sede nunca paga), M2 (cancelar/cambiar plan desde una sede),
// M5 (cupo de CFDI por dueño). Run: npx tsx --test src/lib/__tests__/sedes-siguen-a-su-madre.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findBranchMothers, type BranchBillingRow } from "@/lib/admin/mrr-core";
import { isPlanExpired } from "@/lib/plan-status";
import { cfdiOverage } from "@/lib/cfdi-quota";
import {
  agruparCfdiPorPagadora,
  avisoSedeIncluida,
  bloqueoDowngradePorSedes,
  cupoCfdiDelGrupo,
  datosDeSedeDesdeMadre,
  grupoDePago,
} from "@/lib/billing/sedes-incluidas-core";

const fuente = (r: string) => readFileSync(join(__dirname, "..", "..", "..", r), "utf8");
const dia = (d: string) => new Date(`${d}T12:00:00Z`);
const AHORA = dia("2026-10-20");

const madre: BranchBillingRow = {
  id: "madre", createdAt: dia("2026-01-01"), subscriptionStatus: "active", monthlyPrice: 1489,
  stripeSubscriptionId: "sub_1", nextBillingDate: dia("2027-10-07"),
};
const sede = (id: string, extra: Partial<BranchBillingRow> = {}): BranchBillingRow => ({
  id, createdAt: dia("2026-10-07"), subscriptionStatus: "active", monthlyPrice: 0, ...extra,
});
const duenos = (...ids: string[]) => ids.map((clinicId) => ({ supabaseId: "dueno", clinicId }));

// ── A1 ───────────────────────────────────────────────────────────────────────────────────────────────────
test("A1: la sede toma el estado de la madre — past_due, cancelled, paused…; al reactivar vuelve a active", () => {
  const base = { plan: "CLINIC", trialEndsAt: dia("2026-11-07") };
  assert.deepEqual(datosDeSedeDesdeMadre({ ...base, subscriptionStatus: "past_due" }), { plan: "CLINIC", subscriptionStatus: "past_due", trialEndsAt: dia("2026-11-07") });
  assert.equal(datosDeSedeDesdeMadre({ ...base, subscriptionStatus: "cancelled" })?.subscriptionStatus, "cancelled");
  assert.equal(datosDeSedeDesdeMadre({ ...base, subscriptionStatus: "paused" })?.subscriptionStatus, "paused");
  assert.equal(datosDeSedeDesdeMadre({ ...base, subscriptionStatus: "active" })?.subscriptionStatus, "active");
  // trialing / paid se escriben como «active»: es la huella con la que nace la sede.
  assert.equal(datosDeSedeDesdeMadre({ ...base, subscriptionStatus: "trialing" })?.subscriptionStatus, "active");
  assert.equal(datosDeSedeDesdeMadre({ ...base, subscriptionStatus: "paid" })?.subscriptionStatus, "active");
  // sin estado en la madre no se inventa nada
  assert.equal(datosDeSedeDesdeMadre({ ...base, subscriptionStatus: null }), null);
  // nextBillingDate jamás viaja a la sede (la distingue de un pagador manual)
  assert.equal("nextBillingDate" in (datosDeSedeDesdeMadre({ ...base, subscriptionStatus: "past_due" }) ?? {}), false);
});

test("A1: con el código viejo la sede seguía activa; con la copia, el gate la bloquea igual que a la madre", () => {
  // Sede recién creada: active y con trialEndsAt = fecha de creación (ya pasada).
  const sedeNueva = { subscriptionStatus: "active", trialEndsAt: dia("2026-10-07") };
  assert.equal(isPlanExpired(sedeNueva, AHORA), false, "sin propagación: active para siempre");

  // La madre cancela: su periodo pagado terminó el 7-nov.
  const cancelada = datosDeSedeDesdeMadre({ plan: "CLINIC", subscriptionStatus: "cancelled", trialEndsAt: dia("2026-10-01") })!;
  assert.equal(isPlanExpired(cancelada, AHORA), true, "cancelada y periodo vencido → sin acceso");

  // past_due con periodo por delante: mismo margen que la madre (no se corta antes).
  const moroso = datosDeSedeDesdeMadre({ plan: "CLINIC", subscriptionStatus: "past_due", trialEndsAt: dia("2026-11-07") })!;
  assert.equal(isPlanExpired(moroso, AHORA), false);
  assert.equal(isPlanExpired(moroso, dia("2026-11-08")), true, "y se corta cuando se acaba el periodo de la madre");

  // Reactiva: vuelve a active y entra.
  const reactivada = datosDeSedeDesdeMadre({ plan: "CLINIC", subscriptionStatus: "active", trialEndsAt: dia("2027-10-20") })!;
  assert.equal(isPlanExpired(reactivada, AHORA), false);
});

test("A1: la sede sigue reconociéndose como incluida con la madre en past_due/cancelled (y una suelta, no)", () => {
  for (const estado of ["past_due", "cancelled", "paused"]) {
    const m = { ...madre, subscriptionStatus: estado };
    const s = sede("s1", { subscriptionStatus: estado });
    assert.deepEqual([...findBranchMothers([m, s], duenos("madre", "s1")).entries()], [["s1", "madre"]], estado);
  }
  // una clínica suelta del mismo dueño, vencida por su cuenta mientras la madre está al corriente: no es sede
  assert.equal(findBranchMothers([madre, sede("suelta", { subscriptionStatus: "past_due" })], duenos("madre", "suelta")).size, 0);
});

test("A1: el estado de la madre se propaga en TODOS los sitios que lo escriben", () => {
  const cuenta = (r: string) => (fuente(r).match(/sincronizarSedesIncluidas\(/g) ?? []).length;
  // La «reactivación por invoice.paid» (ws1-t1) se movió del webhook a `regla-cobro-tarjeta.server.ts` (la comparten el webhook, «Reintentar»
  // y el cron): son 6 sitios en el webhook y 1 allí = los mismos 7 de siempre.
  assert.equal(cuenta("src/app/api/webhooks/stripe/route.ts"), 6, "subscription.updated, deleted, payment_failed, invoice.paid, plan diferencial y activación");
  assert.equal(cuenta("src/lib/billing/regla-cobro-tarjeta.server.ts"), 1, "reactivación por invoice.paid (webhook, «Reintentar» y cron)");
  assert.ok(cuenta("src/app/api/admin/billing/route.ts") >= 3, "verify_payment, activate_clinic, suspend_clinic");
  assert.ok(cuenta("src/app/api/admin/billing/stripe/route.ts") >= 3, "cancelar, pausar, reanudar");
  assert.ok(cuenta("src/app/api/admin/subscriptions/route.ts") >= 1);
  assert.ok(cuenta("src/app/api/cron/subscription-lapse/route.ts") >= 1);
  assert.ok(cuenta("src/lib/billing/spei-directo.ts") >= 1);
  assert.ok(cuenta("src/app/api/billing/change-plan/route.ts") >= 2);
});

// ── A2 ───────────────────────────────────────────────────────────────────────────────────────────────────
test("A2: con 6 sedes no se baja a Profesional/Básico (1 sede); con 1 sola, como hoy; Clínica sigue libre", () => {
  const r = bloqueoDowngradePorSedes({ sedes: 6, maxClinicsDestino: 1 });
  assert.equal(r.bloqueado, true);
  if (r.bloqueado) {
    assert.equal(r.sobran, 5);
    assert.match(r.mensaje, /Tienes 6 sedes y ese plan admite 1/);
    assert.match(r.mensaje, /5 sedes/);
  }
  assert.equal(bloqueoDowngradePorSedes({ sedes: 2, maxClinicsDestino: 1 }).bloqueado, true);
  assert.equal(bloqueoDowngradePorSedes({ sedes: 1, maxClinicsDestino: 1 }).bloqueado, false);
  assert.equal(bloqueoDowngradePorSedes({ sedes: 6, maxClinicsDestino: null }).bloqueado, false);
});

test("A2: change-plan, checkout, SPEI y el webhook consultan el tope de sedes", () => {
  for (const r of ["src/app/api/billing/change-plan/route.ts", "src/app/api/billing/checkout/route.ts", "src/app/api/billing/spei-transferencia/route.ts", "src/app/api/webhooks/stripe/route.ts"]) {
    assert.match(fuente(r), /bloqueoDeSedesParaPlan\(/, r);
  }
  assert.match(fuente("src/app/api/billing/change-plan/route.ts"), /SEDES_ACTIVAS/);
});

// ── M1 / M2 ──────────────────────────────────────────────────────────────────────────────────────────────
test("M1/M2: el grupo de pago dice quién paga; una sede incluida no es pagadora", () => {
  const clinicas = [madre, sede("s1"), sede("s2")];
  const g = grupoDePago("s1", clinicas, duenos("madre", "s1", "s2"));
  assert.equal(g.esSedeIncluida, true);
  assert.equal(g.pagadoraId, "madre");
  assert.deepEqual([...g.miembros].sort(), ["madre", "s1", "s2"]);
  const gm = grupoDePago("madre", clinicas, duenos("madre", "s1", "s2"));
  assert.equal(gm.esSedeIncluida, false);
  assert.deepEqual([...gm.miembros].sort(), ["madre", "s1", "s2"]);
  // clínica sin sedes: ella sola
  const sola = grupoDePago("x", [{ ...madre, id: "x" }], duenos("x"));
  assert.deepEqual(sola, { pagadoraId: "x", miembros: ["x"], esSedeIncluida: false });
  assert.match(avisoSedeIncluida("Centro Dental Salamanca"), /«Centro Dental Salamanca», que es la clínica que paga/);
});

test("M1/M2: checkout, SPEI, cancelar y cambiar plan responden SEDE_INCLUIDA ANTES de crear nada; la página de pago redirige", () => {
  const checkout = fuente("src/app/api/billing/checkout/route.ts");
  assert.ok(checkout.indexOf("SEDE_INCLUIDA") > 0 && checkout.indexOf("SEDE_INCLUIDA") < checkout.indexOf("stripe.customers.create"), "antes de crear el customer");
  assert.ok(checkout.indexOf("SEDE_INCLUIDA") < checkout.indexOf("checkout.sessions.create"), "antes de la sesión de pago");
  for (const r of ["src/app/api/billing/spei-transferencia/route.ts", "src/app/api/clinic/subscription/cancel-request/route.ts", "src/app/api/billing/change-plan/route.ts"]) {
    assert.match(fuente(r), /SEDE_INCLUIDA/, r);
  }
  const cancelar = fuente("src/app/api/clinic/subscription/cancel-request/route.ts");
  assert.ok(cancelar.indexOf("SEDE_INCLUIDA") < cancelar.indexOf("prisma.clinic.update"), "no marca cancelRequested en la sede");
  const pagina = fuente("src/app/dashboard/suspended/page.tsx");
  assert.match(pagina, /grupo\.esSedeIncluida/);
  assert.match(pagina, /redirect\("\/dashboard"\)/);
  assert.match(pagina, /SedeIncluidaSuspendida/);
  assert.match(fuente("src/app/dashboard/settings/settings-client.tsx"), /sedeIncluida \? <SedeIncluidaAviso/);
});

// ── M5 ───────────────────────────────────────────────────────────────────────────────────────────────────
test("M5: 100 + 60 + 0 timbres en tres sedes = 160 contra 150 del plan → 10 de excedente (antes: 0, cada sede con sus 150)", () => {
  const incluidos = 150, centavos = 1000;
  const viejo = [100, 60, 0].map((n) => cfdiOverage(n, incluidos, centavos).overage);
  assert.deepEqual(viejo, [0, 0, 0], "así estaba: 450 timbres gratis");
  const q = cupoCfdiDelGrupo({ timbrados: [100, 60, 0], incluidosMes: incluidos, centavosPorExcedente: centavos });
  assert.equal(q.used, 160);
  assert.equal(q.overage, 10);
  assert.equal(q.overageTotalCents, 10_000);
  // dentro del cupo compartido no hay excedente
  assert.equal(cupoCfdiDelGrupo({ timbrados: [50, 50, 50], incluidosMes: 150, centavosPorExcedente: 1000 }).overage, 0);
  // valores raros no inventan cobros
  assert.equal(cupoCfdiDelGrupo({ timbrados: [-5, NaN as unknown as number, 10], incluidosMes: 150, centavosPorExcedente: 1000 }).used, 10);
});

test("M5: el cron agrupa por (pagadora, periodo) y el excedente se cobra a la principal", () => {
  const filas = [
    { id: "u1", clinicId: "madre", period: "2026-09", stamped: 100 },
    { id: "u2", clinicId: "s1", period: "2026-09", stamped: 60 },
    { id: "u3", clinicId: "s1", period: "2026-08", stamped: 5 },
    { id: "u4", clinicId: "suelta", period: "2026-09", stamped: 7 },
  ];
  const madres = new Map([["s1", "madre"]]);
  const g = agruparCfdiPorPagadora(filas, madres);
  assert.equal(g.length, 3);
  const sept = g.find((x) => x.pagadoraId === "madre" && x.period === "2026-09")!;
  assert.equal(sept.totalTimbrados, 160);
  assert.deepEqual(sept.filas.map((f) => f.id), ["u1", "u2"]);
  assert.equal(g.find((x) => x.pagadoraId === "madre" && x.period === "2026-08")!.totalTimbrados, 5, "otro mes, otro grupo");
  assert.equal(g.find((x) => x.pagadoraId === "suelta")!.totalTimbrados, 7, "una clínica suelta se cobra a sí misma");
});

test("M5: timbrar y consultar el cupo suman las sedes; el cron usa el grupo", () => {
  assert.match(fuente("src/app/api/cfdi/route.ts"), /cfdiTimbradosDelGrupo\(/);
  assert.match(fuente("src/app/api/payments/[id]/cfdi/route.ts"), /cfdiTimbradosDelGrupo\(/);
  assert.match(fuente("src/app/api/cfdi/usage/route.ts"), /cfdiTimbradosDelGrupo\(/);
  const cron = fuente("src/app/api/cron/cfdi-overage/route.ts");
  assert.match(cron, /agruparCfdiPorPagadora\(/);
  assert.match(cron, /madresDeSedes\(/);
});

// ── Quién es la «principal que paga» (revisión antes del push) ──────────────────────────────────────────
test("principal: con la madre en estado null y una sede active, paga la MÁS ANTIGUA, nunca la sede", () => {
  const qa = sede("qa", { createdAt: dia("2026-09-06"), subscriptionStatus: null });
  const copia = sede("copia", { createdAt: dia("2026-10-07") });
  const g = grupoDePago("copia", [qa, copia], duenos("qa", "copia"));
  assert.equal(g.pagadoraId, "qa");
  assert.equal(g.esSedeIncluida, true);
  assert.equal(grupoDePago("qa", [qa, copia], duenos("qa", "copia")).esSedeIncluida, false);
});

test("principal: el pagador manual (SPEI, sin Stripe, con fecha de cobro o precio) cuenta como quien paga aunque sea más nuevo", () => {
  const vieja = sede("vieja", { createdAt: dia("2026-01-01"), subscriptionStatus: "active" });
  const spei = sede("spei", { createdAt: dia("2026-05-01"), nextBillingDate: dia("2026-11-01") });
  const sedeNueva = sede("nueva", { createdAt: dia("2026-10-07") });
  const g = grupoDePago("nueva", [vieja, spei, sedeNueva], duenos("vieja", "spei", "nueva"));
  assert.equal(g.pagadoraId, "spei", "con registro de pago manda sobre la más antigua sin pagos");
  const porPrecio = grupoDePago("nueva", [vieja, { ...spei, nextBillingDate: null, monthlyPrice: 1489 }, sedeNueva], duenos("vieja", "spei", "nueva"));
  assert.equal(porPrecio.pagadoraId, "spei");
});

test("principal: dos con pagos registrados → la más antigua de ellas; una principal cancelada con Stripe sigue siendo la que paga", () => {
  const a = { ...madre, id: "a", createdAt: dia("2026-02-01"), subscriptionStatus: "cancelled" };
  const b = { ...madre, id: "b", createdAt: dia("2026-03-01") };
  const s1 = sede("s1", { subscriptionStatus: "cancelled" });
  assert.equal(grupoDePago("s1", [a, b, s1], duenos("a", "b", "s1")).pagadoraId, "a");
});
