/**
 * ws1-t12 — cambiar el costo de un caso desde la ventana «Plan de tratamiento». Con factura, las reglas son las de
 * «editar factura con pagos»: permiso `billing.edit`, nunca por debajo de lo pagado, nunca timbrada ni cancelada,
 * y con plan a plazos se AVISA el recálculo antes de guardar. Todo sale de la clínica de la SESIÓN.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npx tsx --test --experimental-test-module-mocks src/app/actions/orthodontics/__tests__/cambiarCostoDelCaso.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = {
  permiso: true,
  modo: "PRECIO_TOTAL" as string | null,
  caso: { id: "caso-1", patientId: "pac-1", invoiceId: "fac-1" as string | null },
  factura: null as Record<string, unknown> | null,
  condiciones: null as Record<string, unknown> | null,
  wheres: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ donde: Record<string, unknown>; datos: Record<string, unknown> }>,
  planUpdates: [] as Array<{ donde: Record<string, unknown>; datos: Record<string, unknown> }>,
  movimientos: [] as Array<Record<string, unknown>>,
  cierres: 0,
  conteo: 1,
};

const facturaBase = (extra: Record<string, unknown> = {}) => ({
  id: "fac-1", patientId: "pac-1", invoiceNumber: "MF-0001", status: "PARTIAL", cfdiUuid: null,
  total: 30000, paid: 12000, balance: 18000, subtotal: 30000, discount: 0, taxRate: 16, taxIncluded: true,
  items: [{ name: "Tratamiento de ortodoncia", quantity: 1, unitPrice: 30000 }], ...extra,
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      invoice: {
        findFirst: async (a: { where: Record<string, unknown> }) => { state.wheres.push(a.where); return state.factura; },
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { state.updates.push({ donde: a.where, datos: a.data }); return { count: state.conteo }; },
      },
      orthodonticTreatmentPlan: {
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { state.planUpdates.push({ donde: a.where, datos: a.data }); return { count: 1 }; },
      },
    },
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
mock.module("@/lib/factura-mp/servicio.server", { namedExports: { cerrarLinksDeFactura: async () => { state.cierres += 1; } } });
mock.module("@/lib/anticipos/panel.server", { namedExports: { cerrarAnticiposDePanel: async () => { state.cierres += 1; } } });
mock.module("@/lib/invoices/condiciones-pago-db", {
  namedExports: { leerCondicionesDeFacturas: async () => ({ porFactura: new Map(state.condiciones ? [["fac-1", state.condiciones]] : []) }) },
});
mock.module("@/lib/movimientos-paciente/registrar", { namedExports: { registrarMovimientoDelPaciente: async (m: Record<string, unknown>) => { state.movimientos.push(m); } } });
mock.module("@/lib/orthodontics/billing-mode-db", { namedExports: { cargarModoDeCobro: async () => state.modo } });
mock.module("../_helpers", {
  namedExports: {
    getOrthoBillingActionContext: async (permiso: string) => {
      if (!state.permiso) return { ok: false, error: `Sin permisos: ${permiso}` };
      return { ok: true, data: { ctx: { clinicId: "clinic-1", userId: "user-1", role: "ADMIN" } } };
    },
  },
});
mock.module("../cobro/_ctx", { namedExports: { loadCasoParaCobro: async () => ({ ok: true, data: state.caso }) } });

const llamar = async (a: { treatmentPlanId: string; nuevoTotal: number; planAvisado?: boolean }) => (await import("../cobro/cambiarCostoDelCaso")).cambiarCostoDelCaso(a);

function reiniciar(extra: Record<string, unknown> = {}) {
  state.permiso = true;
  state.modo = "PRECIO_TOTAL";
  state.caso = { id: "caso-1", patientId: "pac-1", invoiceId: "fac-1" };
  state.factura = facturaBase(extra);
  state.condiciones = null;
  state.wheres = [];
  state.updates = [];
  state.planUpdates = [];
  state.movimientos = [];
  state.cierres = 0;
  state.conteo = 1;
}

test("exige billing.edit ANTES de tocar nada", async () => {
  reiniciar();
  state.permiso = false;
  const r = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 32000 });
  assert.equal(r.ok, false);
  assert.equal(state.wheres.length, 0);
  assert.equal(state.updates.length, 0);
});

test("un costo que no es un importe válido se rechaza", async () => {
  reiniciar();
  for (const malo of [0, -5, NaN, 10_000_001]) assert.equal((await llamar({ treatmentPlanId: "caso-1", nuevoTotal: malo })).ok, false, String(malo));
  assert.equal(state.updates.length, 0);
});

test("con pagos, el costo nuevo no puede quedar por debajo de lo ya pagado", async () => {
  reiniciar();
  const r = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 9000 });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.match(r.error, /no puede quedar por debajo de lo ya pagado/);
  assert.equal(state.updates.length, 0);
  assert.equal(state.planUpdates.length, 0);
});

test("factura timbrada (CFDI) o cancelada: no se edita", async () => {
  reiniciar({ cfdiUuid: "uuid-1" });
  const t = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 32000 });
  assert.equal(t.ok, false);
  reiniciar({ status: "CANCELLED" });
  const c = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 32000 });
  assert.equal(c.ok, false);
  assert.equal(state.updates.length, 0);
});

test("con plan a plazos las mensualidades se recalculan: primero se AVISA, y solo con confirmación se guarda", async () => {
  reiniciar();
  state.condiciones = { modo: "plazos", metodo: null, enganche: 6000, numPagos: 12, frecuencia: "MONTHLY", primerPago: "2026-10-29" };
  const aviso = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 36000 });
  assert.equal(aviso.ok, true);
  if (aviso.ok === true) {
    assert.equal(aviso.data.estado, "avisar");
    if (aviso.data.estado === "avisar") assert.match(aviso.data.texto, /se recalcula/);
  }
  assert.equal(state.updates.length, 0, "sin confirmar no se toca la factura");

  const listo = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 36000, planAvisado: true });
  assert.deepEqual(listo, { ok: true, data: { estado: "guardado", total: 36000 } });
  const u = state.updates[0]!;
  assert.equal(u.datos.total, 36000);
  assert.equal(u.datos.balance, 24000, "saldo = nuevo total − lo pagado");
  assert.equal(u.datos.discount, 0);
  assert.equal((u.datos.items as unknown[]).length, 2, "subir el precio agrega la línea «Ajuste de precio»");
  // La regla se repite en el mismo UPDATE, con la clínica de la sesión.
  assert.equal(u.donde.clinicId, "clinic-1");
  assert.equal(u.donde.cfdiUuid, null);
  assert.deepEqual(u.donde.paid, { equals: 12000, lte: 36000 });
  assert.deepEqual(state.planUpdates[0]!.donde, { id: "caso-1", clinicId: "clinic-1" });
  assert.equal(state.planUpdates[0]!.datos.totalCostMxn, 36000);
  assert.equal(state.cierres, 2, "los links de pago y anticipos pedidos con el monto viejo se cierran");
});

test("bajar el costo sin bajar de lo pagado se guarda como descuento y deja un movimiento con el paciente", async () => {
  reiniciar();
  const r = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 27500 });
  assert.deepEqual(r, { ok: true, data: { estado: "guardado", total: 27500 } });
  assert.equal(state.updates[0]!.datos.discount, 2500);
  assert.equal(state.movimientos.length, 1);
  assert.equal(state.movimientos[0]!.patientId, "pac-1");
  assert.equal(state.movimientos[0]!.clinicId, "clinic-1");
  assert.match(String(state.movimientos[0]!.texto), /al cambiar el costo del caso de ortodoncia/);
});

test("si entra un cobro entre la lectura y el guardado, no se pisa (UPDATE con cifras viejas = 0 filas)", async () => {
  reiniciar();
  state.conteo = 0;
  const r = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 31000 });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.match(r.error, /cambió mientras la editabas/);
  assert.equal(state.planUpdates.length, 0, "el costo del caso no cambia si la factura no cambió");
});

test("sin factura, o en «Pago por control», el costo es la referencia del caso: no se toca ninguna factura", async () => {
  reiniciar();
  state.caso = { id: "caso-1", patientId: "pac-1", invoiceId: null };
  const a = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 36000 });
  assert.deepEqual(a, { ok: true, data: { estado: "guardado", total: 36000 } });
  assert.equal(state.updates.length, 0);
  assert.deepEqual(state.planUpdates[0]!.donde, { id: "caso-1", clinicId: "clinic-1" });

  reiniciar();
  state.modo = "PAGO_POR_CONTROL";
  const b = await llamar({ treatmentPlanId: "caso-1", nuevoTotal: 20000 });
  assert.equal(b.ok, true);
  assert.equal(state.updates.length, 0, "la factura de colocación no se edita con el costo de referencia");
  assert.equal(state.planUpdates[0]!.datos.totalCostMxn, 20000);
});
