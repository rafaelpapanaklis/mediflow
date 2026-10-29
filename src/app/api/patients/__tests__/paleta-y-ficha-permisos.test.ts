/**
 * Auditoría de seguridad «cloudflare», nº12 (B7) — dos lecturas que se saltaban el permiso de rol:
 *   · la paleta de búsqueda (`GET /api/dashboard/search`) devolvía pacientes, citas y facturas a
 *     quien el dueño le había quitado «Ver pacientes», «Ver agenda» o «Ver cobros»;
 *   · la ficha (`GET /api/patients/[id]`) se servía sin `patients.view` y con las facturas y pagos
 *     aunque no hubiera `billing.view` (la ficha SSR ya las escondía).
 * Con los permisos de fábrica nada cambia: todos los roles tienen esas tres llaves.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 * Los handlers REALES con dobles por `Module._load`; Prisma es un Proxy que apunta qué modelo se lee.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest } from "next/server";

let ctx: any = null;
const lecturas: string[] = [];
const quien = (role: string, permissionsOverride: string[] | null = null) => ({
  userId: "u1", clinicId: "cA", role, permissionsOverride, isAdmin: role === "ADMIN" || role === "SUPER_ADMIN",
  isDoctor: role === "DOCTOR", clinicCategory: "DENTAL", isPlanExpired: false,
});

const FICHA = {
  id: "pA", clinicId: "cA", firstName: "Ana", lastName: "Pérez",
  appointments: [], records: [{ id: "r1" }], invoices: [{ id: "i1", total: 500, payments: [{ id: "pg1" }] }],
};
const respuestas: Record<string, unknown> = {
  "patient.findFirst": FICHA,
  "patient.findMany": [{ id: "pA", firstName: "Ana", lastName: "Pérez", patientNumber: "MF-0001", phone: "" }],
  "appointment.findMany": [{ id: "a1", startsAt: new Date("2026-10-28T15:00:00Z"), status: "SCHEDULED", patient: { firstName: "Ana", lastName: "Pérez" }, doctor: { firstName: "D", lastName: "R" } }],
  "invoice.findMany": [{ id: "i1", invoiceNumber: "MF-0072", total: 500, status: "PAID", createdAt: new Date(), patient: { firstName: "Ana", lastName: "Pérez" } }],
  "clinic.findUnique": { timezone: "America/Mexico_City" },
};

const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/headers": { cookies: async () => ({ get: () => undefined }) },
  "@/lib/rate-limit": { rateLimit: () => null },
  "@/lib/orthodontics/access": { hasActiveOrthodonticsModule: async () => false },
  "@/lib/patients/patient-search": {
    findPatientIdsBySearch: async () => { lecturas.push("findPatientIdsBySearch"); return ["pA"]; },
  },
  "@/lib/auth-context": {
    getAuthContext: async () => ctx,
    buildPatientWhere: (c: any, extra: any, ids?: string[]) => ({ clinicId: { in: ids ?? [c.clinicId] }, ...extra }),
  },
  "@/lib/branches": {
    getPatientVisibility: async (clinicId: string) => ({ clinicIds: [clinicId], shared: false, otherClinicNames: {} }),
    sharedRecordScope: (clinicId: string) => ({ clinicId }),
    ownPrivateRecordsOnly: () => ({}),
  },
  "@/lib/prisma": {
    prisma: new Proxy({}, {
      get: (_t, modelo) => new Proxy({}, {
        get: (_m, op) => async () => {
          const k = `${String(modelo)}.${String(op)}`;
          lecturas.push(k);
          return structuredClone(respuestas[k] ?? null);
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

beforeEach(() => { lecturas.length = 0; });

async function buscar(q = "ana") {
  const { GET } = await import("@/app/api/dashboard/search/route");
  const res = await GET(new NextRequest(`http://x/api/dashboard/search?q=${encodeURIComponent(q)}`));
  return { status: res.status, body: await res.json() };
}
async function ficha() {
  const { GET } = await import("@/app/api/patients/[id]/route");
  const res = await GET(new NextRequest("http://x/api/patients/pA"), { params: Promise.resolve({ id: "pA" }) });
  return { status: res.status, body: await res.json() };
}

test("nº12: paleta — con los permisos de fábrica, las tres secciones como siempre", async () => {
  for (const rol of ["READONLY", "RECEPTIONIST", "DOCTOR", "ADMIN"]) {
    ctx = quien(rol);
    const { status, body } = await buscar();
    assert.equal(status, 200);
    assert.equal(body.patients.length, 1, rol);
    assert.equal(body.appointments.length, 1, rol);
    assert.equal(body.invoices.length, 1, rol);
  }
});

test("nº12: paleta — sin «Ver cobros» no salen facturas ni se consultan (folio incluido)", async () => {
  ctx = quien("RECEPTIONIST", ["patients.view", "agenda.view"]);
  const { body } = await buscar("72");
  assert.deepEqual(body.invoices, []);
  assert.equal(body.patients.length, 1);
  assert.equal(body.appointments.length, 1);
  assert.ok(!lecturas.includes("invoice.findMany"), "la base de facturas ni se tocó");
});

test("nº12: paleta — sin «Ver pacientes» ni «Ver agenda», esas secciones vacías y sin consulta", async () => {
  ctx = quien("DOCTOR", ["billing.view"]);
  const { body } = await buscar();
  assert.deepEqual(body.patients, []);
  assert.deepEqual(body.appointments, []);
  assert.equal(body.invoices.length, 1);
  for (const k of ["findPatientIdsBySearch", "patient.findMany", "appointment.findMany"]) {
    assert.ok(!lecturas.includes(k), `${k} no debía correr`);
  }
});

test("nº12: ficha — sin «Ver pacientes» → 403 sin leer la base", async () => {
  ctx = quien("DOCTOR", ["agenda.view"]);
  const { status } = await ficha();
  assert.equal(status, 403);
  assert.ok(!lecturas.includes("patient.findFirst"));
});

test("nº12: ficha — sin «Ver cobros» las facturas y sus pagos no viajan; con él, sí", async () => {
  ctx = quien("DOCTOR", ["patients.view", "medicalRecord.view"]);
  const sin = await ficha();
  assert.equal(sin.status, 200);
  assert.deepEqual(sin.body.invoices, []);
  assert.equal(sin.body.records.length, 1, "el expediente sigue según su propio permiso");

  for (const rol of ["RECEPTIONIST", "DOCTOR", "ADMIN"]) {
    ctx = quien(rol);
    const con = await ficha();
    assert.equal(con.status, 200, rol);
    assert.equal(con.body.invoices.length, 1, rol);
  }
});
