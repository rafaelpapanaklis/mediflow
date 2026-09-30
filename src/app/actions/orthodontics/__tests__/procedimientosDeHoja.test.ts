/**
 * «Procedimientos de esta visita»: el cobro es DINERO, así que se prueba con un
 * Prisma y una factura falsos pero con las reglas de permisos REALES.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/app/actions/orthodontics/__tests__/procedimientosDeHoja.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { hasPermission } from "@/lib/auth/permissions";

type Sd = Record<string, unknown>;
interface Factura { id: string; invoiceNumber: string; status: string; notes: string | null; patientId: string; clinicId: string; items: unknown }

let nota: { id: string; visitDate: Date; specialtyData: Sd; patient: { id: string; firstName: string; lastName: string; visibleUserIds: string[] } };
let facturas: Factura[] = [];
let creadas = 0;
let ctx = { userId: "u1", role: "DOCTOR", clinicId: "c1", permissionsOverride: [] as string[] };

const CARD = "card-1";
const PLAN = "plan-1";
const PAC = "pac-1";

function reset(over: Partial<typeof ctx> = {}) {
  ctx = { userId: "u1", role: "DOCTOR", clinicId: "c1", permissionsOverride: ["specialties.orthodontics", "billing.charge", "billing.view"], ...over };
  facturas = [];
  creadas = 0;
  nota = {
    id: "n1",
    visitDate: new Date("2026-09-28T18:00:00Z"),
    patient: { id: PAC, firstName: "Ana", lastName: "Prueba", visibleUserIds: [] },
    specialtyData: {
      type: "orthodontics", status: "SIGNED", treatmentCardId: CARD, treatmentPlanId: PLAN, cardNumber: 2, hayPorCobrar: true,
      procedimientos: [
        { procedureId: "pc", name: "Recementado de bracket", quantity: 2, unitPrice: 250, incluido: false },
        { procedureId: "pi", name: "Retenedor incluido", quantity: 1, unitPrice: 0, incluido: true },
      ],
    },
  };
}

const tx = {
  $queryRaw: async () => [],
  medicalRecord: {
    findFirst: async () => ({ id: nota.id, specialtyData: nota.specialtyData }),
    update: async ({ data }: { data: { specialtyData: Sd } }) => { nota.specialtyData = data.specialtyData; return nota; },
  },
  invoice: {
    findFirst: async ({ where }: { where: { id?: string; notes?: { startsWith: string }; status?: { not: string } } }) => {
      const f = facturas.find((x) => (where.id ? x.id === where.id : true) && (where.notes ? (x.notes ?? "").startsWith(where.notes.startsWith) : true) && (where.status?.not ? x.status !== where.status.not : true));
      return f ?? null;
    },
  },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthoTreatmentCard: { findFirst: async () => ({ id: CARD, patientId: PAC, treatmentPlanId: PLAN, cardNumber: 2, status: "SIGNED" }) },
      $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
      medicalRecord: { findMany: async () => [nota] },
      invoice: { findMany: async () => facturas },
    },
  },
});
mock.module("../_helpers", {
  namedExports: {
    getOrthoActionContext: async () => ({ ok: true, data: { ctx } }),
    getOrthoBillingActionContext: async (permiso: string) =>
      hasPermission({ role: ctx.role, permissionsOverride: ctx.permissionsOverride }, permiso as never)
        ? { ok: true, data: { ctx } }
        : { ok: false, error: `Sin permisos: ${permiso}` },
  },
});
mock.module("../cobro/_ctx", {
  namedExports: {
    loadCasoParaCobro: async () => ({ ok: true, data: { id: PLAN, patientId: PAC } }),
    auditarCobro: async () => {},
  },
});
mock.module("@/lib/invoices/crear-desde-cita.server", {
  namedExports: {
    crearFacturaDesdeCita: async (a: { patientId: string; clinicId: string; notes: string; lineItems: unknown }) => {
      creadas++;
      const f: Factura = { id: `inv-${creadas}`, invoiceNumber: `MF-${creadas}`, status: "PENDING", notes: a.notes, patientId: a.patientId, clinicId: a.clinicId, items: a.lineItems };
      facturas.push(f);
      return { ok: true, error: null, invoice: f };
    },
  },
});
mock.module("@/lib/orthodontics/cobro/extras-db", { namedExports: { vincularExtraAlCaso: async () => ({ ok: true, sinColumna: false }) } });
mock.module("@/lib/orthodontics/procedimientos-de-hoja-db", {
  namedExports: {
    buscarNotaDeHoja: async () => ({ id: nota.id, specialtyData: nota.specialtyData, firmada: true }),
    cargarCatalogoElegible: async () => [],
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
// ws1-t4 (fallo 3): el cobro devuelve lo que necesita la ventana completa de cobro.
mock.module("@/lib/menu-dos-niveles/interruptor", { namedExports: { menuDosNivelesEncendido: async () => true } });

const lineas = () => (nota.specialtyData.procedimientos as { procedureId: string; invoiceId?: string | null }[]);

test("con permiso de cobro se crea la factura del extra con la cantidad y el precio guardados en la hoja", async () => {
  reset();
  const { cobrarProcedimientoDeHoja } = await import("../procedimientosDeHoja");
  const r = await cobrarProcedimientoDeHoja({ cardId: CARD, procedureId: "pc" });
  assert.equal(r.ok, true);
  assert.equal(creadas, 1);
  const item = (facturas[0].items as { description: string; unitPrice: number; quantity: number }[])[0];
  assert.deepEqual([item.description, item.unitPrice, item.quantity], ["Recementado de bracket", 250, 2]);
  assert.ok((facturas[0].notes ?? "").startsWith("[extra-hoja:card-1:pc]"));
  assert.equal(lineas().find((l) => l.procedureId === "pc")?.invoiceId, "inv-1");
  assert.equal(nota.specialtyData.hayPorCobrar, false, "ya no queda nada por cobrar");
  // ws1-t4 (fallo 3): con esto quien llama abre la ventana completa de cobro de ESA factura.
  if (r.ok) {
    assert.equal(r.data.invoiceId, "inv-1");
    assert.equal(r.data.rediseno, true);
    assert.equal(typeof r.data.total, "number");
  }
});

test("NO duplica: el segundo cobro de la misma línea devuelve la misma factura", async () => {
  reset();
  const { cobrarProcedimientoDeHoja } = await import("../procedimientosDeHoja");
  const a = await cobrarProcedimientoDeHoja({ cardId: CARD, procedureId: "pc" });
  const b = await cobrarProcedimientoDeHoja({ cardId: CARD, procedureId: "pc" });
  assert.equal(creadas, 1);
  assert.equal(a.ok && b.ok && a.data.invoiceId === b.data.invoiceId, true);
  assert.equal(b.ok && b.data.yaExistia, true);
});

test("NO duplica: si existe una factura con la marca de la línea (se cortó antes de anotarla), se adopta", async () => {
  reset();
  facturas.push({ id: "inv-x", invoiceNumber: "MF-9", status: "PENDING", notes: "[extra-hoja:card-1:pc] ya creada", patientId: PAC, clinicId: "c1", items: [] });
  const { cobrarProcedimientoDeHoja } = await import("../procedimientosDeHoja");
  const r = await cobrarProcedimientoDeHoja({ cardId: CARD, procedureId: "pc" });
  assert.equal(creadas, 0);
  assert.equal(r.ok && r.data.invoiceId, "inv-x");
  assert.equal(lineas().find((l) => l.procedureId === "pc")?.invoiceId, "inv-x");
});

test("una factura CANCELADA no cuenta: se vuelve a cobrar con una nueva", async () => {
  reset();
  (nota.specialtyData.procedimientos as { procedureId: string; invoiceId?: string }[])[0].invoiceId = "inv-old";
  facturas.push({ id: "inv-old", invoiceNumber: "MF-0", status: "CANCELLED", notes: "[extra-hoja:card-1:pc]", patientId: PAC, clinicId: "c1", items: [] });
  const { cobrarProcedimientoDeHoja } = await import("../procedimientosDeHoja");
  const r = await cobrarProcedimientoDeHoja({ cardId: CARD, procedureId: "pc" });
  assert.equal(creadas, 1);
  assert.equal(r.ok && r.data.invoiceId, "inv-1");
});

test("un procedimiento INCLUIDO no factura nunca", async () => {
  reset();
  const { cobrarProcedimientoDeHoja } = await import("../procedimientosDeHoja");
  const r = await cobrarProcedimientoDeHoja({ cardId: CARD, procedureId: "pi" });
  assert.equal(r.ok, false);
  assert.equal(creadas, 0);
  assert.match(!r.ok ? r.error : "", /incluido/);
});

test("sin permiso de cobro no se factura: la línea queda pendiente y recepción la ve", async () => {
  reset({ permissionsOverride: ["specialties.orthodontics", "medicalRecord.view", "medicalRecord.edit"] });
  const { cobrarProcedimientoDeHoja } = await import("../procedimientosDeHoja");
  const r = await cobrarProcedimientoDeHoja({ cardId: CARD, procedureId: "pc" });
  assert.equal(r.ok, false);
  assert.equal(creadas, 0);
  assert.equal(lineas().find((l) => l.procedureId === "pc")?.invoiceId ?? null, null);

  // recepción: puede VER cobranza pero no cobra → ve el pendiente sin botón; con permiso de cobro, con botón
  reset({ permissionsOverride: ["specialties.orthodontics", "billing.view"] });
  const { listarExtrasPorCobrar } = await import("../procedimientosDeHoja");
  const ver = await listarExtrasPorCobrar();
  assert.equal(ver.ok && ver.data.puedeCobrar, false);
  assert.deepEqual(ver.ok && ver.data.extras.map((e) => [e.name, e.quantity, e.total]), [["Recementado de bracket", 2, 500]]);
});

test("la lista de pendientes no incluye incluidos ni lo ya facturado", async () => {
  reset();
  const { cobrarProcedimientoDeHoja, listarExtrasPorCobrar } = await import("../procedimientosDeHoja");
  const antes = await listarExtrasPorCobrar();
  assert.equal(antes.ok && antes.data.extras.length, 1, "solo el de costo aparte");
  await cobrarProcedimientoDeHoja({ cardId: CARD, procedureId: "pc" });
  const despues = await listarExtrasPorCobrar();
  assert.equal(despues.ok && despues.data.extras.length, 0);
});
