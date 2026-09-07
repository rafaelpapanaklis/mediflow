/**
 * NOTA FIRMADA: INALTERABLE, PERO CORREGIBLE — hallazgo 25 (WS1-T5).
 *
 * Run: npm run test:nota-firmada
 *
 * El fallo, en una línea: "Guardar consulta" deja la nota `status: "SIGNED"`, y
 * el PATCH la rechaza con «Las notas firmadas no se pueden editar (NOM-024
 * inalterable)» — correcto—, pero la pantalla seguía pintando el formulario
 * entero, editable y con su botón "Guardar cambios". El doctor veía que había
 * puesto la pieza equivocada, corregía, pulsaba, y toast rojo. Siempre.
 *
 * El arreglo NO es dejar editar. Es (a) que la interfaz deje de prometerlo —eso
 * vive en dental-form.tsx y lo vigila botones-prometidos.test.ts— y (b) darle
 * el camino que la norma sí contempla: una ADENDA, que se añade al lado sin
 * tocar lo firmado. Esta ruta es (b), y con el código de hoy no existe: el
 * `import` de abajo revienta.
 *
 * Lo que se fija aquí:
 *   · el PATCH sigue rechazando toda edición de una nota firmada (candado);
 *   · la adenda NO cambia ni una letra de lo firmado — se compara el antes y el
 *     después campo por campo;
 *   · las adendas se ACUMULAN, no se pisan;
 *   · una nota en borrador no admite adendas (se edita, que para eso lo está);
 *   · no hay forma de editar ni de borrar una adenda ya escrita;
 *   · tenant, visibilidad, permiso y dueño-o-admin, como sus rutas hermanas.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const db: { record: any } = { record: null };

function setRecord(over: Record<string, any> = {}) {
  db.record = {
    id: "r1",
    clinicId: "c1",
    doctorId: "u1",
    patientId: "p1",
    subjective: "Dolor en pieza 26 al masticar.",
    objective: "Caries oclusal.",
    assessment: "Caries profunda pieza 26.",
    plan: "Resina.",
    vitals: { heartRate: "72" },
    isPrivate: false,
    specialtyData: {
      type: "dental",
      status: "SIGNED",
      signedAt: "2026-09-01T10:00:00.000Z",
      odontogram: { 26: { tooth: ["caries"] } },
      procedures: [{ id: "pr1", name: "Resina", price: 900, quantity: 1 }],
      proceduresTotal: 900,
    },
    ...over,
  };
  return db.record;
}

function matches(where: any): boolean {
  if (!db.record) return false;
  if (where?.id && where.id !== db.record.id) return false;
  if (where?.clinicId && where.clinicId !== db.record.clinicId) return false;
  return true;
}

const recordDelegate = {
  findFirst: async ({ where }: any = {}) => (matches(where) ? structuredClone(db.record) : null),
  update: async ({ where, data }: any) => {
    if (!matches(where)) throw new Error("update fuera del where");
    for (const [k, v] of Object.entries(data ?? {})) if (v !== undefined) db.record[k] = v;
    return structuredClone(db.record);
  },
  delete: async () => { db.record = null; return { id: "r1" }; },
};

const authCtx: any = {
  user: { id: "u1", role: "DOCTOR", clinicId: "c1", email: "doc@qa.mx", firstName: "Iris", lastName: "Peña", permissionsOverride: null },
};
let permisoDenegado: any = null;
let visibilidadDenegada: any = null;

(mock as any).module("@/lib/prisma", { namedExports: { prisma: { medicalRecord: recordDelegate } } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("@/lib/auth/require-permission", {
  namedExports: { denyIfMissingPermission: () => permisoDenegado },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => visibilidadDenegada },
});
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => {}, revalidatePatientProfile: () => {} },
});

function req(body?: any): any {
  return { json: async () => (body ?? {}), headers: new Headers(), url: "http://localhost/api/clinical-notes/r1/addendum" };
}
const P = { params: { id: "r1" } };

/** Todo lo que quedó FIRMADO y por tanto no puede moverse. */
function loFirmado(r: any) {
  const { addenda: _ignorada, ...spec } = r.specialtyData ?? {};
  return {
    subjective: r.subjective, objective: r.objective,
    assessment: r.assessment, plan: r.plan, vitals: r.vitals,
    spec,
  };
}

beforeEach(() => {
  setRecord();
  permisoDenegado = null;
  visibilidadDenegada = null;
  authCtx.user = { id: "u1", role: "DOCTOR", clinicId: "c1", email: "doc@qa.mx", firstName: "Iris", lastName: "Peña", permissionsOverride: null };
});

const addendum = () => import("@/app/api/clinical-notes/[id]/addendum/route");

