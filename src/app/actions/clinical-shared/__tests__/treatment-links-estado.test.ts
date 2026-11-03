/**
 * ws1-t12 v21 (t5 de la v20, m1): `listOpenTreatmentSessions` (lo usa `TreatmentLinkBadge`) filtraba el estado
 * del plan POR RELACIÓN (`treatment: { status: "ACTIVE" }`). En la base real `treatment_plans.status` es TEXT y
 * Prisma manda el parámetro como enum: 42883. Ahora lo filtra en JS.
 *
 * La base de mentira se porta como la real: si el `where` lleva el estado del plan, lanza el 42883.
 *
 * Run: npx tsx --test src/app/actions/clinical-shared/__tests__/treatment-links-estado.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const pedidos: any[] = [];
const SESIONES = [
  { id: "s1", sessionNumber: 1, treatment: { id: "p-activo", name: "Ortodoncia", status: "ACTIVE", clinicId: "c1", patientId: "pac1" } },
  { id: "s2", sessionNumber: 2, treatment: { id: "p-pausado", name: "Blanqueamiento", status: "PAUSED", clinicId: "c1", patientId: "pac1" } },
  { id: "s3", sessionNumber: 3, treatment: { id: "p-cerrado", name: "Endodoncia", status: "ABANDONED", clinicId: "c1", patientId: "pac1" } },
];
const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/cache": { revalidatePath: () => undefined },
  "@/lib/prisma": {
    prisma: {
      // ws1-t11 · lead 14: listOpenTreatmentSessions mira antes si el paciente
      // está restringido (visibleUserIds). Aquí no lo está.
      patient: { findUnique: async () => ({ visibleUserIds: [] }) },
      treatmentSession: {
        findMany: async (a: any) => {
          pedidos.push(a);
          if (JSON.stringify(a.where?.treatment ?? {}).includes('"status"')) {
            throw Object.assign(new Error('operator does not exist: text = "TreatmentStatus"'), { code: "42883" });
          }
          return SESIONES.filter((s) => s.treatment.clinicId === a.where.treatment.clinicId && s.treatment.patientId === a.where.treatment.patientId);
        },
      },
    },
  },
  "@/lib/auth-context": { getAuthContext: async () => ({ clinicId: "c1", userId: "doc1", role: "DOCTOR", isDoctor: true, permissionsOverride: null }) },
  "@/lib/clinical-shared/auth/guard": { sinPermisoClinico: () => null, auditClinicalShared: async () => undefined },
  "@/lib/clinical-shared/treatment-link/link": { linkSessionToPlan: async () => ({}), findLinksFor: async () => [] },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

test("listOpenTreatmentSessions: sin el estado en el where (columna TEXT en la base real) y solo las sesiones de planes ACTIVOS", async () => {
  const { listOpenTreatmentSessions } = await import("@/app/actions/clinical-shared/treatment-links");
  const r: any = await listOpenTreatmentSessions({ patientId: "pac1" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.map((s: any) => s.treatmentPlanId), ["p-activo"]);
  assert.doesNotMatch(JSON.stringify(pedidos.map((p) => p.where)), /"status"/);
  assert.deepEqual(pedidos[0].where.treatment, { clinicId: "c1", patientId: "pac1" }, "la clínica y el paciente siguen en el where");
});
