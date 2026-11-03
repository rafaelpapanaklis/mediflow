/**
 * ws1-t11 v2 — las server actions de ORTODONCIA que reciben el id de un caso
 * (treatmentPlanId) u otro id del caso respetan la visibilidad por paciente.
 *
 * Run: npm run test:orto-plan-visible
 *
 * Continúa el lead 14 de la auditoría run-2: además de las cuatro que nombraba
 * el lead (ya cerradas en 5d8012eda), había 22 acciones de ortodoncia que
 * cargaban el caso (o un registro suyo) por { id, clinicId } y escribían sin
 * mirar patients.visibleUserIds. Las que ya pasaban por un helper central
 * (getOrthoImagingContext, loadCasoParaCobro, prepararGuardadoDelPlan,
 * cargarCaso de hojaExtras, casoVisible de versionesDelCaso…) no van aquí.
 *
 * Familias: el caso clínico (arcos, TAD, aparatología, fotos, controles,
 * registros digitales, elásticos, G15), retención y NPS, cobro y presupuesto
 * (mensualidad, plan de pagos, escenarios, firma en casa, código de
 * referido) y diagnóstico. Actions y helpers REALES (_helpers.ts con
 * cargarPlanVisible); Prisma de mentira que evalúa los `where`.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { preparar, respuestas, llamadas, prismaFalso, cumple, Redireccion } from "../../../../lib/auth/__tests__/_arnes-paginas-server";

const A = (f: string) => `src/app/actions/orthodontics/${f}.ts`;
const ACCIONES = [
  "addWireStep", "createOrthoTAD", "updateOrthoAppliances", "createPhotoSet", "createControlAppointment",
  "linkDigitalRecord", "recordElasticsCompliance", "scheduleG15Checkpoint",
  "scheduleRetentionCheckups", "toggleRetentionPreSurvey", "updateRetentionRegimenConfig", "scheduleNpsTimeline",
  "updateNpsConfig", "recordNpsResponse",
  "confirmCollect", "updateFinancialPlan", "recalculatePaymentStatus", "selectQuoteScenario", "updateQuoteScenario",
  "sendSignAtHomeLink", "createReferralCode",
  "updateDiagnosis",
];

const prisma = prismaFalso();
preparar({
  paginas: [
    A("_helpers"), ...ACCIONES.map(A), A("whatsapp/sendMensualidadReminder"), "src/lib/orthodontics/diagnostico-guardar.ts",
    A("createPaymentPlan"), A("createTreatmentPlan"), A("cobro/resolverPromesaDePago"), A("cobro/_ctx"),
  ],
  reales: [
    "zod", "@prisma/client", "./_helpers", "./result", "./audit-actions",
    "@/lib/patient-visibility", "@/lib/auth/guardia-clinica", "@/lib/auth/permissions",
    "@/lib/orthodontics/acceso-doctor", "@/lib/validation/orthodontics", "@/lib/validation/id",
    "@/lib/orthodontics/photo-set-helpers", "@/lib/orthodontics/phase-machine",
    "@/lib/orthodontics/material-de-arco", "@/lib/orthodontics/diagnostico-guardar",
    "@/lib/clinical-shared/auth/paciente-oculto", "@/app/actions/orthodontics/result",
    "@/app/actions/orthodontics/_helpers", "@/lib/auth/require-permission", "../_helpers", "../result", "./_ctx",
    "@/lib/orthodontics/colocacion",
  ],
  fijos: {
    "@/lib/prisma": { prisma },
    "next/navigation": { redirect: (d: string) => { throw new Redireccion(d); }, notFound: () => { throw new Error("404"); } },
  },
});

// ── la base de mentira: un paciente restringido a «u_otro» y su caso ──
const P = "p_priv";
const AHORA = new Date();
const base = { clinicId: "cli_a", patientId: P, deletedAt: null };
const FILAS: Record<string, any[]> = {
  patient: [
    { id: P, clinicId: "cli_a", deletedAt: null, visibleUserIds: ["u_otro"], firstName: "Privada", lastName: "Dos", phone: "5512345678", dob: null },
    { id: "p_pub", clinicId: "cli_a", deletedAt: null, visibleUserIds: [], firstName: "Pública", lastName: "Uno", phone: "5599999999", dob: null },
  ],
  orthodonticTreatmentPlan: [{
    id: "plan1", ...base, status: "IN_PROGRESS", startDate: AHORA, installedAt: AHORA, createdAt: AHORA, technique: "METAL_BRACKETS",
    totalCostMxn: 30000, invoiceId: null, treatingDoctorId: null, responsibleGuardianId: null, diagnosisId: "dx1",
    patient: { visibleUserIds: ["u_otro"] }, photoSets: [], phases: [], paymentPlan: null,
  }, {
    id: "plan_pub", clinicId: "cli_a", patientId: "p_pub", deletedAt: null, status: "IN_PROGRESS", invoiceId: null, technique: "METAL_BRACKETS",
    totalCostMxn: 30000, treatingDoctorId: null, installedAt: AHORA, startDate: AHORA, createdAt: AHORA, patient: { visibleUserIds: [] },
  }],
  orthodonticDiagnosis: [
    { id: "dx1", ...base, treatingDoctorId: null, responsibleGuardianId: null, treatmentPlan: null },
    { id: "dx_pub", clinicId: "cli_a", patientId: "p_pub", deletedAt: null, treatingDoctorId: null, responsibleGuardianId: null, treatmentPlan: null },
  ],
  patientFile: [{ id: "file1", ...base, category: "CEPH_ANALYSIS_PDF" }],
  orthoPaymentPlan: [{ id: "pp1", ...base, treatmentPlanId: "plan1", totalAmount: 30000, initialDownPayment: 0, installmentCount: 10, installmentAmount: 3000, paymentDayOfMonth: 14, status: "ON_TIME", installments: [] }],
  orthoInstallment: [{ id: "ins1", clinicId: "cli_a", status: "PENDING", amount: 3000, amountPaid: 0, dueDate: AHORA, installmentNumber: 1, paymentPlan: { treatmentPlanId: "plan1", clinicId: "cli_a", patientId: P, id: "pp1" }, paymentPlanId: "pp1" }],
  orthoQuoteScenario: [{ id: "sc1", clinicId: "cli_a", treatmentPlanId: "plan1", totalAmount: 30000, initialDownPayment: 0, installmentCount: 10, status: "PROPOSED", isAccepted: false }],
  orthoNpsSchedule: [{ id: "nps1", ...base, treatmentPlanId: "plan1", status: "SENT", googleReviewTriggered: false, npsType: "EARLY" }],
  orthoRetentionRegimen: [{ id: "reg1", clinicId: "cli_a", treatmentPlanId: "plan1", debondedAt: AHORA }],
};

let ctx: any;
function como(role: string, userId = "u1") {
  ctx = { userId, clinicId: "cli_a", role, permissionsOverride: [], clinicCategory: "DENTAL", isAdmin: role === "ADMIN", isSuperAdmin: false, clinic: { id: "cli_a", category: "DENTAL" } };
}

const ESCRITURA = /^prisma\.\w+\.(update|updateMany|create|createMany|delete|deleteMany|upsert|\$transaction)$|#(guardar|aplicar|crear|registrar|enqueue|link|actualizar|vincular|insert)/i;
const escribio = () => llamadas.filter((l) => ESCRITURA.test(l.quien)).map((l) => l.quien);

beforeEach(() => {
  llamadas.length = 0;
  respuestas.clear();
  for (const [modelo, filas] of Object.entries(FILAS)) {
    const una = ({ where }: any) => filas.find((f) => cumple(f, where)) ?? null;
    respuestas.set(`prisma.${modelo}.findUnique`, una);
    respuestas.set(`prisma.${modelo}.findFirst`, una);
    respuestas.set(`prisma.${modelo}.findMany`, ({ where }: any = {}) => filas.filter((f) => cumple(f, where)));
    respuestas.set(`prisma.${modelo}.update`, ({ where, data }: any) => ({ ...(filas.find((f) => f.id === where?.id) ?? filas[0]), ...data, id: where?.id ?? filas[0]?.id }));
    respuestas.set(`prisma.${modelo}.upsert`, ({ create }: any) => ({ id: `${modelo}_nuevo`, ...create }));
    respuestas.set(`prisma.${modelo}.create`, ({ data }: any) => ({ id: `${modelo}_nuevo`, createdAt: AHORA, ...data }));
    respuestas.set(`prisma.${modelo}.updateMany`, () => ({ count: 1 }));
  }
  respuestas.set("prisma.orthoWireStep.findFirst", () => null);
  respuestas.set("prisma.orthoWireStep.create", ({ data }: any) => ({ id: "w1", orderIndex: 0, ...data }));
  respuestas.set("prisma.orthoReferralCode.findUnique", () => null);
  respuestas.set("prisma.orthoPhotoSet.findFirst", () => null);
  respuestas.set("prisma.orthoNpsSchedule.findMany", () => []);
  respuestas.set("prisma.orthoInstallment.findMany", () => []);
  respuestas.set("prisma.clinic.findUnique", () => ({ id: "cli_a", name: "Clínica A", timezone: "America/Mexico_City", cfdiTaxMode: null }));
  respuestas.set("@/lib/auth-context#getAuthContext", async () => ctx);
  respuestas.set("@/lib/orthodontics/memo-de-peticion#memoDePeticion", (_k: string, f: () => unknown) => f());
  respuestas.set("@/lib/orthodontics/access#hasActiveOrthodonticsModule", async () => true);
  respuestas.set("@/lib/movimientos-paciente/una-accion#esPasoDeOtraAccion", () => false);
  respuestas.set("@/lib/movimientos-paciente/una-accion#conUnSoloMovimiento", (_o: unknown, f: () => unknown) => f());
  respuestas.set("@/lib/movimientos-paciente/una-accion#conMovimientosSoloDeBitacora", (f: () => unknown) => f());
  respuestas.set("@/lib/movimientos-paciente/modulos#anotarFilaDeModulo", async () => {});
  respuestas.set("@/lib/orthodontics/material-de-arco-db#materialesNuevosEnLaBase", async () => true);
  for (const spec of ["@/lib/orthodontics/validar-personas-del-caso-db", "./validar-personas-del-caso-db"]) {
    respuestas.set(`${spec}#validarPersonasDelCaso`, async () => null);
    respuestas.set(`${spec}#validarArchivosInicialesDelDiagnostico`, async () => null);
  }
  respuestas.set("@/lib/orthodontics/alta-caso-tolerance#isMissingColumnError", () => false);
  respuestas.set("@/lib/orthodontics/tecnicas-de-la-clinica-db#cargarNombreDeTecnica", async () => null);
  respuestas.set("@/lib/clinical-shared/treatment-link/link#linkSessionToPlan", async () => ({ linkId: "lk1", alreadyLinked: false }));
});

async function accion(nombre: string) {
  const mod = await import(`../${nombre}`);
  return mod[nombre] as (input: unknown) => Promise<{ ok: boolean; error?: string }>;
}

const HOY = AHORA.toISOString();
const INPUTS: Record<string, unknown> = {
  addWireStep: { treatmentPlanId: "plan1", phase: "ALIGNMENT", material: "SS", shape: "ROUND", gauge: "0.014", archUpper: true, archLower: false, durationWeeks: 6 },
  createOrthoTAD: { treatmentPlanId: "plan1", brand: "DENTOS", size: "1.6x8", location: "entre 15 y 16" },
  updateOrthoAppliances: { treatmentPlanId: "plan1", notes: "cambio" },
  createPhotoSet: { treatmentPlanId: "plan1", patientId: P, setType: "T0", capturedAt: HOY },
  createControlAppointment: { treatmentPlanId: "plan1", patientId: P, scheduledAt: HOY, monthInTreatment: 3 },
  linkDigitalRecord: { treatmentPlanId: "plan1", patientId: P, recordType: "CEPH_ANALYSIS_PDF", fileId: "file1", capturedAt: HOY },
  recordElasticsCompliance: { treatmentPlanId: "plan1", patientId: P, evaluatedAt: HOY, compliancePct: 40 },
  scheduleG15Checkpoint: { treatmentPlanId: "plan1" },
  scheduleRetentionCheckups: { treatmentPlanId: "plan1" },
  toggleRetentionPreSurvey: { treatmentPlanId: "plan1", enabled: false },
  updateRetentionRegimenConfig: { treatmentPlanId: "plan1", regimenDescription: "Hawley de noche" },
  scheduleNpsTimeline: { treatmentPlanId: "plan1" },
  updateNpsConfig: { treatmentPlanId: "plan1" },
  recordNpsResponse: { npsScheduleId: "nps1", npsScore: 9 },
  confirmCollect: { treatmentPlanId: "plan1", method: "efectivo" },
  updateFinancialPlan: { treatmentPlanId: "plan1", totalAmount: 30000, initialDownPayment: 0, installmentCount: 10 },
  recalculatePaymentStatus: { paymentPlanId: "pp1" },
  selectQuoteScenario: { treatmentPlanId: "plan1", scenarioId: "sc1" },
  updateQuoteScenario: { scenarioId: "sc1", totalAmount: 28000 },
  sendSignAtHomeLink: { treatmentPlanId: "plan1" },
  createReferralCode: { treatmentPlanId: "plan1", code: "ANA2026" },
  updateDiagnosis: { diagnosisId: "dx1", patientId: P, clinicalNotes: "nota" },
};

// Las de cobro piden billing.charge, que el DOCTOR no tiene por defecto: las prueba recepción.
const ROL: Record<string, string> = { confirmCollect: "RECEPTIONIST", recalculatePaymentStatus: "RECEPTIONIST" };

for (const nombre of ACCIONES) {
  const rol = ROL[nombre] ?? "DOCTOR";
  test(`${nombre} · ${rol} EXCLUIDO del paciente restringido: no escribe nada`, async () => {
    como(rol);
    const r = await (await accion(nombre))(INPUTS[nombre]);
    assert.deepEqual(escribio(), [], `${nombre} escribió sobre el paciente restringido: ${JSON.stringify(r)}`);
    assert.equal(r.ok, false, JSON.stringify(r));
  });

  test(`${nombre} · ${rol} de la lista pasa la comprobación`, async () => {
    como(rol, "u_otro");
    const r = await (await accion(nombre))(INPUTS[nombre]);
    assert.ok(r.ok || escribio().length > 0, `${nombre} ya no deja pasar a quien SÍ ve al paciente: ${JSON.stringify(r)}`);
  });
}

test("cargarPlanVisible: el ADMIN ve todo; un caso de otra clínica no existe", async () => {
  const { cargarPlanVisible } = await import("../_helpers");
  como("ADMIN");
  const r = await cargarPlanVisible(ctx, "plan1");
  assert.ok(r.ok && r.data.patientId === P, JSON.stringify(r));
  como("ADMIN");
  ctx.clinicId = "cli_b";
  assert.equal((await cargarPlanVisible(ctx, "plan1")).ok, false);
  como("DOCTOR");
  assert.equal((await cargarPlanVisible(ctx, "plan1")).ok, false);
  assert.equal((await cargarPlanVisible(ctx, "")).ok, false);
});

test("sendMensualidadReminder · paciente visible + el caso de OTRO paciente (restringido): no se lee ni se envía nada", async () => {
  como("RECEPTIONIST");
  const enviar = (await import("../whatsapp/sendMensualidadReminder")).sendMensualidadReminder as (i: unknown) => Promise<{ ok: boolean }>;
  const r = await enviar({ patientId: "p_pub", treatmentPlanId: "plan1" });
  assert.equal(r.ok, false, JSON.stringify(r));
  const tocado = llamadas.filter((l) => /cargarCobranzaDelCaso|sendWhatsApp|reservarAviso|registrarMovimiento/.test(l.quien)).map((l) => l.quien);
  assert.deepEqual(tocado, [], "con el caso ajeno siguió adelante (teléfono del responsable y cobranza de otro paciente)");
});

test("sendMensualidadReminder · el caso del propio paciente visible sigue adelante", async () => {
  como("RECEPTIONIST", "u_otro");
  const enviar = (await import("../whatsapp/sendMensualidadReminder")).sendMensualidadReminder as (i: unknown) => Promise<{ ok: boolean }>;
  await enviar({ patientId: P, treatmentPlanId: "plan1" });
  assert.ok(llamadas.some((l) => /cargarCobranzaDelCaso/.test(l.quien)), "ya no llega a leer la cobranza del caso");
});

// ── ids mezclados (los cazó el refutador): se valida un id y se escribía sobre otro ──

test("createPaymentPlan · paciente visible + el caso de OTRO paciente (restringido): no crea el plan de pagos", async () => {
  como("RECEPTIONIST");
  const f = (await import("../createPaymentPlan")).createPaymentPlan as (i: unknown) => Promise<{ ok: boolean }>;
  const r = await f({
    treatmentPlanId: "plan1", patientId: "p_pub", totalAmount: 30000, initialDownPayment: 0, installmentAmount: 3000,
    installmentCount: 10, startDate: HOY, paymentDayOfMonth: 14, preferredPaymentMethod: "CASH",
  });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.deepEqual(escribio(), [], "creó un plan de pagos colgado del caso de otro paciente");
});

test("createTreatmentPlan · paciente visible + el diagnóstico de OTRO paciente (restringido): no abre el caso", async () => {
  como("DOCTOR");
  const f = (await import("../createTreatmentPlan")).createTreatmentPlan as (i: unknown) => Promise<{ ok: boolean }>;
  const r = await f({
    diagnosisId: "dx1", patientId: "p_pub", technique: "METAL_BRACKETS", estimatedDurationMonths: 24,
    totalCostMxn: 30000, anchorageType: "MODERATE", treatmentObjectives: "AESTHETIC_AND_FUNCTIONAL", treatingDoctorId: "u1",
  });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.deepEqual(escribio(), [], "abrió un caso con el diagnóstico de otro paciente");
});

test("createTreatmentPlan · con el diagnóstico del propio paciente sigue abriendo el caso", async () => {
  como("DOCTOR");
  const f = (await import("../createTreatmentPlan")).createTreatmentPlan as (i: unknown) => Promise<{ ok: boolean }>;
  const r = await f({
    diagnosisId: "dx_pub", patientId: "p_pub", technique: "METAL_BRACKETS", estimatedDurationMonths: 24,
    totalCostMxn: 30000, anchorageType: "MODERATE", treatmentObjectives: "AESTHETIC_AND_FUNCTIONAL", treatingDoctorId: "u1",
  });
  assert.ok(r.ok || escribio().length > 0, JSON.stringify(r));
});

test("resolverPromesaDePago · la promesa solo se resuelve dentro del caso ya validado", async () => {
  como("RECEPTIONIST");
  const f = (await import("../cobro/resolverPromesaDePago")).resolverPromesaDePago;
  await f({ treatmentPlanId: "plan_pub", promiseId: "promesa-de-otro-caso", resultado: "cumplida" });
  const llamada = llamadas.find((l) => /#resolverPromesaDePago$/.test(l.quien));
  assert.ok(llamada, "no llegó a resolver");
  assert.equal((llamada!.args[0] as { treatmentPlanId?: string }).treatmentPlanId, "plan_pub", "la promesa se resolvía por id suelto, sin atarla al caso");
});

test("promesas-db: el UPDATE de resolver ata la promesa al caso (WHERE treatmentPlanId)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/lib/orthodontics/cobro/promesas-db.ts", "utf8");
  const updates = src.match(/UPDATE "orthodontic_payment_promises"[\s\S]*?RETURNING/g) ?? [];
  assert.equal(updates.length, 2);
  for (const u of updates) assert.match(u, /"treatmentPlanId" = \$\{treatmentPlanId\}/);
});
