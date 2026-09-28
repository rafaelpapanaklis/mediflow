/**
 * Ortodoncia — Parte 7/8 «Imagen y análisis» (ws1-t8). Revisión cruzada de
 * ws1-t1: `getOrthoImagingContext` verificaba clínica pero NO visibilidad de
 * paciente. Este test cubre el caso que fallaba antes del arreglo: un doctor
 * SIN acceso a un paciente privado (`visibleUserIds` no lo incluye) ya no
 * puede leer/escribir su cefalometría/alineadores/elásticos/monitoreo.
 *
 * Necesita --experimental-test-module-mocks (mock.module sustituye
 * "@/lib/prisma" y "../_helpers"). El módulo bajo prueba se importa DESPUÉS
 * de declarar los mocks. `canSeePatient` NO se mockea — corre real, para
 * probar la integración de verdad, no solo que se llamó.
 *
 * Run: npm run test:orto-imagen-context
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

interface PlanRow {
  id: string;
  clinicId: string;
  patientId: string;
  deletedAt: Date | null;
  visibleUserIds: string[] | null;
}

let plans: PlanRow[] = [];
let authResult: { ok: true; data: { ctx: { userId: string; role: string; clinicId: string } } } | { ok: false; error: string };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const p = plans.find((row) => row.id === where.id);
          if (!p) return null;
          return {
            id: p.id,
            clinicId: p.clinicId,
            patientId: p.patientId,
            deletedAt: p.deletedAt,
            patient: { visibleUserIds: p.visibleUserIds },
          };
        },
      },
    },
  },
});

mock.module("../../_helpers", {
  namedExports: {
    getOrthoActionContext: async () => authResult,
  },
});

function reset() {
  plans = [];
  authResult = { ok: true, data: { ctx: { userId: "doctor-sin-acceso", role: "DOCTOR", clinicId: "clinic-1" } } };
}

test("doctor SIN acceso (excluido de visibleUserIds) no puede leer un caso de paciente privado", async () => {
  reset();
  plans.push({
    id: "plan-1",
    clinicId: "clinic-1",
    patientId: "patient-privado",
    deletedAt: null,
    visibleUserIds: ["doctor-con-acceso"], // "doctor-sin-acceso" NO está en la lista
  });
  const { getOrthoImagingContext } = await import("../_context");
  const res = await getOrthoImagingContext("plan-1");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, "Caso de ortodoncia no encontrado");
});

test("doctor CON acceso (sí está en visibleUserIds) puede leer el mismo caso", async () => {
  reset();
  plans.push({
    id: "plan-2",
    clinicId: "clinic-1",
    patientId: "patient-privado",
    deletedAt: null,
    visibleUserIds: ["doctor-sin-acceso"], // ahora sí lo incluye
  });
  const { getOrthoImagingContext } = await import("../_context");
  const res = await getOrthoImagingContext("plan-2");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.patientId, "patient-privado");
});

test("paciente sin restricción (visibleUserIds vacío) es visible para cualquiera — default histórico", async () => {
  reset();
  plans.push({
    id: "plan-3",
    clinicId: "clinic-1",
    patientId: "patient-abierto",
    deletedAt: null,
    visibleUserIds: [],
  });
  const { getOrthoImagingContext } = await import("../_context");
  const res = await getOrthoImagingContext("plan-3");
  assert.equal(res.ok, true);
});

test("clinicId de otra clínica sigue rechazado (regresión: no romper el chequeo de tenant ya existente)", async () => {
  reset();
  plans.push({
    id: "plan-4",
    clinicId: "clinic-OTRA",
    patientId: "patient-x",
    deletedAt: null,
    visibleUserIds: [],
  });
  const { getOrthoImagingContext } = await import("../_context");
  const res = await getOrthoImagingContext("plan-4");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, "Sin acceso a este caso");
});
