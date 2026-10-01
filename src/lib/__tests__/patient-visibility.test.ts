/**
 * Visibilidad por paciente — la regla que la Ola 3 aplica a las ESCRITURAS.
 *
 * Run: npm run test:patient-visibility
 *
 * Cubre el núcleo PURO del helper (canSeePatient / patientVisibilityFilter y
 * derivados): assertPatientVisible y canViewPatient son una findFirst delgada
 * sobre patientVisibilityFilter, así que fijar aquí la forma del filtro fija
 * el enforcement de TODAS las rutas que lo usan (lecturas y, desde esta ola,
 * también las escrituras: odontograma, records, notas, anotaciones, CBCT,
 * modelos 3D, cancelar/check-in de cita, factura desde cita y paquetes).
 *
 * Casos exigidos por el encargo: permitido / denegado / admin siempre pasa /
 * lista vacía = todos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canSeePatient,
  patientVisibilityFilter,
  patientVisibilityAnd,
  relatedPatientVisibilityAnd,
  isVisibilityAdmin,
  type VisibilityViewer,
} from "../patient-visibility";

const CLINIC = "clinic_1";
const doctorA: VisibilityViewer = { userId: "doc_A", role: "DOCTOR", clinicId: CLINIC };
const doctorB: VisibilityViewer = { userId: "doc_B", role: "DOCTOR", clinicId: CLINIC };
const recep: VisibilityViewer = { userId: "rec_1", role: "RECEPTIONIST", clinicId: CLINIC };
const admin: VisibilityViewer = { userId: "adm_1", role: "ADMIN", clinicId: CLINIC };
const superAdmin: VisibilityViewer = { userId: "sa_1", role: "SUPER_ADMIN", clinicId: CLINIC };

test("lista vacía = TODOS lo ven (el default histórico, cero cambios)", () => {
  for (const v of [doctorA, doctorB, recep, admin, superAdmin]) {
    assert.equal(canSeePatient(v, []), true, `${v.role} debería ver sin lista`);
    assert.equal(canSeePatient(v, null), true);
    assert.equal(canSeePatient(v, undefined), true);
  }
});

test("permitido: quien está en la lista ve (y escribe)", () => {
  assert.equal(canSeePatient(doctorA, ["doc_A"]), true);
  assert.equal(canSeePatient(doctorA, ["doc_B", "doc_A", "rec_1"]), true);
});

test("denegado: quien NO está en la lista no ve — la escritura debe dar el mismo 404", () => {
  assert.equal(canSeePatient(doctorB, ["doc_A"]), false);
  assert.equal(canSeePatient(recep, ["doc_A"]), false);
});

test("admin siempre pasa (ADMIN y SUPER_ADMIN), aunque no esté en la lista", () => {
  assert.equal(canSeePatient(admin, ["doc_A"]), true);
  assert.equal(canSeePatient(superAdmin, ["doc_A"]), true);
  assert.equal(isVisibilityAdmin("ADMIN"), true);
  assert.equal(isVisibilityAdmin("SUPER_ADMIN"), true);
  assert.equal(isVisibilityAdmin("DOCTOR"), false);
  assert.equal(isVisibilityAdmin("RECEPTIONIST"), false);
  assert.equal(isVisibilityAdmin("READONLY"), false);
});

test("patientVisibilityFilter: null para admins (query intacto), OR isEmpty/has para el resto", () => {
  assert.equal(patientVisibilityFilter(admin), null);
  assert.equal(patientVisibilityFilter(superAdmin), null);

  const f = patientVisibilityFilter(doctorB);
  assert.deepEqual(f, {
    OR: [
      { visibleUserIds: { isEmpty: true } },
      { visibleUserIds: { has: "doc_B" } },
    ],
  });
});

test("patientVisibilityAnd: [] para admin, [filtro] para no-admin (spread en AND, nunca OR)", () => {
  assert.deepEqual(patientVisibilityAnd(admin), []);
  const and = patientVisibilityAnd(doctorA);
  assert.equal(and.length, 1);
  assert.ok(and[0].OR, "el filtro va como UN elemento del AND con su OR interno");
});

test("relatedPatientVisibilityAnd: filtra vía la relación patient; patientNullable deja pasar filas sin paciente", () => {
  assert.deepEqual(relatedPatientVisibilityAnd(admin), []);

  const rel = relatedPatientVisibilityAnd(doctorB);
  assert.deepEqual(rel, [{
    OR: [{ patient: { is: patientVisibilityFilter(doctorB) } }],
  }]);

  const nullable = relatedPatientVisibilityAnd(doctorB, { patientNullable: true });
  assert.deepEqual(nullable[0].OR[1], { patientId: null });

  const custom = relatedPatientVisibilityAnd(doctorB, { field: "paciente" });
  assert.ok(custom[0].OR[0].paciente);
});

// ═══ Campana de actividad — GET /api/dashboard/activity (revisión panel.108, F2) ═══
//
// 500 a todo el que no era admin: el filtro de visibilidad de la campana pedía
// `patientNullable`, que agrega `{ patientId: null }`, y en Invoice, Appointment
// y OrthodonticTreatmentPlan `patientId` es OBLIGATORIO → Prisma lanzaba
// «Argument patientId is missing». Los admins reciben [] y no lo veían.
// Aquí se recorre cada filtro por rol y se compara contra el modelo REAL de Prisma
// (`Prisma.dmmf`): ningún campo escalar obligatorio puede compararse con null.
import { Prisma } from "@prisma/client";
import { filtrosDeActividad } from "../dashboard/actividad-filtros";

const ROLES = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"] as const;

/** Campos escalares OBLIGATORIOS de un modelo que el filtro compara con `null`. */
function nulosEnObligatorios(modelo: string, where: unknown, ruta = ""): string[] {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelo);
  assert.ok(m, `el modelo ${modelo} existe en el esquema`);
  const fallos: string[] = [];
  const visitar = (nodo: unknown, en: string) => {
    if (Array.isArray(nodo)) return nodo.forEach((n, i) => visitar(n, `${en}[${i}]`));
    if (!nodo || typeof nodo !== "object") return;
    for (const [k, v] of Object.entries(nodo as Record<string, unknown>)) {
      if (k === "AND" || k === "OR" || k === "NOT") { visitar(v, `${en}.${k}`); continue; }
      const campo = m.fields.find((f) => f.name === k);
      if (campo && campo.kind === "scalar" && campo.isRequired && v === null) fallos.push(`${en}.${k}`);
      if (campo && campo.kind === "object") {
        // Relación: `{ is: filtro }` se evalúa contra el modelo de la relación.
        const rel = (v as { is?: unknown } | null)?.is;
        if (rel) fallos.push(...nulosEnObligatorios(campo.type, rel, `${en}.${k}.is`));
      }
    }
  };
  visitar(where, ruta || modelo);
  return fallos;
}

