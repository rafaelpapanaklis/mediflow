/**
 * Plan de tratamiento, fase 2 — al unir las ramas (REPORTE-ws1-t1 §6): una cita con procedimientos
 * del plan AGENDADOS se cobra abonando a la nota del plan, nunca con una nota propia. Lo dicen las
 * filas ligadas a la cita (`filasAgendadasEnCita`), no el «Plan: » del motivo, que se puede borrar.
 *
 * Run: npm run test:cobro-cita-del-plan
 *
 * Las rutas son las REALES (POST /api/invoices y GET /api/treatments/cuentas); Prisma, la sesión y
 * las lecturas del plan van dobladas. La consulta de verdad de `filasAgendadasEnCita` (SQL de C
 * pegado en PGlite) la prueba `test:plan-citas`.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cuerpoNotaCobroHoy } from "@/lib/invoices/cobrar-hoy";
import { modoInicialCobroHoy, type PlanConCuenta } from "@/lib/treatments/sin-doble-cobro";

// ── Dobles ──────────────────────────────────────────────────────────────────
const db = {
  citas: [] as Array<{ id: string; clinicId: string; patientId: string; doctorId: string | null }>,
  creadas: [] as any[],
  /** Filas del plan agendadas por cita (lo que leería `filasAgendadasEnCita`). */
  filasDeCita: new Map<string, Array<{ id: string; planId: string; clinicId: string }>>(),
  consultasDeFilas: [] as Array<[string, string]>,
};
beforeEach(() => {
  db.citas = [
    { id: "cita-plan", clinicId: "c1", patientId: "p1", doctorId: null },
    { id: "cita-suelta", clinicId: "c1", patientId: "p1", doctorId: null },
  ];
  db.creadas = [];
  db.consultasDeFilas = [];
  db.filasDeCita = new Map([["cita-plan", [{ id: "f1", planId: "plan-a", clinicId: "c1" }, { id: "f2", planId: "plan-a", clinicId: "c1" }]]]);
});

const prismaStub: any = {
  appointment: {
    findFirst: async ({ where }: any) => {
      assert.ok(where?.clinicId, "la cita se busca SIEMPRE con clinicId");
      const c = db.citas.find((x) => x.id === where.id && x.clinicId === where.clinicId);
      return c ? { id: c.id, patientId: c.patientId, doctorId: c.doctorId } : null;
    },
    findMany: async () => [],
  },
  treatmentPlan: { findMany: async () => [] },
  orthodonticTreatmentPlan: { findMany: async () => [] },
  user: { findFirst: async () => null },
  patient: {
    findFirst: async ({ where }: any) => {
      assert.ok(where?.clinicId, "el paciente se busca SIEMPRE con clinicId");
      return where.id === "p1" && where.clinicId === "c1" ? { id: "p1", primaryDoctorId: null } : null;
    },
  },
  invoice: {
    findUnique: async () => null,
    create: async ({ data }: any) => {
      const row = { id: `inv${db.creadas.length + 1}`, createdAt: new Date(), patient: { id: data.patientId }, ...data };
      db.creadas.push(row);
      return row;
    },
  },
  clinic: { findUnique: async () => ({ cfdiTaxMode: "exempt" }) },
};