// ── El candado que NO se toca ───────────────────────────────────────────────

test("el PATCH sigue rechazando editar una nota firmada (NOM-024)", async () => {
  const { PATCH } = await import("@/app/api/clinical-notes/[id]/route");
  const antes = loFirmado(db.record);

  const res = await PATCH(req({ assessment: "Caries profunda pieza 27." }), P);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no se pueden editar/i);
  assert.deepEqual(loFirmado(db.record), antes, "y no escribió nada");
});

// ── El camino que sí existe ─────────────────────────────────────────────────

test("hallazgo 25 · la adenda se guarda SIN tocar una letra de lo firmado", async () => {
  const { POST } = await addendum();
  const antes = loFirmado(db.record);

  const res = await POST(req({ text: "Donde dice pieza 26 debe decir pieza 27; error de captura." }), P);
  assert.equal(res.status, 201);

  const body = await res.json();
  assert.equal(body.addenda.length, 1);
  assert.equal(body.addendum.text, "Donde dice pieza 26 debe decir pieza 27; error de captura.");
  // NOM-004: el autor, siempre identificable, y congelado al escribirla.
  assert.equal(body.addendum.authorId, "u1");
  assert.equal(body.addendum.authorName, "Iris Peña");
  assert.ok(!Number.isNaN(Date.parse(body.addendum.createdAt)));

  // Lo firmado, campo por campo, exactamente igual que antes.
  assert.deepEqual(loFirmado(db.record), antes);
  assert.equal(db.record.specialtyData.status, "SIGNED");
  assert.equal(db.record.specialtyData.signedAt, "2026-09-01T10:00:00.000Z");
});

test("las adendas se acumulan: la segunda no pisa la primera", async () => {
  const { POST } = await addendum();
  await POST(req({ text: "Primera corrección." }), P);
  const res = await POST(req({ text: "Segunda corrección." }), P);

  const { addenda } = await res.json();
  assert.equal(addenda.length, 2);
  assert.equal(addenda[0].text, "Primera corrección.");
  assert.equal(addenda[1].text, "Segunda corrección.");
  assert.equal(db.record.specialtyData.addenda.length, 2);
});

test("una adenda no se puede editar ni borrar: la ruta solo expone POST", async () => {
  const r: any = await addendum();
  assert.equal(typeof r.POST, "function");
  for (const verbo of ["PATCH", "PUT", "DELETE"]) {
    assert.equal(r[verbo], undefined, `no debe existir ${verbo} sobre una adenda`);
  }
});

test("una nota en BORRADOR no admite adendas: se edita, que para eso lo está", async () => {
  setRecord({ specialtyData: { type: "dental", status: "DRAFT" } });
  const { POST } = await addendum();

  const res = await POST(req({ text: "algo" }), P);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /borrador/i);
  assert.equal(db.record.specialtyData.addenda, undefined);
});

test("adenda vacía o solo espacios → 400", async () => {
  const { POST } = await addendum();
  assert.equal((await POST(req({ text: "" }), P)).status, 400);
  assert.equal((await POST(req({ text: "   " }), P)).status, 400);
  assert.equal((await POST(req({}), P)).status, 400);
  assert.equal(db.record.specialtyData.addenda, undefined);
});

// ── Los mismos cierres que sus rutas hermanas ───────────────────────────────

test("otra clínica no alcanza la nota (aislamiento por clinicId)", async () => {
  authCtx.user = { ...authCtx.user, clinicId: "c2" };
  const { POST } = await addendum();
  assert.equal((await POST(req({ text: "x" }), P)).status, 404);
});

test("sin permiso medicalRecord.edit no se escribe adenda", async () => {
  permisoDenegado = new Response(JSON.stringify({ error: "Permiso requerido" }), { status: 403 });
  const { POST } = await addendum();
  assert.equal((await POST(req({ text: "x" }), P)).status, 403);
});

test("paciente que este usuario no puede ver → 404, antes de mirar la nota", async () => {
  visibilidadDenegada = new Response(JSON.stringify({ error: "patient_not_found" }), { status: 404 });
  const { POST } = await addendum();
  assert.equal((await POST(req({ text: "x" }), P)).status, 404);
});

test("ni el dueño ni admin → 403", async () => {
  authCtx.user = { ...authCtx.user, id: "otro", role: "DOCTOR" };
  const { POST } = await addendum();
  assert.equal((await POST(req({ text: "x" }), P)).status, 403);

  authCtx.user = { ...authCtx.user, id: "otro", role: "ADMIN" };
  assert.equal((await POST(req({ text: "x" }), P)).status, 201, "un admin de la clínica sí");
});
