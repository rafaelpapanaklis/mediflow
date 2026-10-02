/**
 * CONVERTIR EL PLAN EN PRESUPUESTO — los handlers (ws1-t3, punto 7e del ticket 3).
 *
 * Run: npm run test:presupuesto-desde-plan
 *
 * GET /api/treatments/[id]/presupuesto da la vista previa sin escribir; POST crea el BORRADOR enlazado al
 * plan, sin duplicar si ya hay uno vivo. Ejercita los handlers REALES con `mock.module` sobre prisma,
 * sesión y auditoría (de ahí `--experimental-test-module-mocks`).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { componerDescripcion, PLAN_VACIO } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";

type Row = Record<string, any>;
const db = { plans: [] as Row[], quotes: [] as Row[], catalogo: [] as Row[], audit: [] as Row[], seq: 0 };
const ocultos = new Set<string>();
const authCtx: Row = { clinicId: "c1", userId: "u1", role: "ADMIN", isDoctor: false, permissionsOverride: null };

const copia = <T>(x: T): T => structuredClone(x);
const coincide = (fila: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true; // Prisma descarta las claves undefined
    if (v && typeof v === "object" && "in" in v) return (v.in as unknown[]).includes(fila[k]);
    return fila[k] === v;
  });

const prismaStub: any = {
  treatmentPlan: { findFirst: async ({ where }: any) => { const p = db.plans.find((x) => coincide(x, where)); return p ? copia(p) : null; } },
  procedureCatalog: { findMany: async ({ where }: any) => db.catalogo.filter((x) => coincide(x, where)).map(copia) },
  $queryRaw: async () => [{ max: db.quotes.filter((q) => q.clinicId === "c1").length ? db.quotes.length : null }],
  quote: {
    findFirst: async ({ where }: any) => {
      const hits = db.quotes.filter((x) => coincide(x, where)).sort((a, b) => b.createdAt - a.createdAt);
      return hits[0] ? copia(hits[0]) : null;
    },
    create: async ({ data }: any) => {
      const { items, ...resto } = data;
      const fila: Row = {
        id: `q${++db.seq}`, status: "DRAFT", treatmentPlanId: null, createdAt: new Date(db.seq * 1000), ...resto,
        items: items.create, createdBy: null, patient: { firstName: "Ana", lastName: "López" },
      };
      db.quotes.push(fila);
      return copia(fila);
    },
  },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("@/lib/audit", { namedExports: { logAudit: async (a: Row) => { db.audit.push(a); }, logMutation: async () => {} } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    assertPatientVisible: async (id: string) => (ocultos.has(id) ? NextResponse.json({ error: "patient_not_found" }, { status: 404 }) : null),
  },
});

const rot = {
  diagnostico: "Diagnóstico", pronostico: "Pronóstico", total: "Total", alternativa: "Alternativa", notas: "Notas", por: "por",
  fase: () => "Fase I · Higiénica", pronosticoValor: () => "Bueno", dinero: (n: number) => `$${n.toLocaleString("en-US")}`,
};
const reng = (procedimiento: string, extra: Row = {}) => ({
  id: procedimiento, fase: "higienica" as const, procedimiento, procedimientoId: null, dientes: "", caras: [], motivo: "",
  cantidad: "", precio: "", precioDelTarifario: false, minutos: 0, ...extra,
});
const DESCRIPCION = componerDescripcion(
  { ...PLAN_VACIO, renglones: [reng("Resina", { dientes: "16", precio: "500", cantidad: "2" }), reng("Limpieza dental", { precio: "800" })] },
  rot,
);

beforeEach(() => {
  db.plans = [
    { id: "plan1", clinicId: "c1", patientId: "p1", doctorId: "u1", name: "Rehabilitación", description: DESCRIPCION, totalCost: 1800 },
    { id: "plan-de-otro-doctor", clinicId: "c1", patientId: "p1", doctorId: "doc-2", name: "Otro", description: DESCRIPCION, totalCost: 1800 },
    { id: "plan-c2", clinicId: "c2", patientId: "p9", doctorId: "x", name: "Ajeno", description: DESCRIPCION, totalCost: 1800 },
  ];
  db.quotes = [];
  db.catalogo = [{ id: "pr-resina", clinicId: "c1", name: "Resina", basePrice: 500, isActive: true }, { id: "pr-c2", clinicId: "c2", name: "Limpieza dental", basePrice: 1, isActive: true }];
  db.audit = [];
  db.seq = 0;
  ocultos.clear();
  Object.assign(authCtx, { clinicId: "c1", userId: "u1", role: "ADMIN", isDoctor: false, permissionsOverride: null });
});

// Import perezoso: los mocks de arriba tienen que estar puestos antes de cargar el handler.
const GET = async (req: any, p: any) => (await import("@/app/api/treatments/[id]/presupuesto/route")).GET(req, p);
const POST = async (req: any, p: any) => (await import("@/app/api/treatments/[id]/presupuesto/route")).POST(req, p);
const params = (id: string) => ({ params: { id } });
const leer = async (res: any) => ({ status: res.status as number, body: await res.json() });

test("GET: la vista previa trae los conceptos del plan con su precio y no escribe nada", async () => {
  const { status, body } = await leer(await GET({} as any, params("plan1")));
  assert.equal(status, 200);
  assert.equal(body.existente, null);
  assert.deepEqual(body.conceptos.map((c: Row) => [c.name, c.toothFdi, c.quantity, c.unitPrice]), [["Resina", "16", 2, 500], ["Limpieza dental", null, 1, 800]]);
  assert.equal(body.total, 1800);
  assert.equal(db.quotes.length, 0);
});

test("POST: crea UN borrador enlazado al plan, con sus conceptos y su bitácora", async () => {
  const { status, body } = await leer(await POST({} as any, params("plan1")));
  assert.equal(status, 201);
  assert.equal(body.already, false);
  assert.equal(db.quotes.length, 1);
  const q = db.quotes[0];
  assert.equal(q.status, "DRAFT");
  assert.equal(q.treatmentPlanId, "plan1");
  assert.equal(q.clinicId, "c1");
  assert.equal(q.patientId, "p1");
  assert.equal(Number(q.total), 1800);
  assert.equal(q.items.length, 2);
  assert.equal(q.items[0].procedureId, "pr-resina"); // del tarifario de LA clínica
  assert.equal(q.items[1].procedureId, null); // «Limpieza dental» solo está en el tarifario de otra clínica
  assert.equal(db.audit.length, 1);
  assert.equal(db.audit[0].entityType, "quote");
});

test("POST dos veces: no duplica, devuelve el mismo presupuesto con already:true", async () => {
  await POST({} as any, params("plan1"));
  const { status, body } = await leer(await POST({} as any, params("plan1")));
  assert.equal(status, 200);
  assert.equal(body.already, true);
  assert.equal(db.quotes.length, 1);
  assert.equal(body.quote.id, db.quotes[0].id);
});

test("GET con un presupuesto vivo: lo ofrece para abrirlo", async () => {
  await POST({} as any, params("plan1"));
  const { body } = await leer(await GET({} as any, params("plan1")));
  assert.equal(body.existente.folio, db.quotes[0].folio);
});

test("un presupuesto rechazado o vencido del plan no bloquea: se puede crear otro", async () => {
  await POST({} as any, params("plan1"));
  db.quotes[0].status = "REJECTED";
  const { status, body } = await leer(await POST({} as any, params("plan1")));
  assert.equal(status, 201);
  assert.equal(body.already, false);
  assert.equal(db.quotes.length, 2);
});

test("aislamiento: el plan de otra clínica es 404 (y no se crea nada)", async () => {
  assert.equal((await leer(await GET({} as any, params("plan-c2")))).status, 404);
  assert.equal((await leer(await POST({} as any, params("plan-c2")))).status, 404);
  assert.equal(db.quotes.length, 0);
});

test("un doctor solo convierte sus planes", async () => {
  Object.assign(authCtx, { role: "DOCTOR", isDoctor: true });
  assert.equal((await leer(await POST({} as any, params("plan-de-otro-doctor")))).status, 404);
  assert.equal((await leer(await POST({} as any, params("plan1")))).status, 201);
});

test("permisos: solo lectura recibe 403; un paciente oculto es 404", async () => {
  Object.assign(authCtx, { role: "READONLY" });
  assert.equal((await leer(await POST({} as any, params("plan1")))).status, 403);
  assert.equal((await leer(await GET({} as any, params("plan1")))).status, 403);
  Object.assign(authCtx, { role: "ADMIN" });
  ocultos.add("p1");
  assert.equal((await leer(await POST({} as any, params("plan1")))).status, 404);
  assert.equal(db.quotes.length, 0);
});
