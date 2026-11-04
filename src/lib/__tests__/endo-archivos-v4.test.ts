/**
 * Auditoría de seguridad ola 3 (run-3):
 *   · MEDIA — `upsertRootCanal` verificaba el tratamiento contra la sesión y luego hacía
 *     `rootCanal.update({ where: { id } })` con el id del cliente: `RootCanal` no tiene `clinicId`, así
 *     que la clínica B sobrescribía el conducto de la clínica A y lo movía bajo su tratamiento.
 *   · BAJA — ids de `PatientFile` ajenos: `conductometryFileId`, `controlFileId`,
 *     `intraoperativeFileId` y `patientPhotoFileId` se guardaban sin atar a la clínica ni al paciente, y
 *     los lectores de endodoncia (panel del diente, prefill SOAP, export PDF) seguían la FK sin mirar.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 * Acciones y lectores REALES con dobles por `Module._load` (por paquete o por archivo resuelto). Prisma
 * es un doble que EVALÚA el `where` (igualdades y AND) sobre filas en memoria.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

type Fila = Record<string, any>;
function casa(fila: Fila, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === "AND") return (v as any[]).every((w) => casa(fila, w));
    return fila[k] === v;
  });
}

// ── Base en memoria ────────────────────────────────────────────────────────────────────────────────
const ARCHIVOS: Fila[] = [
  { id: "fPropio", clinicId: "cA", patientId: "pA", name: "propio.png", category: "XRAY_PERIAPICAL", takenAt: null, deletedAt: null },
  { id: "fOtraClinica", clinicId: "cB", patientId: "pB", name: "AJENO-OTRA-CLINICA.png", category: "XRAY_PERIAPICAL", takenAt: null, deletedAt: null },
  { id: "fOtroPaciente", clinicId: "cA", patientId: "pOculto", name: "AJENO-OTRO-PACIENTE.png", category: "XRAY_PERIAPICAL", takenAt: null, deletedAt: null },
];
let tratamientos: Fila[] = [];
let conductos: Fila[] = [];
const escrituras: string[] = [];
let ctx: any = null;
let documentoExport: any = null;

const base = () => {
  tratamientos = [
    { id: "tA", clinicId: "cA", patientId: "pA", toothFdi: 36, treatmentType: "APICECTOMIA", isMultiSession: false, outcomeStatus: "EN_CURSO", deletedAt: null },
    { id: "tB", clinicId: "cB", patientId: "pB", toothFdi: 11, treatmentType: "TC_PRIMARIO", isMultiSession: false, outcomeStatus: "EN_CURSO", deletedAt: null },
  ];
  conductos = [{ id: "rcA", treatmentId: "tA", canonicalName: "MV", workingLengthMm: 21, notes: "LA-NOTA-DE-A", deletedAt: null }];
};

/** Tratamiento de A con sus hijos enlazando un archivo propio y dos ajenos (ids guardados antes del arreglo). */
const tratamientoConArchivos = () => {
  const f = (id: string) => structuredClone(ARCHIVOS.find((a) => a.id === id)!);
  return {
    ...tratamientos[0],
    startedAt: new Date("2026-10-01"), completedAt: null, instrumentationSystem: null, technique: null,
    obturationTechnique: null, sealer: null, notes: null, diagnosis: null, retreatmentInfo: null, intracanalMedications: [],
    rootCanals: [
      { id: "rc1", canonicalName: "MV", workingLengthMm: 21, masterApicalFileIso: 25, masterApicalFileTaper: 0.06, obturationQuality: null, conductometryFile: f("fPropio") },
      { id: "rc2", canonicalName: "DV", workingLengthMm: 20, masterApicalFileIso: 25, masterApicalFileTaper: 0.06, obturationQuality: null, conductometryFile: f("fOtraClinica") },
    ],
    followUps: [{ id: "fu1", milestone: "CONTROL_6M", scheduledAt: new Date("2027-04-01"), performedAt: null, paiScore: null, conclusion: null, controlFile: f("fOtroPaciente") }],
    apicalSurgery: { id: "as1", intraoperativeFile: f("fOtraClinica") },
  };
};

