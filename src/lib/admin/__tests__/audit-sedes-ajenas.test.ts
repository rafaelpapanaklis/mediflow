/**
 * ws1-t4 v8 (M-1 de t8 sobre v7) — la bitácora no nombra sedes a las que quien mira no tiene acceso.
 *
 * Run: npm run test:sede-clave
 *
 * Las filas VIEJAS no se tocan en la base: se tapan al leer, en Auditoría (`GET /api/auditoria`) y en
 * `GET /api/audit-log`, que además pasa a ser solo de dueño y admin (salvo la bitácora de un paciente,
 * que sigue con su propia regla de visibilidad). Handlers reales con dobles por `Module._load`. ⛔ Sin base.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
// Solo el tipo: el módulo se carga con import() DESPUÉS de instalar los dobles (un import
// estático sube por encima de `Mod._load` y traería el Prisma de verdad).
import type { SedeAjena } from "../audit-sedes-ajenas";

const OTRA_SEDE = "otra sede";

// El caso del QA: el dueño está en A, B y D («QA Sede 3 aislada»); el admin, solo en A y B.
const A = "c-prueba-qa", B = "c-ws1-t10-copia", D = "c-sede-3-aislada", X = "c-otro-cliente";
const CLINICAS: Record<string, { id: string; name: string; slug: string }> = {
  [A]: { id: A, name: "Clínica de Prueba QA", slug: "clinica-de-prueba-qa" },
  [B]: { id: B, name: "QA Sede ws1-t10 copia", slug: "qa-sede-ws1-t10-copia" },
  [D]: { id: D, name: "QA Sede 3 aislada", slug: "qa-sede-3-aislada" },
  [X]: { id: X, name: "Clínica ajena", slug: "clinica-ajena" },
};
const SB_DUENO = "sb-dueno", SB_ADMIN = "sb-admin", SB_RECE = "sb-rece";
interface Ficha { supabaseId: string; clinicId: string; role: string; isActive: boolean }
const FICHAS: Ficha[] = [
  { supabaseId: SB_DUENO, clinicId: A, role: "SUPER_ADMIN", isActive: true },
  { supabaseId: SB_DUENO, clinicId: B, role: "SUPER_ADMIN", isActive: true },
  { supabaseId: SB_DUENO, clinicId: D, role: "SUPER_ADMIN", isActive: true },
  { supabaseId: SB_ADMIN, clinicId: A, role: "ADMIN", isActive: true },
  { supabaseId: SB_ADMIN, clinicId: B, role: "ADMIN", isActive: true },
  { supabaseId: SB_RECE, clinicId: A, role: "RECEPTIONIST", isActive: true },
  { supabaseId: "sb-otro", clinicId: X, role: "SUPER_ADMIN", isActive: true },
];

function cumple(f: any, where: any): boolean {
  return Object.keys(where).every((k) => {
    const c = where[k];
    if (c && typeof c === "object") {
      if ("in" in c) return c.in.includes(f[k]);
      if ("not" in c) return f[k] !== c.not;
    }
    return f[k] === c;
  });
}

// Las filas VIEJAS tal como quedaron en la sede A (antes de v7/v8).
const FILAS_VIEJAS = [
  {
    id: "log-alta-sede", clinicId: A, entityType: "clinic", entityId: D, action: "create",
    changes: { _created: { before: null, after: { name: "QA Sede 3 aislada", slug: "qa-sede-3-aislada", plan: "CLINIC", branchOf: A, copiadoDe: A } } },
  },
  {
    id: "log-alta-correo", clinicId: A, entityType: "user", entityId: "u-dr", action: "create",
    changes: { _created: { before: null, after: { email: "dr@x.com", sedeAdicional: true, tambienEn: ["QA Sede ws1-t10 copia", "QA Sede 3 aislada"] } } },
  },
  {
    id: "log-vinculo", clinicId: A, entityType: "clinic", entityId: "link-1", action: "create",
    changes: { _created: { before: null, after: { patientLink: true, clinicAId: A, clinicBId: D } } },
  },
];

const estado = { quien: SB_ADMIN as string | undefined, rol: "ADMIN", pacienteVisible: true, consultas: [] as string[] };
beforeEach(() => {
  estado.quien = SB_ADMIN; estado.rol = "ADMIN"; estado.pacienteVisible = true; estado.consultas = [];
});

const prismaStub: any = {
  user: {
    findMany: async ({ where, select }: any) => {
      const filas = FICHAS.filter((f) => cumple(f, where));
      return select?.clinic ? filas.map((f) => ({ clinic: CLINICAS[f.clinicId] })) : filas;
    },
  },
  auditLog: {
    findMany: async ({ where }: any) => {
      estado.consultas.push(`${where.entityType}:${where.entityId}`);
      return FILAS_VIEJAS.filter((r) => r.clinicId === where.clinicId && r.entityType === where.entityType && r.entityId === where.entityId);
    },
  },
};

const ctx = () => ({
  userId: "u-quien", clinicId: A, role: estado.rol, isAdmin: estado.rol !== "RECEPTIONIST" && estado.rol !== "DOCTOR",
  user: { supabaseId: estado.quien },
});

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaStub },
  "@/lib/auth-context": { getAuthContext: async () => ctx() },
  "@/lib/patient-visibility": {
    assertPatientVisible: async () => (estado.pacienteVisible ? null : new Response(null, { status: 404 })),
  },
  // Auditoría: la consulta en sí (filtros, paginado) ya la prueban audit-core; aquí, lo que devuelve.
  "@/lib/admin/audit": {
    queryAuditLogs: async (f: { clinicId: string }) => {
      const rows = FILAS_VIEJAS.filter((r) => r.clinicId === f.clinicId).map((r) => ({ ...r, clinicName: CLINICAS[r.clinicId].name }));
      return { rows, total: rows.length, page: 1, pageSize: 50 };
    },
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function auditoria() {
  const { GET } = await import("@/app/api/auditoria/route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest("http://app.test/api/auditoria"));
  return { status: res.status, body: await res.json() };
}
async function auditLog(entityType: string, entityId: string) {
  const { GET } = await import("@/app/api/audit-log/route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest(`http://app.test/api/audit-log?entityType=${entityType}&entityId=${entityId}`));
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

test("v8 núcleo: id, slug y nombre de una sede ajena salen como «otra sede», también dentro de un texto", async () => {
  const m = await import("../audit-sedes-ajenas");
  assert.equal(m.OTRA_SEDE, OTRA_SEDE);
  const { taparSedesAjenas } = m;
  const ajenas: SedeAjena[] = [{ id: D, name: "QA Sede 3 aislada", slug: "qa-sede-3-aislada" }];
  const fila = {
    after: { name: "QA Sede 3 aislada", slug: "qa-sede-3-aislada", copiadoDe: D, branchOf: A, plan: "CLINIC" },
    tambienEn: ["QA Sede ws1-t10 copia", "QA Sede 3 aislada"],
    texto: "Se creó la sede QA Sede 3 aislada",
    n: 3, nada: null,
  };
  assert.deepEqual(taparSedesAjenas(fila, ajenas), {
    after: { name: OTRA_SEDE, slug: OTRA_SEDE, copiadoDe: OTRA_SEDE, branchOf: A, plan: "CLINIC" },
    tambienEn: ["QA Sede ws1-t10 copia", OTRA_SEDE],
    texto: `Se creó la sede ${OTRA_SEDE}`,
    n: 3, nada: null,
  });
  assert.equal(taparSedesAjenas(fila, []), fila, "sin ajenas no se copia nada");
});

test("v8: sedesAjenasPara — el admin no tiene D; el dueño no tiene ninguna ajena; sin sesión, todas", async () => {
  const { sedesAjenasPara } = await import("../audit-sedes-ajenas");
  assert.deepEqual((await sedesAjenasPara(A, SB_ADMIN)).map((s) => s.id), [D]);
  assert.deepEqual(await sedesAjenasPara(A, SB_DUENO), []);
  assert.deepEqual((await sedesAjenasPara(A, undefined)).map((s) => s.id).sort(), [B, D].sort());
  assert.ok(!(await sedesAjenasPara(A, SB_ADMIN)).some((s) => s.id === X), "la clínica de otro cliente no entra ni para taparla");
});

test("🔴 v8: en Auditoría, el ADMIN no lee en filas viejas el nombre, slug ni id de la sede a la que no tiene acceso", async () => {
  const r = await auditoria();
  assert.equal(r.status, 200);
  const texto = JSON.stringify(r.body);
  for (const fuga of ["QA Sede 3 aislada", "qa-sede-3-aislada", D]) assert.ok(!texto.includes(fuga), fuga);
  const alta = r.body.rows.find((x: any) => x.id === "log-alta-sede");
  assert.equal(alta.entityId, OTRA_SEDE);
  assert.equal(alta.changes._created.after.name, OTRA_SEDE);
  assert.equal(alta.changes._created.after.plan, "CLINIC");
  const correo = r.body.rows.find((x: any) => x.id === "log-alta-correo");
  assert.deepEqual(correo.changes._created.after.tambienEn, ["QA Sede ws1-t10 copia", OTRA_SEDE], "la que sí ve se sigue nombrando");
  assert.equal(r.body.rows.find((x: any) => x.id === "log-vinculo").changes._created.after.clinicBId, OTRA_SEDE);
});

test("v8: el dueño ve las mismas filas completas en Auditoría", async () => {
  estado.rol = "SUPER_ADMIN"; estado.quien = SB_DUENO;
  const r = await auditoria();
  assert.equal(r.body.rows.find((x: any) => x.id === "log-alta-sede").changes._created.after.name, "QA Sede 3 aislada");
  assert.ok(JSON.stringify(r.body).includes(D));
});

test("🔴 v8: /api/audit-log solo es de quien ve Auditoría: recepción no lee la bitácora de un miembro ni de la clínica", async () => {
  estado.rol = "RECEPTIONIST"; estado.quien = SB_RECE;
  assert.equal((await auditLog("user", "u-dr")).status, 403);
  assert.equal((await auditLog("clinic", D)).status, 403);
  estado.rol = "DOCTOR";
  assert.equal((await auditLog("clinic", "link-1")).status, 403);
  assert.deepEqual(estado.consultas, [], "se corta antes de consultar");
});

test("v8: la bitácora de un paciente sigue con su regla (la tarjeta del historial la ve quien ve al paciente)", async () => {
  estado.rol = "RECEPTIONIST"; estado.quien = SB_RECE;
  assert.equal((await auditLog("patient", "p-1")).status, 200);
  estado.pacienteVisible = false;
  assert.equal((await auditLog("patient", "p-1")).status, 404);
});

test("🔴 v8: /api/audit-log también tapa la sede ajena para el ADMIN, y no para el dueño", async () => {
  const r = await auditLog("clinic", D);
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].entityId, OTRA_SEDE);
  assert.ok(!JSON.stringify(r.body).includes("QA Sede 3 aislada"));
  estado.rol = "SUPER_ADMIN"; estado.quien = SB_DUENO;
  assert.equal((await auditLog("clinic", D)).body[0].changes._created.after.name, "QA Sede 3 aislada");
});