test("campana: Invoice, Appointment y OrthodonticTreatmentPlan tienen patientId OBLIGATORIO (por eso no admiten el filtro de «fila sin paciente»)", () => {
  for (const modelo of ["Invoice", "Appointment", "OrthodonticTreatmentPlan"]) {
    const campo = Prisma.dmmf.datamodel.models.find((x) => x.name === modelo)?.fields.find((f) => f.name === "patientId");
    assert.equal(campo?.isRequired, true, `${modelo}.patientId debería ser obligatorio`);
  }
});

test("campana: el detector de nulos en obligatorios sí caza el filtro viejo (patientNullable)", () => {
  const viejo = relatedPatientVisibilityAnd(doctorA, { patientNullable: true });
  assert.deepEqual(nulosEnObligatorios("Invoice", { AND: viejo }), ["Invoice.AND[0].OR[1].patientId"]);
});

for (const role of ROLES) {
  test(`campana: ${role} — ningún filtro compara un patientId obligatorio con null`, () => {
    const viewer: VisibilityViewer = { userId: `u_${role}`, role, clinicId: CLINIC };
    const f = filtrosDeActividad(viewer);
    assert.deepEqual(nulosEnObligatorios("Invoice", { AND: f.facturas }), []);
    assert.deepEqual(nulosEnObligatorios("Appointment", { AND: f.citas }), []);
    assert.deepEqual(nulosEnObligatorios("OrthodonticTreatmentPlan", { AND: f.casosOrtodoncia }), []);
    assert.deepEqual(nulosEnObligatorios("Patient", { AND: f.pacientes }), []);
  });
}

test("campana: admins (ADMIN y SUPER_ADMIN) sin filtro; el resto filtra por la relación con el paciente en TODAS las tablas", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    const f = filtrosDeActividad({ userId: "a", role, clinicId: CLINIC });
    assert.deepEqual(f, { pacientes: [], facturas: [], citas: [], casosOrtodoncia: [] });
  }
  for (const role of ["DOCTOR", "RECEPTIONIST", "READONLY"] as const) {
    const viewer: VisibilityViewer = { userId: `u_${role}`, role, clinicId: CLINIC };
    const regla = patientVisibilityFilter(viewer);
    const f = filtrosDeActividad(viewer);
    assert.deepEqual(f.pacientes, [regla]);
    assert.deepEqual(f.facturas, [{ patient: { is: regla } }]);
    assert.deepEqual(f.citas, [{ patient: { is: regla } }]);
    assert.deepEqual(f.casosOrtodoncia, [{ patient: { is: regla } }]);
  }
});

test("campana: la ruta usa filtrosDeActividad y ya no pide patientNullable", () => {
  const fuente = readFileSync(join(__dirname, "..", "..", "app", "api", "dashboard", "activity", "route.ts"), "utf8");
  assert.match(fuente, /filtrosDeActividad\(viewer\)/);
  assert.doesNotMatch(fuente, /relatedPatientVisibilityAnd\(viewer, \{ patientNullable/);
  assert.doesNotMatch(fuente, /\.\.\.\(relatedVis/);
});