const prisma: any = {
  patientFile: { findFirst: async (a: any) => ARCHIVOS.find((f) => casa(f, a.where)) ?? null },
  endodonticTreatment: {
    findUnique: async (a: any) => tratamientos.find((t) => t.id === a.where.id) ?? null,
    findMany: async () => [tratamientoConArchivos()],
    findFirst: async () => tratamientoConArchivos(),
    update: async () => { escrituras.push("endodonticTreatment.update"); return {}; },
  },
  rootCanal: {
    // `update` por id pelado: lo que hacía el código viejo (sobrescribe la fila que sea).
    update: async (a: any) => {
      const r = conductos.find((c) => c.id === a.where.id);
      if (!r) throw new Error("P2025");
      Object.assign(r, a.data);
      escrituras.push("rootCanal.update");
      return { id: r.id };
    },
    updateMany: async (a: any) => {
      const rs = conductos.filter((c) => casa(c, a.where));
      for (const r of rs) Object.assign(r, a.data);
      if (rs.length) escrituras.push("rootCanal.updateMany");
      return { count: rs.length };
    },
    create: async (a: any) => { escrituras.push("rootCanal.create"); conductos.push({ id: `rc${conductos.length + 1}`, ...a.data }); return { id: "rcNuevo" }; },
  },
  endodonticFollowUp: {
    findUnique: async () => ({ id: "fu1", milestone: "CONTROL_6M", treatmentId: "tA", treatment: { id: "tA", clinicId: "cA", patientId: "pA" } }),
    update: async (a: any) => { escrituras.push(`followUp.update:${a.data.controlFileId}`); return { id: "fu1" }; },
    create: async () => ({ id: "fu2" }),
  },
  apicalSurgery: { upsert: async (a: any) => { escrituras.push(`apicalSurgery.upsert:${a.create.intraoperativeFileId}`); return { id: "as1" }; } },
  implantProstheticPhase: { findUnique: async () => ({ id: "pp1" }) },
  implantPassport: {
    findUnique: async () => null,
    create: async (a: any) => { escrituras.push(`implantPassport.create:${a.data.patientPhotoFileId}`); return { id: "ip1" }; },
    update: async () => ({ id: "ip1" }),
  },
  patient: {
    findFirst: async () => ({ id: "pA", firstName: "Ana", lastName: "Pérez" }),
    findUnique: async () => ({ id: "pA", firstName: "Ana", lastName: "Pérez", patientNumber: "P1", dob: null }),
  },
  clinic: { findUnique: async () => ({ name: "Clínica A" }) },
  endodonticDiagnosis: { findFirst: async () => null, findMany: async () => [] },
  vitalityTest: { findMany: async () => [] },
  clinicalPhoto: { findMany: async () => [] },
};

const raiz = path.resolve(__dirname, "../../..");
let resultEndo: any = null;
let resultImpl: any = null;
const doblesPorArchivo: Record<string, () => unknown> = {
  [path.join(raiz, "src/app/actions/endodontics/_helpers.ts")]: () => ({
    ...resultEndo,
    ENDODONTICS_MODULE_KEY: "endodontics",
    ENDO_AUDIT_ACTIONS: new Proxy({}, { get: (_t, k) => String(k) }),
    getEndoActionContext: async () => resultEndo.ok({ ctx }),
    auditEndo: async () => undefined,
  }),
  [path.join(raiz, "src/app/actions/implants/_helpers.ts")]: () => ({
    getImplantActionContext: async () => resultImpl.ok({ ctx }),
    loadImplantForCtx: async () => resultImpl.ok({ id: "i1", clinicId: "cA", patientId: "pA" }),
    auditImplant: async () => undefined,
    revalidateImplantPaths: () => undefined,
  }),
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  "@/lib/prisma": { prisma },
  // Estas pruebas no son de visibilidad (las fija endo-perio-visibilidad-v6): el paciente se ve.
  "@/lib/patient-visibility": { patientVisibilityAnd: () => [], isVisibilityAdmin: () => false, canSeePatient: () => true },
  "@/lib/auth-context": { getAuthContext: async () => ctx },
  "@/lib/clinical-shared/auth/guard": {
    auditClinicalShared: async () => undefined,
    guardPatient: async () => ({ ok: true, data: {} }),
    sinPermisoClinico: () => null,
  },
  "@/lib/pdf/endodontics-export-document": { EndodonticsExportDocument: (props: any) => { documentoExport = props; return null; } },
  "@/lib/pdf/pediatrics-export-document": { PediatricsExportDocument: () => null },
  "@react-pdf/renderer": { renderToStream: async () => (async function* () { yield Buffer.from("%PDF"); })() },
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
  resultImpl ??= await import("@/app/actions/implants/result");
  base();
  escrituras.length = 0;
  documentoExport = null;
  ctx = { userId: "uA", clinicId: "cA", role: "DOCTOR", permissionsOverride: null, user: { firstName: "D", lastName: "R" } };
});

const CONDUCTO = {
  canonicalName: "MV", workingLengthMm: 22, coronalReferencePoint: "cúspide MV",
  masterApicalFileIso: 30, masterApicalFileTaper: 0.04, notes: "REESCRITO-POR-B",
} as const;

