/**
 * ws1-t11 · lead 14 (auditoría run-2) — las server actions de especialidad que
 * reciben el id de un REGISTRO (foto, plan o juego de ortodoncia, orden de
 * laboratorio, hoja de referencia, recordatorio, sesión, tutor, consentimiento
 * y los demás registros de pediatría) respetan la visibilidad por paciente.
 *
 * Run: npm run test:acciones-por-id-visibilidad
 *
 * El hallazgo: las entradas por patientId pasan por loadPatientForOrtho /
 * loadPatientForPediatrics / guardPatient (que aplican visibleUserIds), pero
 * las que reciben el id de un registro lo cargaban por { id, clinicId } y
 * escribían. Un doctor de la clínica EXCLUIDO de un paciente restringido (que
 * para él «no existe») podía modificar o borrar sus registros si tenía el id.
 *
 * Se ejecutan las acciones REALES con sus helpers reales (contexto, guardias,
 * visibilidad) y un Prisma de mentira que evalúa los `where` sobre filas en
 * memoria. Endodoncia e implantes no van aquí: los lleva feat/seg-archivos-permisos.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { preparar, respuestas, llamadas, prismaFalso, cumple, Redireccion } from "../../auth/__tests__/_arnes-paginas-server";

const ORTO = (f: string) => `src/app/actions/orthodontics/${f}.ts`;
const COMP = (f: string) => `src/app/actions/clinical-shared/${f}.ts`;
const PED = (f: string) => `src/app/actions/pediatrics/${f}.ts`;

const prisma = prismaFalso();
preparar({
  paginas: [
    ORTO("_helpers"), ORTO("uploadPhotoToSet"), ORTO("updateTreatmentPlan"), ORTO("advanceTreatmentPhase"), ORTO("createOrthodonticConsent"),
    "src/lib/clinical-shared/auth/guard.ts",
    COMP("photos"), COMP("lab-orders"), COMP("referrals"), COMP("reminders"), COMP("treatment-links"),
    PED("_helpers"), PED("guardian"), PED("consent"), PED("maintainer"), PED("sealant"), PED("record"),
    PED("habits"), PED("eruption"), PED("behavior"), PED("cambra"), PED("endodontic"), PED("fluoride"),
  ],
  reales: [
    "zod", "@prisma/client", "./_helpers", "./result", "@/lib/clinical-shared/result",
    "@/lib/clinical-shared/auth/guard", "@/lib/clinical-shared/auth/paciente-oculto",
    "@/lib/patient-visibility", "@/lib/auth/guardia-clinica", "@/lib/auth/permissions",
    "@/lib/orthodontics/acceso-doctor", "@/lib/validation/orthodontics", "@/lib/validation/id",
    "@/lib/orthodontics/photo-set-helpers", "@/lib/orthodontics/phase-machine",
    "@/lib/pediatrics/age", "@/lib/pediatrics/permissions",
  ],
  fijos: {
    "@/lib/prisma": { prisma },
    "next/navigation": { redirect: (d: string) => { throw new Redireccion(d); }, notFound: () => { throw new Error("404"); } },
  },
});

// ── la base de mentira: un paciente restringido a «u_otro» y un registro suyo de cada tipo ──
const NINO = new Date(Date.now() - 8 * 365 * 86_400_000);
const P = "p_priv";
const base = { clinicId: "cli_a", patientId: P, deletedAt: null };
const FILAS: Record<string, any[]> = {
  patient: [{ id: P, clinicId: "cli_a", deletedAt: null, visibleUserIds: ["u_otro"], dob: NINO, firstName: "Privada", lastName: "Dos" }],
  orthoPhotoSet: [{ id: "set1", ...base, treatmentPlanId: "plan1", setType: "T0" }],
  patientFile: [{ id: "file1", ...base }],
  orthodonticTreatmentPlan: [{
    id: "plan1", ...base, status: "ACTIVE", treatingDoctorId: null, responsibleGuardianId: null,
    phases: [{ id: "f1", phaseKey: "LEVELING", status: "IN_PROGRESS", orderIndex: 1 }, { id: "f2", phaseKey: "SPACE_CLOSURE", status: "PENDING", orderIndex: 2 }],
  }],
  clinicalPhoto: [{ id: "foto1", ...base, blobUrl: "b/1.jpg", thumbnailUrl: null }],
  labOrder: [{ id: "lab1", ...base }],
  referralLetter: [{ id: "ref1", ...base }],
  clinicalReminder: [{ id: "rec1", ...base, status: "pending" }],
  treatmentSession: [{ id: "ses1", completedAt: null, sessionNumber: 1, treatmentId: "tp1", treatment: { id: "tp1", clinicId: "cli_a", patientId: P, name: "Plan general", status: "ACTIVE" } }],
  treatmentPlan: [{ id: "tp1", clinicId: "cli_a", patientId: P }],
  guardian: [{ id: "tut1", ...base, principal: false }],
  pediatricConsent: [{ id: "con1", ...base, revokedAt: null, minorAssentRequired: true }],
  spaceMaintainer: [{ id: "man1", ...base, currentStatus: "activo", removedAt: null }],
  sealant: [{ id: "sel1", ...base, retentionStatus: "completo", toothFdi: 55 }],
  pediatricRecord: [{ id: "pr1", ...base }],
  oralHabit: [{ id: "hab1", ...base, endedAt: null }],
  eruptionRecord: [{ id: "eru1", ...base }],
  behaviorAssessment: [{ id: "con_1", ...base, scale: "frankl", value: 3, recordedAt: NINO, notes: null }],
  cariesRiskAssessment: [{ id: "cam1", ...base }],
  pediatricEndodonticTreatment: [{ id: "pe1", ...base }],
  fluorideApplication: [{ id: "flu1", ...base }],
};

let ctx: any;
function como(role: string, userId = "u1") {
  ctx = {
    userId, clinicId: "cli_a", role, permissionsOverride: [], clinicCategory: "DENTAL",
    isAdmin: role === "ADMIN", isSuperAdmin: false, clinic: { id: "cli_a", category: "DENTAL" },
  };
}

const ESCRITURA = /^prisma\.\w+\.(update|updateMany|create|createMany|delete|deleteMany|upsert)$|#(linkSessionToPlan|removeClinicalPhotoBinary|aplicarEfectosDeEstado)$/;
const escribio = () => llamadas.filter((l) => ESCRITURA.test(l.quien)).map((l) => l.quien);

beforeEach(() => {
  llamadas.length = 0;
  respuestas.clear();
  for (const [modelo, filas] of Object.entries(FILAS)) {
    const una = ({ where }: any) => filas.find((f) => cumple(f, where)) ?? null;
    respuestas.set(`prisma.${modelo}.findUnique`, una);
    respuestas.set(`prisma.${modelo}.findFirst`, una);
    respuestas.set(`prisma.${modelo}.findMany`, ({ where }: any = {}) => filas.filter((f) => cumple(f, where)));
    respuestas.set(`prisma.${modelo}.update`, ({ where }: any) => ({ ...(filas.find((f) => f.id === where?.id) ?? {}), id: where?.id }));
    respuestas.set(`prisma.${modelo}.create`, ({ data }: any) => ({ id: `${modelo}_nuevo`, ...data }));
    respuestas.set(`prisma.${modelo}.updateMany`, () => ({ count: 1 }));
  }
  respuestas.set("prisma.pediatricRecord.findUnique", ({ where }: any) => FILAS.pediatricRecord.find((f) => cumple(f, where)) ?? { id: "pr1", ...base });
  respuestas.set("@/lib/auth-context#getAuthContext", async () => ctx);
  respuestas.set("@/lib/orthodontics/memo-de-peticion#memoDePeticion", (_k: string, f: () => unknown) => f());
  respuestas.set("@/lib/orthodontics/access#hasActiveOrthodonticsModule", async () => true);
  respuestas.set("@/lib/marketplace/access-control#canAccessModule", async () => ({ hasAccess: true }));
  respuestas.set("@/lib/movimientos-paciente/una-accion#esPasoDeOtraAccion", () => false);
  respuestas.set("@/lib/movimientos-paciente/una-accion#conUnSoloMovimiento", (_o: unknown, f: () => unknown) => f());
  respuestas.set("@/lib/movimientos-paciente/una-accion#conMovimientosSoloDeBitacora", (f: () => unknown) => f());
  respuestas.set("@/lib/movimientos-paciente/modulos#anotarFilaDeModulo", async () => {});
  respuestas.set("@/lib/orthodontics/validar-personas-del-caso-db#validarPersonasDelCaso", async () => null);
  respuestas.set("@/lib/orthodontics/alta-caso-tolerance#isMissingColumnError", () => false);
  respuestas.set("@/lib/orthodontics/controles-con-otro-doctor-db#controlesConOtroDoctor", async () => 0);
  respuestas.set("@/lib/orthodontics/cobro/precio-desfasado#avisoDePrecioDesfasado", () => undefined);
  respuestas.set("@/lib/orthodontics/precio-control-del-caso#cambioLaTecnica", () => false);
  respuestas.set("@/lib/clinical-shared/treatment-link/link#linkSessionToPlan", async () => ({ linkId: "lk1", alreadyLinked: false }));
  respuestas.set("@/lib/clinical-shared/photos/storage#removeClinicalPhotoBinary", async () => true);
});

async function accion(archivo: string, nombre: string) {
  const mod = await import(`../../../../${archivo}`);
  return mod[nombre] as (input: unknown) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
}

interface Caso { archivo: string; nombre: string; input: unknown; lectura?: boolean }
const SIG = "https://x/firma.png";
const CASOS: Caso[] = [
  { archivo: ORTO("uploadPhotoToSet"), nombre: "uploadPhotoToSet", input: { setId: "set1", view: "EXTRA_FRONTAL", fileId: "file1" } },
  { archivo: ORTO("updateTreatmentPlan"), nombre: "updateTreatmentPlan", input: { treatmentPlanId: "plan1", status: "ON_HOLD", onHoldReason: "pausa" } },
  { archivo: ORTO("advanceTreatmentPhase"), nombre: "advanceTreatmentPhase", input: { treatmentPlanId: "plan1", toPhase: "SPACE_CLOSURE" } },
  { archivo: ORTO("createOrthodonticConsent"), nombre: "createOrthodonticConsent", input: { treatmentPlanId: "plan1", patientId: P, consentType: "TREATMENT", signedAt: new Date().toISOString(), signerName: "Tutor Uno" } },
  { archivo: COMP("photos"), nombre: "deleteClinicalPhotoAction", input: { id: "foto1" } },
  { archivo: COMP("photos"), nombre: "updatePhotoAnnotationsAction", input: { id: "foto1", annotations: [] } },
  { archivo: COMP("lab-orders"), nombre: "setLabOrderStatus", input: { id: "lab1", status: "sent" } },
  { archivo: COMP("referrals"), nombre: "markReferralSent", input: { id: "ref1", channel: "email" } },
  { archivo: COMP("reminders"), nombre: "cancelClinicalReminder", input: { id: "rec1" } },
  { archivo: COMP("treatment-links"), nombre: "linkSessionToTreatmentPlan", input: { module: "pediatrics", moduleEntityType: "sealant", moduleSessionId: "sel1", treatmentSessionId: "ses1" } },
  { archivo: COMP("treatment-links"), nombre: "listOpenTreatmentSessions", input: { patientId: P }, lectura: true },
  { archivo: PED("guardian"), nombre: "updateGuardian", input: { id: "tut1", patientId: P, fullName: "Tutor Uno", parentesco: "madre", phone: "5512345678" } },
  { archivo: PED("guardian"), nombre: "setPrimaryGuardian", input: { guardianId: "tut1" } },
  { archivo: PED("guardian"), nombre: "deleteGuardian", input: { guardianId: "tut1" } },
  { archivo: PED("consent"), nombre: "signConsentByGuardian", input: { consentId: "con1", signatureUrl: SIG } },
  { archivo: PED("consent"), nombre: "signConsentByMinor", input: { consentId: "con1", signatureUrl: SIG } },
  { archivo: PED("consent"), nombre: "voidConsent", input: { consentId: "con1", reason: "error de captura" } },
  { archivo: PED("maintainer"), nombre: "updateMaintainerStatus", input: { id: "man1", currentStatus: "fracturado" } },
  { archivo: PED("maintainer"), nombre: "retireMaintainer", input: { id: "man1" } },
  { archivo: PED("sealant"), nombre: "updateSealantRetention", input: { id: "sel1", retentionStatus: "parcial" } },
  { archivo: PED("sealant"), nombre: "reapplySealant", input: { id: "sel1" } },
  { archivo: PED("record"), nombre: "updatePediatricRecord", input: { id: "pr1", patientId: P, prematuro: true } },
  { archivo: PED("habits"), nombre: "updateHabit", input: { id: "hab1", patientId: P, habitType: "chupon", startedAt: new Date().toISOString() } },
  { archivo: PED("habits"), nombre: "resolveHabit", input: { id: "hab1" } },
  { archivo: PED("habits"), nombre: "deleteHabit", input: { id: "hab1" } },
  { archivo: PED("eruption"), nombre: "deleteEruption", input: { id: "eru1" } },
  { archivo: PED("behavior"), nombre: "deleteBehavior", input: { id: "con_1" } },
  { archivo: PED("record"), nombre: "getPediatricRecord", input: P, lectura: true },
  { archivo: PED("behavior"), nombre: "getBehaviorHistory", input: P, lectura: true },
  { archivo: PED("cambra"), nombre: "getCambraLatest", input: P, lectura: true },
  { archivo: PED("cambra"), nombre: "getCambraHistory", input: P, lectura: true },
  { archivo: PED("endodontic"), nombre: "getEndoHistory", input: P, lectura: true },
  { archivo: PED("fluoride"), nombre: "getFluorideHistory", input: P, lectura: true },
];

const vacio = (d: unknown) => d == null || (Array.isArray(d) && d.length === 0);

for (const c of CASOS) {
  test(`${c.nombre} · doctor EXCLUIDO del paciente restringido: ${c.lectura ? "no lee nada" : "no escribe nada"}`, async () => {
    como("DOCTOR");
    const r = await (await accion(c.archivo, c.nombre))(c.input);
    if (c.lectura) {
      assert.ok(!r.ok || vacio(r.data), `${c.nombre} entregó datos del paciente restringido: ${JSON.stringify(r)}`);
    } else {
      assert.deepEqual(escribio(), [], `${c.nombre} escribió sobre el paciente restringido`);
      assert.equal(r.ok, false);
    }
  });

  test(`${c.nombre} · el doctor de la lista sigue pudiendo`, async () => {
    como("DOCTOR", "u_otro");
    const r = await (await accion(c.archivo, c.nombre))(c.input);
    if (c.lectura) assert.ok(r.ok && !vacio(r.data), `${c.nombre}: ${JSON.stringify(r)}`);
    else assert.ok(escribio().length > 0, `${c.nombre} ya no escribe para quien SÍ ve al paciente: ${JSON.stringify(r)}`);
  });
}

test("un registro de un paciente SIN lista (todo el equipo lo ve) no cambia para nadie", async () => {
  const antes = FILAS.patient[0].visibleUserIds;
  FILAS.patient[0].visibleUserIds = [];
  try {
    como("DOCTOR");
    const r = await (await accion(COMP("photos"), "deleteClinicalPhotoAction"))({ id: "foto1" });
    assert.ok(r.ok, JSON.stringify(r));
  } finally {
    FILAS.patient[0].visibleUserIds = antes;
  }
});

test("el ADMIN ve a todos: la visibilidad no le aplica", async () => {
  como("ADMIN");
  const r = await (await accion(PED("consent"), "voidConsent"))({ consentId: "con1", reason: "error de captura" });
  assert.ok(r.ok, JSON.stringify(r));
});