const authCtx: any = { clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null, clinic: { timezone: "America/Mexico_City" } };
(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, relatedPatientVisibilityAnd: () => [] },
});
(mock as any).module("@/lib/invoices/cita-factura-cancelada.server", {
  namedExports: { soltarFacturaCanceladaDeCita: async () => {} },
});
(mock as any).module("@/lib/patient-credit-aplicar", {
  namedExports: { aplicarSaldoAFavor: async () => ({ aplicado: 0, restanteAFavor: 0, factura: null }) },
});
(mock as any).module("@/lib/invoices/next-invoice-number", {
  namedExports: {
    nextInvoiceNumber: async () => "MF-0001",
    withInvoiceNumberRetry: async (fn: () => Promise<unknown>) => fn(),
    InvoiceNumberExhaustedError: class extends Error {},
  },
});
(mock as any).module("@/lib/treatments/citas-del-plan-db", {
  namedExports: {
    filasAgendadasEnCita: async (clinicId: string, appointmentId: string) => {
      db.consultasDeFilas.push([clinicId, appointmentId]);
      // Como la consulta real: SOLO las de esta clínica.
      return (db.filasDeCita.get(appointmentId) ?? []).filter((f) => f.clinicId === clinicId)
        .map((f) => ({ id: f.id, planId: f.planId, nombre: "Resina", dientes: [16], estado: "pendiente", cantidad: 1, minutos: 45, invoiceId: null }));
    },
  },
});
// Lecturas del plan para GET /api/treatments/cuentas.
const PLANES = [
  { id: "plan-b", name: "Plan viejo que debe", status: "ACTIVE" },
  { id: "plan-a", name: "Plan de la cita", status: "ACTIVE" },
];
(mock as any).module("@/lib/treatments/sin-doble-cobro.server", { namedExports: { planesDelPaciente: async () => PLANES } });
(mock as any).module("@/lib/treatments/items-db", {
  namedExports: { repoFilas: { leerDePlanes: async () => new Map(PLANES.map((p) => [p.id, [{ id: `fila-${p.id}`, planId: p.id, nombre: "Resina", procedureId: null, dientes: [16], cantidad: 1, estado: "pendiente", hechoEn: null, invoiceId: null }]])) } },
});
(mock as any).module("@/lib/treatments/cobro.server", {
  namedExports: {
    leerCuentaDelPlan: async ({ planId }: { planId: string }) => ({
      total: 1000, facturado: 1000, pagado: 0, soloDelPlan: 1000, saldo: planId === "plan-b" ? 900 : 400, porFacturar: 0,
      notas: [{ id: `nota-${planId}`, invoiceNumber: `F-${planId}`, status: "PENDING", total: 1000, paid: 0, createdAt: "" }],
    }),
  },
});

function req(body: any): any {
  return { json: async () => body, headers: new Headers(), url: "http://localhost/api/invoices" };
}
const cuerpo = (extra: Record<string, unknown> = {}) => ({
  patientId: "p1",
  items: [{ description: "Limpieza dental", quantity: 1, unitPrice: 700, total: 700 }],
  ...extra,
});

// ── POST /api/invoices ──────────────────────────────────────────────────────

test("POST /api/invoices desde una cita con filas del plan: 409 cita_del_plan y NO se crea ninguna nota", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  const res = await POST(req(cuerpo({ appointmentId: "cita-plan" })));
  assert.equal(res.status, 409);
  const out = await res.json();
  assert.equal(out.code, "cita_del_plan");
  assert.deepEqual(out.planIds, ["plan-a"]);
  assert.match(out.error, /abona a la nota del plan/);
  assert.equal(db.creadas.length, 0);
  assert.deepEqual(db.consultasDeFilas, [["c1", "cita-plan"]], "se pregunta con la clínica de la SESIÓN");
});

test("…aunque el motivo ya no diga «Plan: » (lo que manda son las filas, no el texto)", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  const res = await POST(req(cuerpo({ appointmentId: "cita-plan", items: [{ description: "Limpieza", quantity: 1, unitPrice: 800, total: 800 }] })));
  assert.equal(res.status, 409);
});

test("con «es otro procedimiento» confirmado (fueraDelPlan), la nota se crea como siempre", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  const res = await POST(req(cuerpo({ appointmentId: "cita-plan", fueraDelPlan: true })));
  assert.equal(res.status, 201);
  assert.equal(db.creadas.length, 1);
  assert.equal(db.creadas[0].appointmentId, "cita-plan");
});

test("una cita sin filas del plan, o sin cita, cobra exactamente como antes", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  assert.equal((await POST(req(cuerpo({ appointmentId: "cita-suelta" })))).status, 201);
  assert.equal((await POST(req(cuerpo()))).status, 201);
  assert.equal(db.creadas.length, 2);
  assert.deepEqual(db.consultasDeFilas, [["c1", "cita-suelta"]], "sin cita no se pregunta nada");
});