// ── MEDIA: upsertRootCanal ──────────────────────────────────────────────────────────────────────────

test("MEDIA: la clínica B no sobrescribe ni se lleva el conducto de A colgándolo de su tratamiento", async () => {
  ctx = { ...ctx, userId: "uB", clinicId: "cB" };
  const { upsertRootCanal } = await import("@/app/actions/endodontics/treatment");
  const r = await upsertRootCanal({ ...CONDUCTO, id: "rcA", treatmentId: "tB" } as any);
  assert.equal(r.ok, false);
  assert.equal(conductos[0].treatmentId, "tA", "el conducto sigue en el tratamiento de A");
  assert.equal(conductos[0].notes, "LA-NOTA-DE-A", "y sin tocar");
  assert.deepEqual(escrituras, []);
});

test("MEDIA: A sigue editando su conducto y creando nuevos", async () => {
  const { upsertRootCanal } = await import("@/app/actions/endodontics/treatment");
  assert.equal((await upsertRootCanal({ ...CONDUCTO, id: "rcA", treatmentId: "tA" } as any)).ok, true);
  assert.equal(conductos[0].notes, "REESCRITO-POR-B");
  assert.equal((await upsertRootCanal({ ...CONDUCTO, treatmentId: "tA" } as any)).ok, true);
  assert.ok(escrituras.includes("rootCanal.create"));
});

// ── BAJA: guardar ids de archivo ajenos ─────────────────────────────────────────────────────────────

const AJENOS = ["fOtraClinica", "fOtroPaciente", "fNoExiste"];

test("BAJA: conductometría — un archivo de otra clínica, de otro paciente o inexistente no se guarda", async () => {
  const { upsertRootCanal } = await import("@/app/actions/endodontics/treatment");
  for (const conductometryFileId of AJENOS) {
    const r = await upsertRootCanal({ ...CONDUCTO, treatmentId: "tA", conductometryFileId } as any);
    assert.equal(r.ok, false, conductometryFileId);
  }
  assert.deepEqual(escrituras, []);
  assert.equal((await upsertRootCanal({ ...CONDUCTO, treatmentId: "tA", conductometryFileId: "fPropio" } as any)).ok, true);
});

test("BAJA: control de seguimiento y cirugía apical, igual", async () => {
  const { completeFollowUp } = await import("@/app/actions/endodontics/followup");
  const { createApicalSurgery } = await import("@/app/actions/endodontics/retreatment");
  const control = { followUpId: "fu1", performedAt: "2026-11-01T10:00:00.000Z", paiScore: 2, symptomsPresent: false, conclusion: "EXITO" };
  const cirugia = { treatmentId: "tA", interventedRoot: "MV", resectedRootLengthMm: 3, retroFillingMaterial: "MTA", flapType: "SULCULAR" };
  for (const id of AJENOS) {
    assert.equal((await completeFollowUp({ ...control, controlFileId: id } as any)).ok, false, `control ${id}`);
    assert.equal((await createApicalSurgery({ ...cirugia, intraoperativeFileId: id } as any)).ok, false, `cirugía ${id}`);
  }
  assert.deepEqual(escrituras, []);
  const ok1 = await completeFollowUp({ ...control, controlFileId: "fPropio" } as any);
  const ok2 = await createApicalSurgery({ ...cirugia, intraoperativeFileId: "fPropio" } as any);
  assert.ok(ok1.ok, JSON.stringify(ok1));
  assert.ok(ok2.ok, JSON.stringify(ok2));
});

test("BAJA: la foto del carnet del implante, igual", async () => {
  const { generateImplantPassport } = await import("@/app/actions/implants/generateImplantPassport");
  for (const patientPhotoFileId of AJENOS) {
    assert.equal((await generateImplantPassport({ implantId: "i1", patientPhotoFileId })).ok, false, patientPhotoFileId);
  }
  assert.deepEqual(escrituras, []);
  assert.ok((await generateImplantPassport({ implantId: "i1", patientPhotoFileId: "fPropio" })).ok);
  assert.ok((await generateImplantPassport({ implantId: "i1" })).ok, "sin foto sigue valiendo");
});

// ── BAJA: lectores defensivos (ids ajenos guardados antes del arreglo) ──────────────────────────────

const sinAjenos = (x: unknown) => {
  const s = JSON.stringify(x);
  assert.ok(!s.includes("AJENO-OTRA-CLINICA"), "salió el archivo de otra clínica");
  assert.ok(!s.includes("AJENO-OTRO-PACIENTE"), "salió el archivo de otro paciente");
};

