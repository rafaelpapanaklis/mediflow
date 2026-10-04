/**
 * Con qué doctor nace la factura (ws1-t2, falla F10 de la auditoría BEVADENT: «95 % de lo
 * facturado aparece como Sin doctor»).
 *
 * Run: npm run test:doctor-de-factura
 *
 * Con el código viejo: POST /api/invoices con cita y sin doctor guardaba `doctorId: null`, y
 * crearFacturaDesdeCita (from-appointment, anticipo, controles de ortodoncia) ni siquiera
 * escribía la columna. Las pruebas de la ruta y del servicio fallan con ese código.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { elegirDoctorDeFactura, doctorPedido, unicoDoctor, diaSiguiente } from "../doctor-de-factura";

// ── Doble de Prisma ─────────────────────────────────────────────────────────
type Cita = { id: string; clinicId: string; patientId: string; doctorId: string; startsAt: Date; status: string };
const db = {
  citas: [] as Cita[],
  planes: [] as Array<{ clinicId: string; patientId: string; doctorId: string; status: string }>,
  casos: [] as Array<{ clinicId: string; patientId: string; treatingDoctorId: string | null; status: string; deletedAt: Date | null }>,
  usuarios: [] as Array<{ id: string; clinicId: string; role: string; isActive: boolean }>,
  // C-07 (auditoría de uso): el doctor de cabecera del paciente.
  pacientes: [] as Array<{ id: string; clinicId: string; primaryDoctorId: string | null }>,
  creadas: [] as any[],
};
function reiniciar() {
  db.citas = []; db.planes = []; db.casos = []; db.creadas = []; db.pacientes = [];
  db.usuarios = [
    { id: "docA", clinicId: "c1", role: "DOCTOR", isActive: true },
    { id: "docB", clinicId: "c1", role: "SUPER_ADMIN", isActive: true },
    { id: "recep", clinicId: "c1", role: "RECEPTIONIST", isActive: true },
    { id: "docBaja", clinicId: "c1", role: "DOCTOR", isActive: false },
    { id: "docOtra", clinicId: "c2", role: "DOCTOR", isActive: true },
  ];
}
reiniciar();

const enRango = (d: Date, r: any) => (!r?.gte || d >= r.gte) && (!r?.lt || d < r.lt);
const prismaStub: any = {
  appointment: {
    findFirst: async ({ where }: any) => {
      assert.ok(where?.clinicId, "la cita se busca SIEMPRE con clinicId");
      const c = db.citas.find((x) => x.id === where.id && x.clinicId === where.clinicId);
      return c ? { id: c.id, patientId: c.patientId, doctorId: c.doctorId } : null;
    },
    findMany: async ({ where }: any) => {
      assert.ok(where?.clinicId, "las citas de hoy se buscan con clinicId");
      return db.citas
        .filter((x) => x.clinicId === where.clinicId && x.patientId === where.patientId
          && enRango(x.startsAt, where.startsAt) && !(where.status?.notIn ?? []).includes(x.status))
        .map((x) => ({ doctorId: x.doctorId }));
    },
  },
  treatmentPlan: {
    findMany: async ({ where }: any) => {
      assert.ok(where?.clinicId);
      // En la base real `status` es TEXT y Prisma lo compara como enum (error 42883): no se filtra en SQL.
      assert.equal(where.status, undefined, "treatment_plans.status no va en el where");
      return db.planes.filter((p) => p.clinicId === where.clinicId && p.patientId === where.patientId)
        .map((p) => ({ doctorId: p.doctorId, status: p.status }));
    },
  },
  orthodonticTreatmentPlan: {
    findMany: async ({ where }: any) => {
      assert.ok(where?.clinicId);
      assert.equal(where.status, undefined, "el estado del caso se filtra en JS");
      return db.casos.filter((c) => c.clinicId === where.clinicId && c.patientId === where.patientId && c.deletedAt === null
        && c.treatingDoctorId !== null)
        .map((c) => ({ treatingDoctorId: c.treatingDoctorId, status: c.status }));
    },
  },
  user: {
    findFirst: async ({ where }: any) => {
      assert.ok(where?.clinicId, "el doctor se valida con clinicId");
      const u = db.usuarios.find((x) => x.id === where.id && x.clinicId === where.clinicId
        && (where.role?.in ?? [x.role]).includes(x.role) && (where.isActive === undefined || x.isActive === where.isActive));
      return u ? { id: u.id } : null;
    },
  },
  patient: {
    findFirst: async ({ where }: any) => {
      assert.ok(where?.clinicId, "el paciente se busca SIEMPRE con clinicId");
      const p = db.pacientes.find((x) => x.id === where.id && x.clinicId === where.clinicId);
      return p ? { primaryDoctorId: p.primaryDoctorId } : null;
    },
  },
  invoice: {
    findUnique: async () => null,
    create: async ({ data }: any) => {
      const row = { id: `inv${db.creadas.length + 1}`, createdAt: new Date(), patient: { id: data.patientId }, ...data };
      db.creadas.push(row);
      return row;
    },
  },
  clinic: { findUnique: async () => ({ cfdiTaxMode: "exempt" }) },
};

const authCtx: any = { clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null, clinic: { timezone: "America/Mexico_City" } };
(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, relatedPatientVisibilityAnd: () => [] },
});
(mock as any).module("@/lib/invoices/cita-factura-cancelada.server", {
  namedExports: { soltarFacturaCanceladaDeCita: async () => {} },
});
(mock as any).module("@/lib/patient-credit-aplicar", {
  namedExports: { aplicarSaldoAFavor: async () => ({ aplicado: 0, restanteAFavor: 0, factura: null }) },
});
(mock as any).module("@/lib/invoices/next-invoice-number", {
  namedExports: {
    nextInvoiceNumber: async () => "MF-0001",
    withInvoiceNumberRetry: async (fn: () => Promise<unknown>) => fn(),
    InvoiceNumberExhaustedError: class extends Error {},
  },
});

const HOY = new Date();
function req(body: any): any {
  return { json: async () => body, headers: new Headers(), url: "http://localhost/api/invoices" };
}
const cuerpo = (extra: Record<string, unknown> = {}) => ({
  patientId: "p1",
  items: [{ description: "Limpieza dental", quantity: 1, unitPrice: 700, total: 700 }],
  ...extra,
});

// ── Regla pura ──────────────────────────────────────────────────────────────
test("regla: lo elegido gana; null explícito es «Sin asignar» y no hereda", () => {
  assert.deepEqual(elegirDoctorDeFactura("docB", { cita: "docA" }), { doctorId: "docB", origen: "elegido" });
  assert.deepEqual(elegirDoctorDeFactura(null, { cita: "docA" }), { doctorId: null, origen: "sin_asignar" });
});

test("regla: cita → nota → citas de hoy → plan; con dos doctores distintos no adivina", () => {
  assert.equal(elegirDoctorDeFactura(undefined, { cita: "docA", planes: ["docB"] }).origen, "cita");
  assert.equal(elegirDoctorDeFactura(undefined, { nota: "docA", citasDeHoy: ["docB"] }).origen, "nota");
  assert.deepEqual(elegirDoctorDeFactura(undefined, { citasDeHoy: ["docA", "docA"], planes: ["docB"] }), { doctorId: "docA", origen: "cita_de_hoy" });
  assert.deepEqual(elegirDoctorDeFactura(undefined, { planes: ["docB", "docB", null] }), { doctorId: "docB", origen: "plan" });
  assert.deepEqual(elegirDoctorDeFactura(undefined, { planes: ["docA", "docB"] }), { doctorId: null, origen: "ninguno" });
  assert.deepEqual(elegirDoctorDeFactura(undefined, {}), { doctorId: null, origen: "ninguno" });
});

test("doctorPedido: texto = elegido, null = sin asignar, ausente o vacío = heredar", () => {
  assert.equal(doctorPedido(" docA "), "docA");
  assert.equal(doctorPedido(null), null);
  assert.equal(doctorPedido(undefined), undefined);
  assert.equal(doctorPedido(""), undefined);
  assert.equal(doctorPedido(42), undefined);
  assert.equal(unicoDoctor(["", "  ", undefined]), null);
  assert.equal(diaSiguiente("2026-12-31"), "2027-01-01");
});

// ── POST /api/invoices ──────────────────────────────────────────────────────
test("POST /api/invoices: con cita y sin doctor, la factura nace con el doctor de la cita", async () => {
  reiniciar();
  db.citas.push({ id: "a1", clinicId: "c1", patientId: "p1", doctorId: "docA", startsAt: HOY, status: "COMPLETED" });
  const { POST } = await import("@/app/api/invoices/route");
  const res = await POST(req(cuerpo({ appointmentId: "a1" })));
  assert.equal(res.status, 201);
  assert.equal(db.creadas[0].doctorId, "docA");
});

test("POST /api/invoices: sin cita, toma la cita de hoy del paciente; si no hay, su plan activo", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  reiniciar();
  db.citas.push({ id: "a2", clinicId: "c1", patientId: "p1", doctorId: "docB", startsAt: HOY, status: "CONFIRMED" });
  db.planes.push({ clinicId: "c1", patientId: "p1", doctorId: "docA", status: "ACTIVE" });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId, "docB", "la cita de hoy gana al plan");

  reiniciar();
  db.citas.push({ id: "a3", clinicId: "c1", patientId: "p1", doctorId: "docB", startsAt: HOY, status: "CANCELLED" });
  db.planes.push({ clinicId: "c1", patientId: "p1", doctorId: "docA", status: "ACTIVE" });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId, "docA", "una cita cancelada no cuenta; sale el del plan");
});

test("POST /api/invoices: el caso de ortodoncia vivo cuenta como plan; dos doctores distintos → sin doctor", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  reiniciar();
  db.casos.push({ clinicId: "c1", patientId: "p1", treatingDoctorId: "docB", status: "IN_PROGRESS", deletedAt: null });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId, "docB");

  reiniciar();
  db.casos.push({ clinicId: "c1", patientId: "p1", treatingDoctorId: "docB", status: "IN_PROGRESS", deletedAt: null });
  db.planes.push({ clinicId: "c1", patientId: "p1", doctorId: "docA", status: "ACTIVE" });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId, null);
});

test("POST /api/invoices: «Sin asignar» elegido (null) no hereda; un doctor elegido se respeta", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  reiniciar();
  db.citas.push({ id: "a4", clinicId: "c1", patientId: "p1", doctorId: "docA", startsAt: HOY, status: "COMPLETED" });
  await POST(req(cuerpo({ appointmentId: "a4", doctorId: null })));
  assert.equal(db.creadas[0].doctorId, null);
  await POST(req(cuerpo({ doctorId: "docB" })));
  assert.equal(db.creadas[1].doctorId, "docB");
  const malo = await POST(req(cuerpo({ doctorId: "docOtra" })));
  assert.equal(malo.status, 400, "un doctor de otra clínica sigue rechazado");
});

test("POST /api/invoices: un plan pausado o un caso terminado no cuentan como «plan activo»", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  reiniciar();
  db.planes.push({ clinicId: "c1", patientId: "p1", doctorId: "docA", status: "PAUSED" });
  db.casos.push({ clinicId: "c1", patientId: "p1", treatingDoctorId: "docB", status: "COMPLETED", deletedAt: null });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId, null);
  reiniciar();
  db.planes.push({ clinicId: "c1", patientId: "p1", doctorId: "docA", status: "PAUSED" });
  db.planes.push({ clinicId: "c1", patientId: "p1", doctorId: "docB", status: "ACTIVE" });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId, "docB", "solo el ACTIVO decide");
});

test("POST /api/invoices: no hereda a quien ya no atiende (baja) ni a otra clínica", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  reiniciar();
  db.planes.push({ clinicId: "c1", patientId: "p1", doctorId: "docBaja", status: "ACTIVE" });
  db.planes.push({ clinicId: "c2", patientId: "p1", doctorId: "docOtra", status: "ACTIVE" });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId, null);
});

// ── crearFacturaDesdeCita (from-appointment, anticipo, controles de ortodoncia) ─
test("crearFacturaDesdeCita: la factura de la cita nace con el doctor de la cita", async () => {
  reiniciar();
  db.citas.push({ id: "a5", clinicId: "c1", patientId: "p1", doctorId: "docB", startsAt: HOY, status: "COMPLETED" });
  const { crearFacturaDesdeCita } = await import("../crear-desde-cita.server");
  const r = await crearFacturaDesdeCita({
    clinicId: "c1", appointmentId: "a5", patientId: "p1",
    lineItems: [{ description: "Control de ortodoncia", unitPrice: 800, quantity: 1 }],
  });
  assert.equal(r.ok, true);
  assert.equal(db.creadas[0].doctorId, "docB");
});

test("crearFacturaDesdeCita: si leer el doctor falla, la factura nace igual (sin doctor)", async () => {
  reiniciar();
  const original = prismaStub.appointment.findFirst;
  prismaStub.appointment.findFirst = async () => { throw new Error("pooler"); };
  const avisos = console.warn;
  console.warn = () => {};
  try {
    const { crearFacturaDesdeCita } = await import("../crear-desde-cita.server");
    const r = await crearFacturaDesdeCita({
      clinicId: "c1", appointmentId: "a6", patientId: "p1",
      lineItems: [{ description: "Consulta", unitPrice: 500, quantity: 1 }],
    });
    assert.equal(r.ok, true);
    assert.equal(db.creadas[0].doctorId, null);
  } finally {
    prismaStub.appointment.findFirst = original;
    console.warn = avisos;
  }
});

// ── GET /api/invoices/doctor-sugerido (lo que preselecciona «Nueva factura») ──
test("GET doctor-sugerido: misma regla que el POST, con su origen", async () => {
  reiniciar();
  db.planes.push({ clinicId: "c1", patientId: "p1", doctorId: "docA", status: "ACTIVE" });
  const { GET } = await import("@/app/api/invoices/doctor-sugerido/route");
  const res = await GET({ url: "http://localhost/api/invoices/doctor-sugerido?patientId=p1" } as any);
  assert.deepEqual(await res.json(), { doctorId: "docA", origen: "plan" });
  const sin = await GET({ url: "http://localhost/api/invoices/doctor-sugerido" } as any);
  assert.equal(sin.status, 400);
});

// ── Auditoría de uso C-07 (ws1-t5, 4-oct-2026) ──────────────────────────────
// F1 de la auditoría: «Cobrar hoy» $1,200 a Lucía (doctor de cabecera Dr. A, sin
// cita hoy ni plan) quedó «Sin doctor» y no entró a la comisión del Dr. A.
test("C-07 · regla: sin cita hoy ni plan, el doctor de cabecera; el plan le gana", () => {
  assert.deepEqual(elegirDoctorDeFactura(undefined, { cabecera: "docA" }), { doctorId: "docA", origen: "cabecera" });
  assert.equal(elegirDoctorDeFactura(undefined, { planes: ["docB"], cabecera: "docA" }).doctorId, "docB");
  assert.equal(elegirDoctorDeFactura(undefined, { citasDeHoy: ["docB"], cabecera: "docA" }).doctorId, "docB");
});

test("C-07 · POST /api/invoices (lo que manda «Cobrar hoy»): sin cita hoy ni plan, nace con el doctor de cabecera (antes sin doctor)", async () => {
  const { POST } = await import("@/app/api/invoices/route");
  reiniciar();
  db.pacientes.push({ id: "p1", clinicId: "c1", primaryDoctorId: "docA" });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId, "docA");

  // De otra clínica o dado de baja: no se hereda.
  reiniciar();
  db.pacientes.push({ id: "p1", clinicId: "c1", primaryDoctorId: "docBaja" });
  await POST(req(cuerpo()));
  assert.equal(db.creadas[0].doctorId ?? null, null);
});

test("C-07 · GET doctor-sugerido dice «cabecera» (lo que preselecciona «Nueva factura»)", async () => {
  const { GET } = await import("@/app/api/invoices/doctor-sugerido/route");
  reiniciar();
  db.pacientes.push({ id: "p1", clinicId: "c1", primaryDoctorId: "docA" });
  const r = await GET({ url: "http://localhost/api/invoices/doctor-sugerido?patientId=p1", headers: new Headers() } as any);
  assert.deepEqual(await r.json(), { doctorId: "docA", origen: "cabecera" });
});
