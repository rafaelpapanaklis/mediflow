/**
 * Ortodoncia — la factura del caso se crea AL ABRIRLO (ws1-t10, 29-sep-2026).
 * Reglas del núcleo, con la base falsa: el plan sale con las condiciones correctas,
 * «Pago por control» factura la COLOCACIÓN, nunca se crea una segunda factura y el
 * cliente no decide el dinero.
 *
 * Run: npx tsx --test src/lib/orthodontics/cobro/__tests__/crear-plan-del-caso.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearPlanDelCasoCore, type CasoDelPlan, type DepsDelPlan, type FacturaNueva } from "../crear-plan-del-caso";
import type { PlanDePagoAlAbrir } from "../plan-al-abrir";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import type { OrthoBillingMode } from "../../billing-mode";

const CASO: CasoDelPlan = {
  id: "caso-1",
  patientId: "pac-1",
  invoiceId: null,
  technique: "METAL_BRACKETS",
  techniqueName: null,
  totalCostMxn: 36000,
  treatingDoctorId: "doc-1",
};

const PLAZOS: PlanDePagoAlAbrir = { modoDeCobro: "PRECIO_TOTAL", precioColocacion: null, enganche: 6000, numPagos: 15, primerPago: "2026-09-29" };
const CONTROL: PlanDePagoAlAbrir = { modoDeCobro: "PAGO_POR_CONTROL", precioColocacion: 4500, enganche: 0, numPagos: 0, primerPago: null };

interface Espia {
  facturas: FacturaNueva[];
  condiciones: Array<{ invoiceId: string; c: CondicionesPago }>;
  ligas: string[];
  consultasDeFactura: string[];
}

function fakes(o: {
  modo?: OrthoBillingMode;
  ligada?: { id: string; invoiceNumber: string | null; status: string } | null;
  esDoctor?: boolean;
  impuestos?: { taxRate: number; taxIncluded: boolean };
  anticipo?: number;
  condiciones?: { sinTabla: boolean; fallo: boolean };
  liga?: Awaited<ReturnType<DepsDelPlan["ligar"]>>;
  creaLanza?: boolean;
} = {}): { deps: DepsDelPlan; espia: Espia } {
  const espia: Espia = { facturas: [], condiciones: [], ligas: [], consultasDeFactura: [] };
  const deps: DepsDelPlan = {
    facturaLigada: async (id) => {
      espia.consultasDeFactura.push(id);
      return o.ligada ?? null;
    },
    modoDeCobro: async () => o.modo ?? "PRECIO_TOTAL",
    esDoctorDeLaClinica: async () => o.esDoctor ?? true,
    impuestosDeLaClinica: async () => o.impuestos ?? { taxRate: 0, taxIncluded: true },
    crearFactura: async (f) => {
      if (o.creaLanza) throw new Error("boom");
      espia.facturas.push(f);
      return { id: "fac-nueva", invoiceNumber: "MF-0042", total: f.total, anticipoAplicado: o.anticipo ?? 0 };
    },
    guardarCondiciones: async (invoiceId, c) => {
      espia.condiciones.push({ invoiceId, c });
      return o.condiciones ?? { sinTabla: false, fallo: false };
    },
    ligar: async (invoiceId) => {
      espia.ligas.push(invoiceId);
      return o.liga ?? { ok: true, invoiceId };
    },
  };
  return { deps, espia };
}

test("PRECIO TOTAL: crea la factura por el precio GUARDADO del caso, con enganche y pagos, y la liga al caso", async () => {
  const { deps, espia } = fakes();
  const r = await crearPlanDelCasoCore(deps, CASO, PLAZOS);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.invoiceId, "fac-nueva");
  assert.equal(r.invoiceNumber, "MF-0042");
  assert.equal(r.yaExistia, false);
  assert.equal(r.total, 36000);

  assert.equal(espia.facturas.length, 1);
  const f = espia.facturas[0]!;
  assert.equal(f.patientId, "pac-1", "el paciente del caso, no uno que mande el cliente");
  assert.equal(f.total, 36000);
  assert.equal(f.subtotal, 36000);
  assert.equal(f.doctorId, "doc-1", "el doctor tratante del caso");
  assert.equal(f.items.length, 1);
  assert.match(f.items[0]!.description, /^Tratamiento de ortodoncia \(/);
  assert.equal(f.items[0]!.unitPrice, 36000);

  // El trato: a plazos, mensual, con lo que se escribió en el popup.
  assert.deepEqual(espia.condiciones, [
    {
      invoiceId: "fac-nueva",
      c: { modo: "plazos", metodo: null, enganche: 6000, numPagos: 15, frecuencia: "MONTHLY", primerPago: "2026-09-29", difiereConSuBanco: false },
    },
  ]);
  assert.deepEqual(espia.ligas, ["fac-nueva"]);
  assert.equal(r.aviso, undefined);
});

test("PRECIO TOTAL: el importe NUNCA lo dicta el cliente — aunque mande otro precio, se factura el del caso", async () => {
  const { deps, espia } = fakes();
  await crearPlanDelCasoCore(deps, CASO, { ...PLAZOS, precioColocacion: 1 });
  assert.equal(espia.facturas[0]!.total, 36000);
  assert.equal(espia.facturas[0]!.items[0]!.unitPrice, 36000);
});

test("PAGO POR CONTROL: factura la COLOCACIÓN con el precio del popup, no el tratamiento; sin condiciones a plazos", async () => {
  const { deps, espia } = fakes({ modo: "PAGO_POR_CONTROL" });
  const r = await crearPlanDelCasoCore(deps, CASO, CONTROL);
  assert.equal(r.ok, true);
  const f = espia.facturas[0]!;
  assert.match(f.items[0]!.description, /^Colocación\/enganche — ortodoncia \(/);
  assert.equal(f.total, 4500, "la colocación, no los $36,000 del tratamiento");
  assert.equal(f.items[0]!.unitPrice, 4500);
  assert.deepEqual(espia.condiciones, [], "los controles se cobran uno por uno: no hay calendario que guardar");
  assert.deepEqual(espia.ligas, ["fac-nueva"]);
});

test("PAGO POR CONTROL: sin precio de colocación (o absurdo) no se crea nada", async () => {
  for (const precio of [null, 0, -5, 20_000_000, Number.NaN]) {
    const { deps, espia } = fakes({ modo: "PAGO_POR_CONTROL" });
    const r = await crearPlanDelCasoCore(deps, CASO, { ...CONTROL, precioColocacion: precio });
    assert.equal(r.ok, false, String(precio));
    assert.equal(espia.facturas.length, 0);
    assert.equal(espia.ligas.length, 0);
  }
});

test("SIN DUPLICAR: si el caso ya tiene una factura vigente, no se crea otra y se devuelve esa", async () => {
  for (const status of ["PENDING", "PARTIAL", "PAID"]) {
    const { deps, espia } = fakes({ ligada: { id: "fac-vieja", invoiceNumber: "MF-0001", status } });
    const r = await crearPlanDelCasoCore(deps, { ...CASO, invoiceId: "fac-vieja" }, PLAZOS);
    assert.equal(r.ok, true, status);
    if (!r.ok) continue;
    assert.equal(r.yaExistia, true);
    assert.equal(r.invoiceId, "fac-vieja");
    assert.equal(espia.facturas.length, 0, "ni una factura nueva");
    assert.equal(espia.condiciones.length, 0);
    assert.equal(espia.ligas.length, 0);
  }
});

test("SIN DUPLICAR: llamarlo dos veces seguidas (doble clic) crea UNA sola factura", async () => {
  const { deps, espia } = fakes();
  let ligada: { id: string; invoiceNumber: string | null; status: string } | null = null;
  const conEstado: DepsDelPlan = {
    ...deps,
    facturaLigada: async () => ligada,
    ligar: async (id) => {
      ligada = { id, invoiceNumber: "MF-0042", status: "PENDING" };
      return { ok: true, invoiceId: id };
    },
  };
  const caso = { ...CASO };
  const a = await crearPlanDelCasoCore(conEstado, caso, PLAZOS);
  // El segundo clic llega con el caso ya releído: ya trae la factura ligada.
  const b = await crearPlanDelCasoCore(conEstado, { ...caso, invoiceId: "fac-nueva" }, PLAZOS);
  assert.equal(a.ok && !a.yaExistia, true);
  assert.equal(b.ok && b.yaExistia, true);
  assert.equal(espia.facturas.length, 1);
});

test("una factura ligada CANCELADA (o que ya no existe) no cuenta: se crea la nueva, como en «Abrir plan de pago»", async () => {
  for (const ligada of [{ id: "fac-vieja", invoiceNumber: "MF-0001", status: "CANCELLED" }, null]) {
    const { deps, espia } = fakes({ ligada });
    const r = await crearPlanDelCasoCore(deps, { ...CASO, invoiceId: "fac-vieja" }, PLAZOS);
    assert.equal(r.ok, true);
    assert.equal(espia.facturas.length, 1);
    assert.deepEqual(espia.ligas, ["fac-nueva"]);
  }
});

test("si otra pestaña ya ligó su factura, se queda esa y se avisa (la liga ya sabe de duplicadas)", async () => {
  const { deps } = fakes({ liga: { ok: true, invoiceId: "fac-otra-pestana", aviso: "Este caso ya tenía su plan de pago abierto desde otra pestaña." } });
  const r = await crearPlanDelCasoCore(deps, CASO, PLAZOS);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.invoiceId, "fac-otra-pestana");
  assert.equal(r.invoiceNumber, null, "el número que se devolvería sería el de la otra factura");
  assert.match(r.aviso ?? "", /otra pestaña/);
});

test("el modo de cobro lo manda el GUARDADO: si el popup cree otro, no se crea una factura equivocada", async () => {
  const { deps, espia } = fakes({ modo: "PRECIO_TOTAL" });
  const r = await crearPlanDelCasoCore(deps, CASO, CONTROL);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /modo de cobro guardado/);
  assert.equal(espia.facturas.length, 0);
  const otra = fakes({ modo: "PAGO_POR_CONTROL" });
  assert.equal((await crearPlanDelCasoCore(otra.deps, CASO, PLAZOS)).ok, false);
  assert.equal(otra.espia.facturas.length, 0);
});

test("enganche igual o mayor que el total, o caso sin costo: no se crea nada", async () => {
  for (const enganche of [36000, 50000]) {
    const { deps, espia } = fakes();
    const r = await crearPlanDelCasoCore(deps, CASO, { ...PLAZOS, enganche });
    assert.equal(r.ok, false);
    assert.equal(espia.facturas.length, 0);
  }
  const sinCosto = fakes();
  assert.equal((await crearPlanDelCasoCore(sinCosto.deps, { ...CASO, totalCostMxn: 0 }, PLAZOS)).ok, false);
  assert.equal(sinCosto.espia.facturas.length, 0);
});

test("el doctor tratante solo se atribuye si es doctor de la clínica (la API de facturas rechaza a cualquier otro)", async () => {
  const noDoctor = fakes({ esDoctor: false });
  await crearPlanDelCasoCore(noDoctor.deps, CASO, PLAZOS);
  assert.equal(noDoctor.espia.facturas[0]!.doctorId, null);
  const sinDoctor = fakes();
  await crearPlanDelCasoCore(sinDoctor.deps, { ...CASO, treatingDoctorId: null }, PLAZOS);
  assert.equal(sinDoctor.espia.facturas[0]!.doctorId, null);
});

test("impuestos: se respeta la preferencia de la clínica (IVA incluido no cambia el total)", async () => {
  const { deps, espia } = fakes({ impuestos: { taxRate: 16, taxIncluded: true } });
  const r = await crearPlanDelCasoCore(deps, CASO, PLAZOS);
  assert.equal(r.ok, true);
  assert.equal(espia.facturas[0]!.taxRate, 16);
  assert.equal(espia.facturas[0]!.taxIncluded, true);
  assert.equal(espia.facturas[0]!.total, 36000);
});

test("si las condiciones no se pudieron guardar, la factura queda (creada y ligada) y se DICE", async () => {
  const sinTabla = fakes({ condiciones: { sinTabla: true, fallo: false } });
  const a = await crearPlanDelCasoCore(sinTabla.deps, CASO, PLAZOS);
  assert.equal(a.ok, true);
  assert.match(a.ok ? a.aviso ?? "" : "", /factura-condiciones-pago\.sql/);
  assert.deepEqual(sinTabla.espia.ligas, ["fac-nueva"]);

  const fallo = fakes({ condiciones: { sinTabla: false, fallo: true } });
  const b = await crearPlanDelCasoCore(fallo.deps, CASO, PLAZOS);
  assert.equal(b.ok, true);
  assert.match(b.ok ? b.aviso ?? "" : "", /no se guardaron/);
});

test("el saldo a favor que se descontó al crear también se dice", async () => {
  const { deps } = fakes({ anticipo: 1500 });
  const r = await crearPlanDelCasoCore(deps, CASO, PLAZOS);
  assert.match(r.ok ? r.aviso ?? "" : "", /\$1,500 de saldo a favor/);
});

test("si la factura no se pudo crear: error claro, nada guardado ni ligado", async () => {
  const { deps, espia } = fakes({ creaLanza: true });
  const r = await crearPlanDelCasoCore(deps, CASO, PLAZOS);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /No se pudo crear la factura/);
  assert.equal(espia.condiciones.length, 0);
  assert.equal(espia.ligas.length, 0);
});

test("si la factura se creó pero NO se pudo ligar, se dice cuál quedó suelta (para «Ya tengo la factura»)", async () => {
  const { deps } = fakes({ liga: { ok: false, error: "La factura no es de este paciente" } });
  const r = await crearPlanDelCasoCore(deps, CASO, PLAZOS);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /MF-0042/);
  assert.match(r.error, /no quedó ligada al caso/);
  assert.equal(r.facturaHuerfana, "fac-nueva");
});
