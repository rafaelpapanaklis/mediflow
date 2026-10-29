/**
 * Auditoría de seguridad «cloudflare», nº11 — subrutas del paciente que se saltaban el permiso de
 * rol (solo pedían sesión + visibilidad):
 *   · POST health-questionnaire: un READONLY escribía el cuestionario y las alergias/padecimientos/
 *     medicamentos de la ficha → ahora `patients.edit` (recepción, que lo llena, lo tiene);
 *   · GET odontogram-history: recepción y READONLY leían el historial del odontograma → ahora
 *     `puedeLeerOdontograma` (medicalRecord.view), como GET /api/odontogram.
 * (La URL firmada del CBCT lite la fija estudios-permisos.test.ts.)
 *
 * Run: npm run test:seg-archivos-permisos
 *
 * Los handlers REALES con dobles por `Module._load`. `assertPatientVisible` —lo primero que corre
 * DESPUÉS del permiso— es un centinela 499: 403 = el permiso cortó; 499 = dejó pasar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest } from "next/server";

const CENTINELA = 499;
let ctx: any = null;
const escrituras: string[] = [];
const quien = (role: string, permissionsOverride: string[] | null = null) => {
  const user = { id: "u1", role, clinicId: "cA", permissionsOverride };
  return { userId: "u1", clinicId: "cA", role, permissionsOverride, user };
};

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/auth-context": { getAuthContext: async () => ctx },
  "@/lib/patient-visibility": {
    assertPatientVisible: async () => new Response(JSON.stringify({ centinela: true }), { status: CENTINELA }),
  },
  "@/lib/audit": { logMutation: async () => undefined, logAudit: async () => undefined, extractAuditMeta: () => ({}) },
  "@/lib/prisma": {
    prisma: new Proxy({}, {
      get: (_t, modelo) => new Proxy({}, {
        get: (_m, op) => async () => { escrituras.push(`${String(modelo)}.${String(op)}`); return null; },
      }),
    }),
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function cuestionario(metodo: "GET" | "POST") {
  const mod: any = await import("@/app/api/patients/[id]/health-questionnaire/route");
  const req = new NextRequest("http://x/api/patients/pA/health-questionnaire", {
    method: metodo,
    ...(metodo === "POST" ? { body: JSON.stringify({ answers: { alergias: "penicilina" } }), headers: { "content-type": "application/json" } } : {}),
  });
  return (await mod[metodo](req, { params: Promise.resolve({ id: "pA" }) })).status;
}
async function historial() {
  const { GET } = await import("@/app/api/patients/[id]/odontogram-history/route");
  return (await GET(new NextRequest("http://x/api/patients/pA/odontogram-history"), { params: Promise.resolve({ id: "pA" }) })).status;
}

test("nº11: POST del cuestionario de salud — READONLY no escribe; recepción, doctor y admin sí", async () => {
  escrituras.length = 0;
  ctx = quien("READONLY");
  assert.equal(await cuestionario("POST"), 403);
  assert.deepEqual(escrituras, [], "ni una consulta a la base");
  for (const rol of ["RECEPTIONIST", "DOCTOR", "ADMIN", "SUPER_ADMIN"]) {
    ctx = quien(rol);
    assert.equal(await cuestionario("POST"), CENTINELA, rol);
  }
  // el override manda: un doctor sin patients.edit no escribe
  ctx = quien("DOCTOR", ["patients.view", "medicalRecord.view"]);
  assert.equal(await cuestionario("POST"), 403);
});

test("nº11/12: GET del cuestionario — pide patients.view (todos los roles de fábrica lo tienen)", async () => {
  for (const rol of ["READONLY", "RECEPTIONIST", "DOCTOR", "ADMIN"]) {
    ctx = quien(rol);
    assert.equal(await cuestionario("GET"), CENTINELA, rol);
  }
  ctx = quien("DOCTOR", ["agenda.view"]);
  assert.equal(await cuestionario("GET"), 403, "a quien el dueño se lo quitó, no");
});

test("nº11: historial del odontograma — recepción y READONLY no lo leen; doctor y admin sí", async () => {
  for (const rol of ["RECEPTIONIST", "READONLY"]) {
    ctx = quien(rol);
    assert.equal(await historial(), 403, rol);
  }
  for (const rol of ["DOCTOR", "ADMIN", "SUPER_ADMIN"]) {
    ctx = quien(rol);
    assert.equal(await historial(), CENTINELA, rol);
  }
  ctx = quien("DOCTOR", ["patients.view"]);
  assert.equal(await historial(), 403, "sin medicalRecord.view, no");
});

test("nº11: sin sesión, 401 (antes que el permiso)", async () => {
  ctx = null;
  assert.equal(await cuestionario("POST"), 401);
  assert.equal(await historial(), 401);
});
