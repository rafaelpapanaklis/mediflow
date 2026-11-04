/**
 * Seguridad ola 2b · H1 de la revisión de t2 (mismo patrón que el lead 14): las server actions de
 * endodoncia y periodoncia que reciben el id de un REGISTRO (tratamiento, control, diagnóstico,
 * periodontograma, clasificación, recesión, plan…) lo cargaban por id y comparaban solo `clinicId`. Un
 * doctor que no está en la lista del paciente restringido (`visibleUserIds`) escribía igual.
 * Ahora: `pacienteOcultoPara(ctx, patientId)` tras la comprobación de clínica, con el mismo «no
 * encontrado» que si el registro no existiera, como en pediatría.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 *   · comportamiento — acciones REALES (una muestra de cada archivo) con dobles por `Module._load`; la
 *     visibilidad es la de verdad (`@/lib/patient-visibility` sin doblar);
 *   · inventario — toda acción exportada de `actions/endodontics` y `actions/periodontics` pasa por una
 *     guarda de visibilidad (o está en la lista de excepciones con su porqué).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";

const raiz = path.resolve(__dirname, "../../..");

// ── Base en memoria: todo es del paciente pA, de la clínica cA ──────────────────────────────────────
let listaDelPaciente: string[] = [];
const escrituras: string[] = [];
let ctx: any = null;

const fila = (extra: Record<string, unknown> = {}) => ({ clinicId: "cA", patientId: "pA", deletedAt: null, ...extra });
const escribe = (k: string) => async (a: any) => { escrituras.push(k); return { id: a?.where?.id ?? "x", patientId: "pA", ...(a?.data ?? {}) }; };

const prisma: any = {
  patient: { findUnique: async () => ({ visibleUserIds: listaDelPaciente }) },
  endodonticTreatment: {
    findUnique: async () => fila({ id: "tA", treatmentType: "APICECTOMIA", isMultiSession: false }),
  },
  rootCanal: {
    updateMany: async () => { escrituras.push("rootCanal.updateMany"); return { count: 1 }; },
    create: escribe("rootCanal.create"),
  },
  endodonticFollowUp: {
    findUnique: async () => ({ id: "fu1", milestone: "CONTROL_6M", treatmentId: "tA", treatment: { id: "tA", clinicId: "cA", patientId: "pA" } }),
    update: escribe("endodonticFollowUp.update"),
    create: escribe("endodonticFollowUp.create"),
  },
  apicalSurgery: { upsert: escribe("apicalSurgery.upsert") },
  periodontalClassification: {
    findFirst: async () => fila({ id: "cl1", stage: "STAGE_II", grade: "GRADE_A", extension: "LOCALIZADA", overriddenByDoctor: false, justification: null }),
    update: escribe("periodontalClassification.update"),
  },
  periodontalRecord: { findFirst: async () => fila({ id: "pr1" }), update: escribe("periodontalRecord.update") },
  gingivalRecession: { findFirst: async () => fila({ id: "gr1", resolvedAt: null }), update: escribe("gingivalRecession.update") },
  periodontalTreatmentPlan: {
    findFirst: async () => fila({ id: "pl1", currentPhase: "PHASE_1" }),
    update: escribe("periodontalTreatmentPlan.update"),
  },
};

let resultEndo: any = null;
let resultPerio: any = null;
const doblesPorArchivo: Record<string, () => unknown> = {
  [path.join(raiz, "src/app/actions/endodontics/_helpers.ts")]: () => ({
    ...resultEndo,
    ENDODONTICS_MODULE_KEY: "endodontics",
    ENDO_AUDIT_ACTIONS: new Proxy({}, { get: (_t, k) => String(k) }),
    getEndoActionContext: async () => resultEndo.ok({ ctx }),
    auditEndo: async () => undefined,
  }),
  [path.join(raiz, "src/app/actions/periodontics/_helpers.ts")]: () => ({
    ...resultPerio,
    PERIODONTICS_MODULE_KEY: "periodontics",
    PERIO_AUDIT_ACTIONS: new Proxy({}, { get: (_t, k) => String(k) }),
    getPerioActionContext: async () => resultPerio.ok({ ctx }),
    auditPerio: async () => undefined,
  }),
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  "@/lib/prisma": { prisma },
};
const Mod = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = Mod._load;
Mod._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req in dobles) return dobles[req];
  if (req.startsWith(".") && resultEndo) {
    try {
      const f = Mod._resolveFilename(req, parent, isMain);
      if (f in doblesPorArchivo) return doblesPorArchivo[f]();
    } catch { /* lo resuelve la carga original */ }
  }
  return cargaOriginal.call(this, req, parent, isMain);
};

beforeEach(async () => {
  resultEndo ??= await import("@/app/actions/endodontics/result");
  resultPerio ??= await import("@/app/actions/periodontics/result");
  escrituras.length = 0;
  listaDelPaciente = [];
  ctx = { userId: "uYo", clinicId: "cA", role: "DOCTOR", permissionsOverride: null };
});