test("las filas de OTRA clínica en esa cita no frenan nada aquí (la consulta va por clínica)", async () => {
  db.filasDeCita.set("cita-suelta", [{ id: "fx", planId: "plan-x", clinicId: "c2" }]);
  const { POST } = await import("@/app/api/invoices/route");
  assert.equal((await POST(req(cuerpo({ appointmentId: "cita-suelta" })))).status, 201);
});

// ── GET /api/treatments/cuentas con la cita ─────────────────────────────────

test("GET cuentas?appointmentId=: dice qué planes del paciente tienen filas en esa cita; sin cita, []", async () => {
  const { GET } = await import("@/app/api/treatments/cuentas/route");
  const con = await GET({ url: "http://localhost/api/treatments/cuentas?patientId=p1&appointmentId=cita-plan", headers: new Headers() } as any);
  assert.equal(con.status, 200);
  const a = await con.json();
  assert.deepEqual(a.planesDeLaCita, ["plan-a"]);
  assert.equal(a.planes.length, 2);
  const sin = await (await GET({ url: "http://localhost/api/treatments/cuentas?patientId=p1", headers: new Headers() } as any)).json();
  assert.deepEqual(sin.planesDeLaCita, []);
  const malo = await GET({ url: "http://localhost/api/treatments/cuentas?patientId=p1&appointmentId=' OR 1=1", headers: new Headers() } as any);
  assert.equal(malo.status, 400);
});

test("…y un plan que no es de ESTE paciente no se cuela aunque tenga filas en la cita", async () => {
  db.filasDeCita.set("cita-plan", [{ id: "f9", planId: "plan-de-otro-paciente", clinicId: "c1" }]);
  const { GET } = await import("@/app/api/treatments/cuentas/route");
  const r = await (await GET({ url: "http://localhost/api/treatments/cuentas?patientId=p1&appointmentId=cita-plan", headers: new Headers() } as any)).json();
  assert.deepEqual(r.planesDeLaCita, []);
});

// ── Lo puro de «Cobrar hoy» ─────────────────────────────────────────────────

const plan = (planId: string, saldo: number, extra: Partial<PlanConCuenta> = {}): PlanConCuenta => ({
  planId, nombre: planId, estado: "ACTIVE", conFilas: true, total: 1000, facturado: 1000, pagado: 0, soloDelPlan: 1000,
  saldo, porFacturar: 0, notas: [], filas: [], ...extra,
} as PlanConCuenta);

test("Cobrar hoy abre en el plan DE LA CITA, no en el primero que deba", () => {
  const planes = [plan("plan-b", 900), plan("plan-a", 400)];
  assert.deepEqual(modoInicialCobroHoy(planes), { modo: "abono", planId: "plan-b" }, "sin cita: el primero que debe, como antes");
  assert.deepEqual(modoInicialCobroHoy(planes, ["plan-a"]), { modo: "abono", planId: "plan-a" });
  // El plan de la cita sin nota todavía: crearla y abonar.
  const sinNota = [plan("plan-b", 900), plan("plan-a", 0, { porFacturar: 600 })];
  assert.deepEqual(modoInicialCobroHoy(sinNota, ["plan-a"]), { modo: "nota_del_plan", planId: "plan-a" });
  // Un plan de la cita que ya no debe nada: lo de siempre.
  assert.deepEqual(modoInicialCobroHoy([plan("plan-b", 900), plan("plan-a", 0)], ["plan-a"]), { modo: "abono", planId: "plan-b" });
});

test("el cuerpo de la nota nueva lleva fueraDelPlan solo si se confirmó", () => {
  const base = { patientId: "p1", appointmentId: "cita-plan", conceptos: [{ nombre: "Blanqueamiento", importe: 3000, procedureId: null }] };
  assert.equal("fueraDelPlan" in cuerpoNotaCobroHoy(base), false);
  assert.equal("fueraDelPlan" in cuerpoNotaCobroHoy({ ...base, fueraDelPlan: false }), false);
  assert.equal(cuerpoNotaCobroHoy({ ...base, fueraDelPlan: true }).fueraDelPlan, true);
});