test("BAJA: el panel del diente (loadEndoToothData) no lleva archivos ajenos; el propio sí", async () => {
  const { loadEndoToothData } = await import("@/lib/helpers/loadEndoToothData");
  const d: any = await loadEndoToothData({ clinicId: "cA", patientId: "pA", toothFdi: 36 }, { userId: "uA", role: "DOCTOR" } as any);
  sinAjenos(d);
  assert.equal(d.activeTreatment.rootCanals[0].conductometryFile?.name, "propio.png");
  assert.equal(d.activeTreatment.rootCanals[1].conductometryFile, null);
  assert.equal(d.activeTreatment.followUps[0].controlFile, null);
  assert.equal(d.activeTreatment.apicalSurgery.intraoperativeFile, null);
});

test("BAJA: el prefill SOAP de endodoncia tampoco", async () => {
  // El prefill lee el tratamiento; lo que aquí importa es que el objeto que arma no traiga lo ajeno.
  const capturado: any[] = [];
  const original = prisma.endodonticTreatment.findFirst;
  prisma.endodonticTreatment.findFirst = async () => { const t = tratamientoConArchivos(); capturado.push(t); return t; };
  try {
    const { loadEndoSoapPrefill } = await import("@/lib/endodontics/load-soap-prefill");
    await loadEndoSoapPrefill({ clinicId: "cA", patientId: "pA" }).catch(() => null);
    sinAjenos(capturado[0]);
    assert.equal(capturado[0].rootCanals[0].conductometryFile?.name, "propio.png");
  } finally {
    prisma.endodonticTreatment.findFirst = original;
  }
});

test("BAJA: el export PDF de endodoncia no lista radiografías ajenas", async () => {
  const { exportModulePdf } = await import("@/app/actions/clinical-shared/export-module");
  const r = await exportModulePdf({ patientId: "pA", module: "endodontics" } as any);
  assert.ok(r.ok, JSON.stringify(r));
  sinAjenos(documentoExport.radiographs);
  assert.deepEqual(documentoExport.radiographs.map((x: any) => x.fileName), ["propio.png"]);
});

// ── Inventario: ningún escritor de `*FileId` del cliente sin atar a la clínica y al paciente ───────

/** Escritores con su PROPIA guarda equivalente (findFirst con clinicId + patientId de la sesión). */
const GUARDA_PROPIA: Record<string, string> = {
  "src/app/actions/orthodontics/createDiagnosis.ts": "validarArchivosInicialesDelDiagnostico (validar-personas-del-caso-db.ts)",
  "src/app/actions/orthodontics/imagen/saveCephalometricAnalysis.ts": "patientFile.findFirst con clinicId y patientId antes de guardar",
  "src/app/actions/orthodontics/imagen/saveFacialAnalysis.ts": "patientFile.findFirst con clinicId y patientId antes de guardar",
};
const VERTICALES = /src\/app\/api\/(instituto|barber|realty)|src\/lib\/(edu|barber|realty)|src\/app\/(instituto|instituciones|barber|b|barberias|inmobiliaria|i|inmobiliarias)\/|actions\/(edu|barber|realty)|__tests__/;

test("inventario: todo `xFileId: parsed.data.xFileId` pasa ANTES por assertPatientFileInClinic (o una guarda propia)", () => {
  const archivos = execFileSync("git", ["ls-files", "src/app/**/*.ts", "src/lib/**/*.ts"], { cwd: raiz, encoding: "utf8" })
    .split("\n").filter((f) => f && !VERTICALES.test(f));
  const escritura = /(\w+FileId)\s*:\s*parsed\.data\.(\w+FileId)/g;
  const sinGuarda: string[] = [];
  let vistos = 0;
  for (const f of archivos) {
    const src = fs.readFileSync(path.join(raiz, f), "utf8");
    for (const m of src.matchAll(escritura)) {
      vistos++;
      if (f in GUARDA_PROPIA) continue;
      const campo = `parsed.data.${m[2]}`;
      // la guarda: `assertPatientFileInClinic({ id: <campo>` o un `for (const id of [... <campo> ...])` que la llama
      const guarda = [
        src.indexOf(`assertPatientFileInClinic({\n    id: ${campo},`),
        ...[...src.matchAll(/for \(const id of \[([^\]]*)\]\) \{\n\s+if \(!\(await assertPatientFileInClinic/g)]
          .filter((g) => g[1].includes(campo)).map((g) => g.index ?? -1),
      ].filter((i) => i >= 0);
      if (!guarda.length || Math.min(...guarda) > (m.index ?? 0)) sinGuarda.push(`${f} · ${m[1]}`);
    }
  }
  assert.ok(vistos >= 15, `el inventario dejó de ver los escritores (${vistos})`);
  assert.deepEqual(sinGuarda, [], "escritores de *FileId sin atar a la clínica y al paciente");
});
