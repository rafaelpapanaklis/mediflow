/**
 * ws1-t2 — F15 y F3 de la auditoría BEVADENT.
 *
 * Run: npm run test:plan-y-estado-de-cuenta
 *
 * F15 · «Nuevo plan»: escribir «Limpieza» no daba sugerencias visibles y el precio quedaba en
 *       0.00 (solo el nombre exacto traía $700); el plan se creaba en $0 sin aviso.
 * F3  · «Estado de cuenta»: «Total tratamiento $700 · 100% cubierto» sumaba FACTURAS con un plan
 *       de $900; y el plan decía que la aceptación se firma en Presupuestos mientras Presupuestos
 *       decía «Los cobros nuevos ahora se hacen desde Facturación».
 * Con el código viejo fallan: no existían el buscador, la guarda de $0 ni los textos nuevos.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buscarEnTarifario, exactoEnTarifario, normalizar } from "@/components/dashboard/plan-tratamiento-rediseno/buscar-tarifario";
import { faltaConfirmarSinCosto, planSinCosto, CODIGO_PLAN_SIN_COSTO } from "@/lib/treatments/plan-sin-costo";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const TARIFARIO = [
  { id: "a", name: "Limpieza dental", basePrice: 700, duration: 45 },
  { id: "b", name: "Extracción dental simple", basePrice: 1000, duration: 30 },
  { id: "c", name: "Extracción simple", basePrice: 1200, duration: 30 },
  { id: "d", name: "Extracción quirúrgica tercer molar", basePrice: 3500, duration: 60 },
  { id: "e", name: "Profilaxis y limpieza con ultrasonido", basePrice: 900, duration: 50 },
];

// ── F15 · buscador ───────────────────────────────────────────────────────────
test("«Limpieza» encuentra «Limpieza dental» (lo que la auditoría no encontraba) y la pone primero", () => {
  const r = buscarEnTarifario(TARIFARIO, "Limpieza");
  assert.deepEqual(r.map((p) => p.id), ["a", "e"]);
  assert.equal(r[0].basePrice, 700);
});

test("sin acentos ni mayúsculas, por parte del nombre y con las palabras en cualquier orden", () => {
  assert.deepEqual(buscarEnTarifario(TARIFARIO, "extraccion").map((p) => p.id), ["c", "b", "d"]);
  assert.deepEqual(buscarEnTarifario(TARIFARIO, "simple dental").map((p) => p.id), ["b"]);
  assert.deepEqual(buscarEnTarifario(TARIFARIO, "MOLAR").map((p) => p.id), ["d"]);
  assert.deepEqual(buscarEnTarifario(TARIFARIO, "ortodoncia"), []);
  assert.deepEqual(buscarEnTarifario(TARIFARIO, "   "), [], "sin texto no se tira la lista entera");
  assert.equal(buscarEnTarifario(TARIFARIO, "e", 2).length, 2, "respeta el tope");
});

test("el nombre exacto se toma solo aunque cambien acentos o espacios", () => {
  assert.equal(exactoEnTarifario(TARIFARIO, "  extraccion   SIMPLE ")?.id, "c");
  assert.equal(exactoEnTarifario(TARIFARIO, "Limpieza"), null);
  assert.equal(normalizar("Extracción  Quirúrgica"), "extraccion quirurgica");
});

test("la ventana ya no usa <datalist> y busca con buscarEnTarifario", () => {
  const v = leer("src/components/dashboard/plan-tratamiento-rediseno/ventana-nuevo-plan.tsx");
  assert.doesNotMatch(v, /<datalist/);
  assert.doesNotMatch(v, /list="plan-tarifario"/);
  assert.match(v, /buscarEnTarifario\(tarifario, r\.procedimiento\)/);
  assert.match(v, /role="listbox"/);
  assert.match(v, /planTratamiento\.nuevo\.sinTarifario/);
});

// ── F15 · plan en $0 ─────────────────────────────────────────────────────────
test("planSinCosto: vacío, 0, negativo o basura es $0; un precio no", () => {
  for (const v of [undefined, null, "", "0", 0, -5, "abc", NaN]) assert.equal(planSinCosto(v), true, String(v));
  for (const v of [700, "700", 0.5]) assert.equal(planSinCosto(v), false, String(v));
  assert.equal(faltaConfirmarSinCosto({ totalCost: 0 }), true);
  assert.equal(faltaConfirmarSinCosto({ totalCost: 0, confirmarSinCosto: true }), false);
  assert.equal(faltaConfirmarSinCosto({ totalCost: 0, confirmarSinCosto: "true" }), true, "solo true de verdad");
  assert.equal(faltaConfirmarSinCosto({ totalCost: 900 }), false);
});

const creados: any[] = [];
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: "c1", userId: "u1", role: "ADMIN", isDoctor: false, permissionsOverride: null }) },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, relatedPatientVisibilityAnd: () => [] },
});
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      patient: { findFirst: async ({ where }: any) => (where.clinicId === "c1" && where.id === "p1" ? { id: "p1" } : null) },
      user: { findFirst: async () => ({ id: "d1" }) },
      treatmentPlan: {
        create: async ({ data }: any) => {
          const row = { id: `t${creados.length + 1}`, createdAt: new Date(), updatedAt: new Date(), patient: null, doctor: null, sessions: [], ...data };
          creados.push(row);
          return row;
        },
      },
    },
  },
});
const pedir = (body: any): any => ({ json: async () => body, headers: new Headers(), url: "http://localhost/api/treatments" });
const BASE = { patientId: "p1", doctorId: "d1", name: "Limpieza dental (prueba)", totalSessions: 1, sessionIntervalDays: 30 };

test("POST /api/treatments: en $0 contesta 409 PLAN_SIN_COSTO y no crea nada", async () => {
  const { POST } = await import("@/app/api/treatments/route");
  creados.length = 0;
  const res = await POST(pedir({ ...BASE, totalCost: 0 }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, CODIGO_PLAN_SIN_COSTO);
  assert.match(body.error, /\$0/);
  assert.equal(creados.length, 0);
});

test("POST /api/treatments: confirmado o con costo, se crea", async () => {
  const { POST } = await import("@/app/api/treatments/route");
  creados.length = 0;
  assert.equal((await POST(pedir({ ...BASE, totalCost: 0, confirmarSinCosto: true }))).status, 201);
  assert.equal((await POST(pedir({ ...BASE, totalCost: 900 }))).status, 201);
  assert.deepEqual(creados.map((c) => c.totalCost), [0, 900]);
});

test("las dos pantallas que crean planes preguntan antes y mandan confirmarSinCosto", () => {
  for (const f of ["src/app/dashboard/patients/[id]/patient-detail-client.tsx", "src/app/dashboard/treatments/treatments-client.tsx"]) {
    const s = leer(f);
    assert.match(s, /planSinCosto\(/, f);
    assert.match(s, /planTratamiento\.nuevo\.sinCostoTitulo/, f);
    assert.match(s, /confirmarSinCosto: true/, f);
  }
});

// ── F3 · Estado de cuenta y textos ───────────────────────────────────────────
test("«Total tratamiento» pasa a ser «Total facturado» y el plan activo sale aparte", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  assert.equal(es.patients.sideCards.treatmentTotal, "Total facturado");
  assert.equal(en.patients.sideCards.treatmentTotal, "Total invoiced");
  assert.equal(typeof es.patients.sideCards.activePlans, "string");
  assert.equal(typeof en.patients.sideCards.activePlans, "string");
  assert.doesNotMatch(es.patients.sideCards.pctCovered, /^\{pct\}% cubierto$/, "«100% cubierto» a secas hacía pasar lo facturado por el plan");
  assert.match(es.pacientesRediseno.resumen.pagadoDeTotal, /facturado/);

  const tarjeta = leer("src/components/dashboard/patient-detail/side-cards.tsx");
  assert.match(tarjeta, /patients\.sideCards\.activePlans/);
  assert.match(tarjeta, /finance\.plan/);
  const resumen = leer("src/components/dashboard/pacientes-rediseno/resumen.tsx");
  assert.match(resumen, /finanzas\.plan/);
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /p\?\.status === "ACTIVE"/);
  assert.equal(ficha.match(/plan: totalPlanesActivos/g)?.length, 2, "la tarjeta del rail y la del resumen nuevo");
});

test("el plan y Presupuestos dicen lo mismo: se firma en un presupuesto, se cobra en Facturación", () => {
  for (const idioma of ["es", "en"] as const) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/${idioma}.json`));
    const firma: string = d.planTratamiento.nuevo.firmaPista;
    const aviso: string = d.presupuestosEnFacturacion.avisoTitulo + d.presupuestosEnFacturacion.avisoTexto;
    const presupuesto = idioma === "es" ? /Convertir en presupuesto/ : /Convert to quote/;
    const facturacion = idioma === "es" ? /Facturación/ : /Billing/;
    assert.match(firma, presupuesto, `${idioma}: el plan dice cómo llegar al presupuesto`);
    assert.match(firma, facturacion, `${idioma}: y dónde se cobra`);
    assert.match(aviso, presupuesto, `${idioma}: Presupuestos dice de dónde llegan los planes`);
    assert.match(aviso, facturacion, `${idioma}: y que el cobro es en Facturación`);
  }
});
