/**
 * Auditoría de seguridad «cloudflare»:
 *   · nº10 — `GET /api/patients/[id]/export-cda` metía en el XML las notas PRIVADAS de otros doctores
 *     (la ficha y el PDF del expediente ya las dejaban fuera con `ownPrivateRecordsOnly`);
 *   · nº16 — `PATCH /api/consult/ai-assist` dejaba a cualquiera con «Editar expediente» poner o
 *     quitar el análisis IA de la consulta de un colega. Ahora: su autor o un admin.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 * Handlers REALES con dobles por `Module._load`. El doble de Prisma EVALÚA el `where` (igualdades,
 * AND, OR) sobre filas en memoria: lo que sale en el XML es lo que la consulta de verdad dejaría pasar.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest } from "next/server";

type Fila = Record<string, any>;
function casa(fila: Fila, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === "AND") return (v as any[]).every((w) => casa(fila, w));
    if (k === "OR") return (v as any[]).some((w) => casa(fila, w));
    return fila[k] === v;
  });
}

const NOTAS: Fila[] = [
  { id: "r1", patientId: "pA", clinicId: "cA", doctorId: "dYo", isPrivate: false, subjective: "NOTA-COMUN", visitDate: new Date("2026-10-01"), diagnoses_v2: [], specialtyData: {} },
  { id: "r2", patientId: "pA", clinicId: "cA", doctorId: "dOtro", isPrivate: true, subjective: "SECRETO-DEL-OTRO", visitDate: new Date("2026-10-02"), diagnoses_v2: [], specialtyData: {} },
  { id: "r3", patientId: "pA", clinicId: "cA", doctorId: "dYo", isPrivate: true, subjective: "MI-PRIVADA", visitDate: new Date("2026-10-03"), diagnoses_v2: [], specialtyData: {} },
];

let usuario: any = null;
let ctx: any = null;
const updates: any[] = [];

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/auth": { getCurrentUser: async () => usuario },
  "@/lib/auth-context": { getAuthContext: async () => ctx },
  "@/lib/patient-visibility": { assertPatientVisible: async () => null },
  "@/lib/audit": { logRead: async () => undefined, logAudit: async () => undefined, extractAuditMeta: () => ({}) },
  "@/lib/prisma": {
    prisma: {
      patient: { findFirst: async () => ({ id: "pA", firstName: "Ana", lastName: "Pérez", dob: null, gender: "FEMALE", curp: null, passportNo: null, address: null, familyHistory: null, personalNonPathologicalHistory: null, chronicConditions: [], allergies: [], currentMedications: [] }) },
      clinic: { findUnique: async () => ({ id: "cA", name: "Clínica A", clues: null, address: null, phone: null }) },
      prescription: { findMany: async () => [] },
      medicalRecord: {
        findMany: async (a: any) => NOTAS.filter((f) => casa(f, a.where)),
        findFirst: async (a: any) => NOTAS.find((f) => casa(f, a.where)) ?? null,
        update: async (a: any) => { updates.push(a); return {}; },
      },
    },
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

beforeEach(() => { updates.length = 0; });

async function cda(userId: string, role = "DOCTOR") {
  usuario = { id: userId, role, clinicId: "cA", firstName: "Doc", lastName: "Tor", permissionsOverride: null, cedulaProfesional: null, especialidad: null };
  const { GET } = await import("@/app/api/patients/[id]/export-cda/route");
  const res = await GET(new NextRequest("http://x/api/patients/pA/export-cda"), { params: Promise.resolve({ id: "pA" }) });
  assert.equal(res.status, 200);
  return res.text();
}

test("nº10: el CDA no saca la nota privada de OTRO doctor; la propia y las comunes, sí", async () => {
  const xml = await cda("dYo");
  assert.ok(xml.includes("NOTA-COMUN"));
  assert.ok(xml.includes("MI-PRIVADA"), "la privada de quien exporta sigue saliendo");
  assert.ok(!xml.includes("SECRETO-DEL-OTRO"), "la privada ajena no viaja en el XML");
});

test("nº10: tampoco para un admin (misma regla que la ficha y el PDF del expediente)", async () => {
  const xml = await cda("dAdmin", "ADMIN");
  assert.ok(xml.includes("NOTA-COMUN"));
  assert.ok(!xml.includes("SECRETO-DEL-OTRO"));
  assert.ok(!xml.includes("MI-PRIVADA"));
});

async function aplicarIa(userId: string, role: string, recordId = "r1") {
  ctx = { userId, clinicId: "cA", role, permissionsOverride: null };
  const { PATCH } = await import("@/app/api/consult/ai-assist/route");
  const res = await PATCH(new NextRequest("http://x/api/consult/ai-assist", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ recordId, apply: true, result: { hallazgos: "x", puntosAlerta: [], plan: "", resumen: "" } }),
  }));
  return res.status;
}

test("nº16: otro doctor no pone ni quita el análisis IA de una consulta ajena", async () => {
  assert.equal(await aplicarIa("dOtro", "DOCTOR", "r1"), 403);
  assert.deepEqual(updates, [], "la nota no se tocó");
});

test("nº16: el autor y los admins sí (también sobre la nota recién guardada, que nace firmada)", async () => {
  assert.equal(await aplicarIa("dYo", "DOCTOR", "r1"), 200);
  assert.equal(await aplicarIa("dAdmin", "ADMIN", "r1"), 200);
  assert.equal(await aplicarIa("dSuper", "SUPER_ADMIN", "r1"), 200);
  assert.equal(updates.length, 3);
});