/** Las acciones de la muestra, con una entrada válida cada una. */
async function acciones() {
  const { upsertRootCanal } = await import("@/app/actions/endodontics/treatment");
  const { completeFollowUp } = await import("@/app/actions/endodontics/followup");
  const { createApicalSurgery } = await import("@/app/actions/endodontics/retreatment");
  const { overrideClassification } = await import("@/app/actions/periodontics/classification");
  const { deletePeriodontalRecord } = await import("@/app/actions/periodontics/chart");
  const { resolveGingivalRecession } = await import("@/app/actions/periodontics/recession");
  const { advancePhase } = await import("@/app/actions/periodontics/plan");
  return {
    "endo · upsertRootCanal": () => upsertRootCanal({ treatmentId: "tA", canonicalName: "MV", workingLengthMm: 21, coronalReferencePoint: "cúspide", masterApicalFileIso: 25, masterApicalFileTaper: 0.06 } as any),
    "endo · completeFollowUp": () => completeFollowUp({ followUpId: "fu1", performedAt: "2026-11-01T10:00:00.000Z", paiScore: 2, symptomsPresent: false, conclusion: "EXITO" } as any),
    "endo · createApicalSurgery": () => createApicalSurgery({ treatmentId: "tA", interventedRoot: "MV", resectedRootLengthMm: 3, retroFillingMaterial: "MTA", flapType: "SULCULAR" } as any),
    "perio · overrideClassification": () => overrideClassification({ classificationId: "cl1", stage: "STAGE_III", grade: "GRADE_B", extension: "GENERALIZADA", justification: "Revisión clínica del caso completo" }),
    "perio · deletePeriodontalRecord": () => deletePeriodontalRecord("pr1"),
    "perio · resolveGingivalRecession": () => resolveGingivalRecession("gr1"),
    "perio · advancePhase": () => advancePhase({ planId: "pl1", toPhase: "PHASE_2" }),
  } as Record<string, () => Promise<any>>;
}

test("H1: un doctor fuera de la lista del paciente restringido no escribe (mismo «no encontrado»)", async () => {
  listaDelPaciente = ["uOtro"];
  for (const [nombre, llamar] of Object.entries(await acciones())) {
    const r = await llamar();
    assert.equal(r.ok, false, nombre);
    assert.match(String(r.error), /no encontrad/i, `${nombre}: ${r.error}`);
  }
  assert.deepEqual(escrituras, [], "ni una escritura sobre el paciente restringido");
});

test("H1: quien sí está en la lista, un admin, o un paciente sin restringir: escriben como siempre", async () => {
  const casos: Array<[string, string[], any]> = [
    ["doctor en la lista", ["uYo"], { role: "DOCTOR" }],
    ["admin (la lista no le aplica)", ["uOtro"], { role: "ADMIN" }],
    ["paciente sin restringir", [], { role: "DOCTOR" }],
  ];
  for (const [caso, lista, extra] of casos) {
    listaDelPaciente = lista;
    ctx = { ...ctx, ...extra };
    for (const [nombre, llamar] of Object.entries(await acciones())) {
      escrituras.length = 0;
      const r = await llamar();
      assert.equal(r.ok, true, `${caso} · ${nombre}: ${r.error}`);
      assert.ok(escrituras.length > 0, `${caso} · ${nombre}: no escribió`);
    }
  }
});

// ── Inventario ──────────────────────────────────────────────────────────────────────────────────────

/** Acciones exportadas cuya guarda vive en la función a la que delegan, con su porqué. */
const SIN_PACIENTE: Record<string, string> = {
  "src/app/actions/endodontics/reports.ts#getTreatmentReportUrl": "delega en exportTreatmentReportPdf (canViewPatient)",
  "src/app/actions/periodontics/treatment-link.ts#completeSrpSession": "delega en completeAndLink (loadPatientForPerio + verificador atado al paciente)",
  "src/app/actions/periodontics/treatment-link.ts#completeReevaluation": "delega en completeAndLink (loadPatientForPerio + verificador atado al paciente)",
  "src/app/actions/periodontics/treatment-link.ts#completePeriSurgery": "delega en completeAndLink (loadPatientForPerio + verificador atado al paciente)",
};
const GUARDAS = /pacienteOcultoPara\(|loadPatientForEndo\(|loadPatientForPerio\(|patientVisibilityAnd\(|canSeePatient\(|canViewPatient\(|assertPatientVisible\(/;

test("inventario: toda acción de endodoncia y periodoncia pasa por una guarda de visibilidad del paciente", () => {
  const sinGuarda: string[] = [];
  let vistas = 0;
  for (const carpeta of ["src/app/actions/endodontics", "src/app/actions/periodontics"]) {
    for (const f of fs.readdirSync(path.join(raiz, carpeta)).filter((x) => x.endsWith(".ts") && !x.startsWith("_"))) {
      const src = fs.readFileSync(path.join(raiz, carpeta, f), "utf8");
      if (!/^["']use server["']/m.test(src)) continue;
      // cada `export async function` hasta la siguiente
      const partes = src.split(/(?=^export async function )/m).filter((p) => p.startsWith("export async function "));
      for (const cuerpo of partes) {
        const nombre = cuerpo.match(/^export async function (\w+)/)![1];
        const id = `${carpeta}/${f}#${nombre}`;
        vistas++;
        if (SIN_PACIENTE[id]) continue;
        if (!GUARDAS.test(cuerpo)) sinGuarda.push(id);
      }
    }
  }
  assert.ok(vistas >= 40, `el inventario dejó de ver las acciones (${vistas})`);
  assert.deepEqual(sinGuarda, [], "acciones por id sin guarda de visibilidad del paciente");
});
