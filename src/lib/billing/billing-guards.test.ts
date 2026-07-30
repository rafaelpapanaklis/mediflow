/**
 * Tests de AUTORIZACIÓN y de los invariantes estructurales de las rutas de
 * suscripción.
 *
 * Run: npm run test:billing
 *
 * Por qué son estructurales y no llamadas HTTP: los handlers hacen
 * `await getCurrentUser()` (lee cookies del request de Next y redirige a /login
 * si no hay sesión) y consultan Postgres antes de responder. Offline y sin BD no
 * se pueden invocar, y no hay entorno Stripe TEST donde ejercitarlos. Lo que sí
 * se puede blindar —y es donde estuvo el bug— es que el check de rol EXISTA y
 * corra ANTES de cualquier efecto: el preview validaba admin y el endpoint que
 * COBRA no, así que cualquier usuario logueado disparaba un cargo con un fetch.
 *
 * Estos tests fallan si alguien borra un guard, lo mueve después de un efecto o
 * agrega una ruta de cobro sin protección.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isClinicBillingAdmin, notClinicBillingAdminResponse } from "./authz";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

const CHANGE_PLAN = "src/app/api/billing/change-plan/route.ts";
const PREVIEW = "src/app/api/billing/change-plan/preview/route.ts";
const PORTAL = "src/app/api/billing/portal/route.ts";

// ── Quién puede tocar la suscripción ────────────────────────────────────────

test("solo dueño/admin de la clínica puede cambiar el plan", () => {
  assert.equal(isClinicBillingAdmin("SUPER_ADMIN"), true);
  assert.equal(isClinicBillingAdmin("ADMIN"), true);
});

test("ningún otro rol pasa, ni siquiera quien cobra en caja", () => {
  // RECEPTIONIST tiene billing.charge (facturación de PACIENTES): no es lo mismo
  // que contratar el plan de la clínica.
  for (const role of ["RECEPTIONIST", "DOCTOR", "ASSISTANT", "VIEWER", "READONLY", "OWNER", "admin", ""]) {
    assert.equal(isClinicBillingAdmin(role), false, `role=${role}`);
  }
  assert.equal(isClinicBillingAdmin(null), false);
  assert.equal(isClinicBillingAdmin(undefined), false);
});

test("el 403 trae un código estable para que el panel lo distinga", () => {
  const body = notClinicBillingAdminResponse();
  assert.equal(body.code, "FORBIDDEN_NOT_CLINIC_ADMIN");
  assert.ok(body.error.length > 0);
});

// ── El guard corre ANTES de cualquier efecto ────────────────────────────────

/** Posición del primer efecto observable de la ruta (BD, Stripe o body). */
function firstSideEffectIndex(source: string): number {
  const marks = ["prisma.", "stripe.", "getStripeSafe(", "req.json("];
  const found = marks.map((m) => source.indexOf(m)).filter((i) => i >= 0);
  assert.ok(found.length > 0, "la ruta no tiene ningún efecto reconocible");
  return Math.min.apply(null, found);
}

for (const [label, rel, guards] of [
  ["change-plan (COBRA)", CHANGE_PLAN, 1],
  ["preview (GET + POST)", PREVIEW, 2],
  ["portal de Stripe (cancela/cambia tarjeta)", PORTAL, 1],
] as Array<[string, string, number]>) {
  test(`${label}: exige admin antes de tocar BD, Stripe o el body`, () => {
    const source = read(rel);
    const guardAt = source.indexOf("isClinicBillingAdmin(user.role)");
    assert.ok(guardAt > 0, `${rel}: falta el check de rol`);
    assert.ok(
      source.indexOf("status: 403") > 0,
      `${rel}: el check existe pero no responde 403`,
    );
    assert.ok(
      guardAt < firstSideEffectIndex(source),
      `${rel}: el check de rol corre DESPUÉS de un efecto secundario`,
    );
  });

  test(`${label}: el guard está en TODOS sus handlers (${guards})`, () => {
    const source = read(rel);
    const hits = source.split("isClinicBillingAdmin(user.role)").length - 1;
    assert.equal(hits, guards, `${rel}: se esperaban ${guards} checks de rol`);
  });
}

test("todas las rutas de suscripción usan la MISMA fuente de autorización", () => {
  // Duplicar el criterio es cómo se desincronizaron antes el preview y el cobro.
  for (const rel of [CHANGE_PLAN, PREVIEW, PORTAL]) {
    assert.match(read(rel), /from "@\/lib\/billing\/authz"/, `${rel}: no importa authz`);
  }
});

