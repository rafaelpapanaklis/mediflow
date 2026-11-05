/**
 * Búsqueda global (Ctrl+K) con una cita «Sin doctor» (ws1-t11 · fase 2 · P2, PLAN §1.4).
 *
 * Run: node_modules/.bin/tsx --test src/app/api/dashboard/search/__tests__/search-sin-doctor.test.ts
 *
 * HANDLER REAL de `GET /api/dashboard/search` con dobles por Module._load (el arnés de
 * paleta-y-ficha-permisos.test.ts). La ruta armaba `doctorName` con `a.doctor.firstName`: una cita
 * «Sin doctor» entre los resultados tumbaba la búsqueda entera (TypeError → 500). Ahora sale
 * «Sin doctor». Con el código de f4d8fe31d falla.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest } from "next/server";

const CLINICA = "cmclinic0000qa00000000001";
const respuestas: Record<string, unknown> = {
  "patient.findMany": [],
  "appointment.findMany": [
    { id: "dentalink-appt-88231", startsAt: new Date("2026-11-04T16:00:00Z"), status: "SCHEDULED", patient: { firstName: "Ana", lastName: "Pérez" }, doctor: null },
    { id: "cmabc123xyz0000def456ghi", startsAt: new Date("2026-11-03T16:00:00Z"), status: "COMPLETED", patient: { firstName: "Ana", lastName: "Pérez" }, doctor: { firstName: "Renata", lastName: "Ruiz" } },
  ],
  "invoice.findMany": [],
  "clinic.findUnique": { timezone: "America/Mexico_City" },
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/headers": { cookies: async () => ({ get: () => undefined }) },
  "@/lib/rate-limit": { rateLimit: () => null },
  "@/lib/orthodontics/access": { hasActiveOrthodonticsModule: async () => false },
  "@/lib/patients/patient-search": { findPatientIdsBySearch: async () => [] },
  "@/lib/auth-context": {
    getAuthContext: async () => ({
      userId: "seed-recepcion-1", clinicId: CLINICA, role: "RECEPTIONIST", permissionsOverride: null,
      isAdmin: false, isDoctor: false, clinicCategory: "DENTAL", isPlanExpired: false,
    }),
  },
  "@/lib/prisma": {
    prisma: new Proxy({}, {
      get: (_t, modelo) => new Proxy({}, {
        get: (_m, op) => async (a: any) => {
          if (a?.where && "clinicId" in a.where) assert.equal(a.where.clinicId, CLINICA);
          return structuredClone(respuestas[`${String(modelo)}.${String(op)}`] ?? null);
        },
      }),
    }),
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

test("una cita «Sin doctor» sale en la búsqueda con «Sin doctor» (antes tumbaba la búsqueda)", async () => {
  const { GET } = await import("@/app/api/dashboard/search/route");
  const res = await GET(new NextRequest("http://x/api/dashboard/search?q=ana"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.appointments.map((a: any) => [a.id, a.doctorName]), [
    ["dentalink-appt-88231", "Sin doctor"],
    ["cmabc123xyz0000def456ghi", "Renata Ruiz"],
  ]);
});
