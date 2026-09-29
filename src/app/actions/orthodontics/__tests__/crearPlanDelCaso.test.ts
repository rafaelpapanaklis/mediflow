/**
 * Ortodoncia — la acción que crea el plan de pago al abrir el caso (ws1-t10).
 * Cubre lo que el núcleo no puede: el PERMISO (sin `billing.create` no se crea nada),
 * que todo sale de la clínica de la SESIÓN y que el trato se guarda con la misma
 * escritura de siempre. Las reglas del dinero están en crear-plan-del-caso.test.ts.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npx tsx --test --experimental-test-module-mocks src/app/actions/orthodontics/__tests__/crearPlanDelCaso.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "clinic-1";
const state = {
  permiso: true,
  clinicId: CLINICA as string | undefined,
  caso: {
    id: "caso-1", patientId: "pac-1", invoiceId: null as string | null, technique: "METAL_BRACKETS",
    techniqueName: null, totalCostMxn: 36000, treatingDoctorId: "doc-1",
  },
  modo: null as string | null,
  creadas: [] as Array<Record<string, unknown>>,
  wheres: [] as Array<Record<string, unknown>>,
  condiciones: [] as Array<Record<string, unknown>>,
  ligas: [] as Array<Record<string, unknown>>,
  auditorias: [] as Array<Record<string, unknown>>,
  revalidados: [] as string[],
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      invoice: {
        findFirst: async (a: { where: Record<string, unknown> }) => { state.wheres.push(a.where); return null; },
        create: async (a: { data: Record<string, unknown> }) => {
          state.creadas.push(a.data);
          return { id: "fac-nueva", invoiceNumber: "MF-0042", total: a.data.total };
        },
      },
      user: { findFirst: async (a: { where: Record<string, unknown> }) => { state.wheres.push(a.where); return { id: "doc-1" }; } },
      clinic: { findUnique: async () => ({ cfdiTaxMode: "exempt" }) },
    },
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: (p: string) => { state.revalidados.push(p); } } });
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
mock.module("@/lib/invoices/next-invoice-number", {
  namedExports: {
    InvoiceNumberExhaustedError: class extends Error {},
    nextInvoiceNumber: async () => "MF-0042",
    withInvoiceNumberRetry: async (fn: () => Promise<unknown>) => fn(),
  },
});
mock.module("@/lib/patient-credit-aplicar", { namedExports: { aplicarSaldoAFavor: async () => ({ aplicado: 0 }) } });
mock.module("@/lib/invoices/condiciones-pago-db", {
  namedExports: {
    guardarCondicionesDeFactura: async (_db: unknown, a: Record<string, unknown>) => {
      state.condiciones.push(a);
      return { condiciones: a.condiciones, fallo: false, sinTabla: false, ajena: false };
    },
  },
});
mock.module("@/lib/orthodontics/billing-mode-db", { namedExports: { cargarModoDeCobro: async () => state.modo } });
mock.module("../_helpers", {
  namedExports: {
    getOrthoBillingActionContext: async (permiso: string) => {
      if (!state.permiso) return { ok: false, error: `Sin permisos: ${permiso}` };
      return { ok: true, data: { ctx: { clinicId: state.clinicId, userId: "user-1", role: "RECEPTIONIST" } } };
    },
  },
});
mock.module("../cobro/_ctx", {
  namedExports: {
    loadCasoParaCobro: async () => ({ ok: true, data: state.caso }),
    auditarCobro: async (a: Record<string, unknown>) => { state.auditorias.push(a); },
  },
});
mock.module("../cobro/abrirPlanDePago", {
  namedExports: {
    abrirPlanDePago: async (a: Record<string, unknown>) => { state.ligas.push(a); return { ok: true, data: { invoiceId: a.invoiceId } }; },
  },
});

function reset() {
  state.permiso = true;
  state.clinicId = CLINICA;
  state.caso.invoiceId = null;
  state.modo = null;
  state.creadas = [];
  state.wheres = [];
  state.condiciones = [];
  state.ligas = [];
  state.auditorias = [];
  state.revalidados = [];
}

const PLAZOS = { treatmentPlanId: "caso-1", modoDeCobro: "PRECIO_TOTAL", precioColocacion: null, enganche: 6000, numPagos: 15, primerPago: "2026-09-29" } as const;

test("con permiso: crea la factura del caso en la clínica de la sesión, guarda el trato, la liga y deja bitácora", async () => {
  reset();
  const { crearPlanDelCaso } = await import("../cobro/crearPlanDelCaso");
  const r = await crearPlanDelCaso({ ...PLAZOS });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.invoiceId, "fac-nueva");
  assert.equal(r.data.invoiceNumber, "MF-0042");

  assert.equal(state.creadas.length, 1);
  const f = state.creadas[0]!;
  assert.equal(f.clinicId, CLINICA, "la clínica sale de la sesión");
  assert.equal(f.patientId, "pac-1", "el paciente sale del caso guardado");
  assert.equal(f.total, 36000);
  assert.equal(f.status, "PENDING");
  assert.equal(f.paid, 0);
  assert.equal(f.balance, 36000);

  assert.equal(state.condiciones.length, 1);
  assert.equal(state.condiciones[0]!.clinicId, CLINICA);
  assert.equal(state.condiciones[0]!.invoiceId, "fac-nueva");
  assert.deepEqual(state.ligas, [{ treatmentPlanId: "caso-1", invoiceId: "fac-nueva" }]);
  assert.equal(state.auditorias.length, 1);
  assert.equal(state.auditorias[0]!.action, "crear-plan-al-abrir-caso");
  assert.ok(state.revalidados.includes("/dashboard/patients/pac-1"));
  // Todo lo que consultó a la base llevó la clínica de la sesión.
  assert.ok(state.wheres.every((w) => w.clinicId === CLINICA));
});

test("SIN PERMISO de cobro: no se crea factura, ni trato, ni liga (el caso ya quedó abierto y recepción lo arma)", async () => {
  reset();
  state.permiso = false;
  const { crearPlanDelCaso } = await import("../cobro/crearPlanDelCaso");
  const r = await crearPlanDelCaso({ ...PLAZOS });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /billing\.create/);
  assert.equal(state.creadas.length, 0);
  assert.equal(state.condiciones.length, 0);
  assert.equal(state.ligas.length, 0);
  assert.equal(state.auditorias.length, 0);
});

test("sin clínica en la sesión no se consulta ni se escribe nada (clinicId: undefined no filtra)", async () => {
  reset();
  state.clinicId = undefined;
  const { crearPlanDelCaso } = await import("../cobro/crearPlanDelCaso");
  const r = await crearPlanDelCaso({ ...PLAZOS });
  assert.equal(r.ok, false);
  assert.equal(state.creadas.length, 0);
  assert.equal(state.wheres.length, 0);
});

test("si el caso ya tiene su factura vigente: no crea otra ni deja otra bitácora", async () => {
  reset();
  state.caso.invoiceId = "fac-vieja";
  // `facturaLigada` la busca con findFirst: aquí devolvemos una vigente.
  const { prisma } = await import("@/lib/prisma");
  const original = prisma.invoice.findFirst;
  (prisma.invoice as { findFirst: unknown }).findFirst = async () => ({ id: "fac-vieja", invoiceNumber: "MF-0001", status: "PENDING" });
  try {
    const { crearPlanDelCaso } = await import("../cobro/crearPlanDelCaso");
    const r = await crearPlanDelCaso({ ...PLAZOS });
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.data.yaExistia, true); assert.equal(r.data.invoiceId, "fac-vieja"); }
    assert.equal(state.creadas.length, 0);
    assert.equal(state.ligas.length, 0);
    assert.equal(state.auditorias.length, 0);
  } finally {
    (prisma.invoice as { findFirst: unknown }).findFirst = original;
  }
});

test("«Pago por control»: factura la colocación con el precio que llegó, no el del tratamiento", async () => {
  reset();
  state.modo = "PAGO_POR_CONTROL";
  const { crearPlanDelCaso } = await import("../cobro/crearPlanDelCaso");
  const r = await crearPlanDelCaso({ treatmentPlanId: "caso-1", modoDeCobro: "PAGO_POR_CONTROL", precioColocacion: 4500, enganche: 0, numPagos: 0, primerPago: null });
  assert.equal(r.ok, true);
  assert.equal(state.creadas[0]!.total, 4500);
  assert.equal(state.condiciones.length, 0);
});