// ── Aislamiento multi-tenant ────────────────────────────────────────────────

const TENANT_INPUTS = ["clinicId", "customerId", "subscriptionId", "stripeCustomerId"];

test("el clinicId sale SIEMPRE de la sesión, nunca del body", () => {
  for (const rel of [CHANGE_PLAN, PREVIEW, PORTAL]) {
    const source = read(rel);
    assert.match(source, /user\.clinicId/, `${rel}: no usa el clinicId de sesión`);
  }
});

test("los schemas zod del body no aceptan identificadores de tenant ni de Stripe", () => {
  // Aceptar un clinicId por el body es la vía directa a cobrarle a otra clínica.
  for (const rel of [CHANGE_PLAN, PREVIEW]) {
    const source = read(rel);
    const schemaAt = source.indexOf("const BodySchema");
    assert.ok(schemaAt > 0, `${rel}: no hay validación zod del body`);
    const schema = source.slice(schemaAt, source.indexOf("\n", source.indexOf("});", schemaAt)));
    for (const field of TENANT_INPUTS) {
      assert.equal(schema.includes(field), false, `${rel}: el body acepta ${field}`);
    }
  }
});

// ── El diferencial NO extiende el periodo ───────────────────────────────────

test("applyPlanUpgradeDiff no toca trialEndsAt, nextBillingDate ni subscriptionStatus", () => {
  // La clínica pagó SOLO la diferencia por los días que le quedaban: mejorar el
  // plan no le regala periodo. Extraemos el cuerpo de la función y comprobamos
  // que su único update escriba plan + cupo de IA.
  const source = read("src/app/api/webhooks/stripe/route.ts");
  const start = source.indexOf("async function applyPlanUpgradeDiff(");
  assert.ok(start > 0, "no se encontró applyPlanUpgradeDiff");
  // Hasta la siguiente declaración de función de nivel superior.
  const rest = source.slice(start + 10);
  const end = rest.indexOf("\nasync function ") >= 0 ? start + 10 + rest.indexOf("\nasync function ") : source.length;
  const body = source.slice(start, end);

  const updateAt = body.indexOf("prisma.clinic.update");
  assert.ok(updateAt > 0, "debe escribir el plan");
  const updateBlock = body.slice(updateAt, updateAt + 300);
  assert.equal(updateBlock.includes("trialEndsAt"), false, "extiende el periodo");
  assert.equal(updateBlock.includes("nextBillingDate"), false, "mueve la fecha de renovación");
  assert.equal(updateBlock.includes("subscriptionStatus"), false, "cambia el estado de la suscripción");
  assert.ok(updateBlock.includes("aiTokensLimit"), "debe alinear el cupo de IA con el plan nuevo");
});

test("un pago acreditado que no aplica el plan SIEMPRE deja rastro", () => {
  // Los tres descartes de applyPlanUpgradeDiff ocurren con el diferencial ya
  // cobrado: sin bitácora, el dinero se pierde en silencio.
  const source = read("src/app/api/webhooks/stripe/route.ts");
  const start = source.indexOf("async function applyPlanUpgradeDiff(");
  const body = source.slice(start, start + 2600);
  assert.match(body, /invalid-plan/);
  assert.match(body, /clinic-not-found/);
  assert.match(body, /not-a-tier-upgrade/);
  assert.match(body, /logAudit/);
});

// ── La fuga del upgrade gratis está cerrada ─────────────────────────────────

test("change-plan rechaza el upgrade manual cuando el periodo ya venció", () => {
  const source = read(CHANGE_PLAN);
  assert.match(source, /MANUAL_PERIOD_EXPIRED/, "falta el 409 del periodo vencido");
  const guardAt = source.indexOf("MANUAL_PERIOD_EXPIRED");
  const freeAt = source.indexOf("self-service-change-plan-manual-free");
  assert.ok(freeAt > 0, "falta la rama del diferencial no cobrable");
  assert.ok(guardAt < freeAt, "el 409 debe evaluarse ANTES de aplicar el plan gratis");
});

test("el pagado-hasta se lee con manualPaidUntil en el preview y en el cobro", () => {
  // Si las dos superficies usan definiciones distintas, el modal cotiza un
  // periodo y se factura otro.
  for (const rel of [CHANGE_PLAN, PREVIEW]) {
    assert.match(read(rel), /paidUntil: manualPaidUntil\(clinic\)/, `${rel}: no usa manualPaidUntil`);
  }
});
