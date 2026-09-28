/**
 * ws1-t12 — NOTAS DE EVOLUCIÓN DE TRATAMIENTO: como clinicalNotesHandler
 * (fecha, doctor emparejado por nombre, texto), pero con un folio que puede
 * ligar con un tratamiento activo migrado (treatmentPlansHandler). Si el folio
 * casa con un tratamiento de ESTA clínica y ese tratamiento tiene una sesión
 * de exactamente esa fecha, el texto se AGREGA a las notas de la sesión
 * (treatment_sessions); si no, la nota entra al expediente como MIGRATED
 * (patient_documents), igual que clinicalNotesHandler.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/notas-tratamiento.test.ts
 *
 * Se conduce el motor DE VERDAD (runImport + treatmentNotesHandler) con Prisma
 * sustituido por el doble en memoria (doble-prisma.ts). El servicio de
 * patient-documents (NOTA_KIND, sanitizado) es el REAL, no un espejo.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  const antes = new Date("2026-09-01T10:00:00.000Z");
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", logoUrl: null, timezone: "America/Mexico_City", city: "CDMX", address: "Av. Reforma 1", state: "CDMX", phone: "5550001111" }],
    patient: [
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567", email: null, dob: null, deletedAt: null, visibleUserIds: [], curp: null, curpStatus: "PENDING", updatedAt: antes },
    ],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true },
      { id: "u_ana", clinicId: CLINICA, firstName: "Ana", lastName: "López", isActive: true },
    ],
    // Un tratamiento activo YA migrado antes (treatmentPlansHandler), folio
    // "9001", con UNA sesión hecha el 2024-02-10.
    quote: [
      { id: "q_activo", clinicId: CLINICA, patientId: "p1", folio: "P-0100", title: "Rehabilitación", status: "ACCEPTED", total: 850, treatmentPlanId: "plan1", notes: "Tratamiento activo migrado de Dentalink el 27 sep 2026.\nFolio original (tratamiento activo): 9001\nDoctor original: Ana López", createdAt: new Date("2024-02-05T12:00:00Z") },
      // Un ACCEPTED normal del panel, folio distinto: nunca debe confundirse con el sentinel de arriba.
      { id: "q_normal", clinicId: CLINICA, patientId: "p1", folio: "P-0007", title: "Otro", status: "ACCEPTED", total: 500, treatmentPlanId: null, notes: null, createdAt: new Date("2024-01-01T12:00:00Z") },
    ],
    treatmentPlan: [{ id: "plan1", clinicId: CLINICA, patientId: "p1", doctorId: "u_ana", name: "Rehabilitación", status: "ACTIVE" }],
    treatmentSession: [
      { id: "s1", treatmentId: "plan1", sessionNumber: 1, notes: "Migrado: Resina simple", completedAt: new Date("2024-02-10T12:00:00Z") },
    ],
    patientDocument: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});

const engine = () => import("../engine");
const entidades = () => import("../entities");

function reiniciar() {
  base = crearBase(semilla());
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(
  file: File,
  opts: { dryRun?: boolean; skipDuplicates?: boolean } = { dryRun: true },
): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS.treatmentNotes, {
    file,
    clinicId: CLINICA,
    userId: IMPORTA,
    role: "ADMIN",
    dryRun: opts.dryRun ?? true,
    skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: null,
    origin: null,
    valueMapping: null,
    sheet: null,
  });
}

const CABECERA = "nombre,apellido,telefono,folio,fecha,doctor,titulo,nota";

test("folio liga con tratamiento activo + sesión de esa fecha: el texto se AGREGA a la sesión (no crea nota de expediente)", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,9001,2024-02-10,Ana López,Control,Refiere sensibilidad leve al frío tras la resina.",
  ].join("\n");
  const prev = await correr(csv("n1.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [1, 1, 0, 0]);
  assert.equal(fila(prev, 2).data.treatmentTitle, "Rehabilitación");

  const hecho = await correr(csv("n1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  const s = tabla("treatmentSession").find((x) => x.id === "s1")!;
  assert.match(s.notes, /Migrado: Resina simple/, "no pisa lo que ya tenía");
  assert.match(s.notes, /Refiere sensibilidad leve al frío/, "y agrega el texto nuevo");
  assert.equal(tabla("patientDocument").length, 0, "no crea nota de expediente: quedó ligada a la sesión");

  // Reimportar el mismo archivo: el texto ya está contenido (mergeText) → no se repite ni se cuenta de nuevo.
  const prev2 = await correr(csv("n1.csv", texto), { dryRun: true });
  assert.equal(prev2.duplicados, 1);
  assert.match(fila(prev2, 2).warnings.join(" · "), /ya está en la sesión/);
  const otraVez = await correr(csv("n1.csv", texto), { dryRun: false });
  assert.equal(otraVez.created, 0);
  const s2 = tabla("treatmentSession").find((x) => x.id === "s1")!;
  assert.equal((s2.notes.match(/Refiere sensibilidad leve al frío/g) ?? []).length, 1, "no se duplica el texto en la sesión");
});

test("folio liga con el tratamiento pero esa fecha NO tiene sesión: va al expediente, con la referencia al tratamiento", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,9001,2024-02-20,Ana López,Seguimiento,Llamada de seguimiento: sin molestias.",
  ].join("\n");
  const prev = await correr(csv("n2.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  const hecho = await correr(csv("n2.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("treatmentSession").find((x) => x.id === "s1")!.notes, "Migrado: Resina simple", "la sesión existente no se toca");
  const nota = tabla("patientDocument")[0];
  assert.ok(nota, "crea la nota de expediente");
  assert.equal(nota.status, "MIGRATED");
  assert.match(nota.body, /Rehabilitación/, "la nota dice de qué tratamiento migrado viene");
  assert.match(nota.body, /folio 9001/);
});

test("sin folio: se comporta como clinicalNotesHandler (nota MIGRATED en el expediente)", async () => {
  reiniciar();
  const texto = ["nombre,apellido,telefono,fecha,doctor,titulo,nota", "María,Hernández,5551234567,2024-03-01,Ana López,Control,Revisión de rutina sin hallazgos."].join("\n");
  const hecho = await correr(csv("n3.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("patientDocument").length, 1);
  assert.equal(tabla("treatmentSession").find((x) => x.id === "s1")!.notes, "Migrado: Resina simple");
});

test("folio que no corresponde a ningún tratamiento activo importado: aviso + va al expediente", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,9999,2024-03-02,Ana López,Control,Nota con folio inventado."].join("\n");
  const prev = await correr(csv("n4.csv", texto), { dryRun: true });
  assert.match(fila(prev, 2).warnings.join(" · "), /no corresponde a ningún tratamiento activo importado/);
  const hecho = await correr(csv("n4.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("patientDocument").length, 1);
});

test("el folio de un ACCEPTED normal del panel (sin el sentinel de tratamiento activo migrado) nunca liga", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,P-0007,2024-01-01,Ana López,Control,Nota que intenta ligar con un presupuesto normal."].join("\n");
  const hecho = await correr(csv("n5.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("patientDocument").length, 1, "va al expediente: el folio de un Quote normal no es el de un tratamiento activo migrado");
});

test("doctor no encontrado: la nota conserva el nombre original como autor, nunca bloquea", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,9001,2024-02-10,Dr. Inventado,Control,Nota de un doctor que no existe en la clínica."].join("\n");
  const prev = await correr(csv("n6.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings.join(" · "), /Doctor "Dr\. Inventado" no encontrado.*conserva ese nombre como autor original/);
});
