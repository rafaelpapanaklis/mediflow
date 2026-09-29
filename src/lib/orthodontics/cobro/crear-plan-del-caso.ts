// Ortodoncia — crear el plan de pago del caso RECIÉN ABIERTO (ws1-t10, 29-sep-2026).
// Sin Prisma ni Next: la base entra por `deps`, así los tests prueban las reglas
// (una sola factura por caso, colocación en «Pago por control», condiciones
// acotadas) con fakes. La acción `crearPlanDelCaso` conecta las dependencias reales.
//
// Es la MISMA factura que antes armaba «Abrir plan de pago» a mano:
//   · el borrador es `borradorInicialDelCaso` (concepto, precio, doctor tratante);
//   · las cuentas son las de POST /api/invoices (`computeInvoiceTotal`);
//   · el trato (enganche, pagos, primer pago) se guarda como en PUT /condiciones;
//   · se liga con `abrirPlanDePago`, que ya sabe de dos pestañas y de duplicadas.
//
// Ninguna lectura del cliente decide dinero: el precio del tratamiento sale del
// caso guardado, el modo de cobro del guardado, y el enganche se acota contra el
// total de la factura. Solo el precio de la colocación (editable a propósito) y
// las condiciones vienen del popup.

import { computeInvoiceTotal, sumInvoiceItems } from "@/lib/invoice-totals";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import type { OrthoBillingMode } from "../billing-mode";
import { borradorInicialDelCaso, type CasoParaBorrador } from "./borrador-factura";
import { MAX_COSTO_TOTAL } from "../alta-caso-formulario";
import { condicionesDelPlan, pesos, type PlanDePagoAlAbrir } from "./plan-al-abrir";

export interface CasoDelPlan extends CasoParaBorrador {
  id: string;
  patientId: string;
  /** La factura que el caso ya tiene ligada (puede estar cancelada). */
  invoiceId: string | null;
}

/** Lo que la acción sabe hacer contra la base. Todo con la clínica de la sesión ya resuelta. */
export interface DepsDelPlan {
  /** La factura ligada al caso, si existe en ESTA clínica. */
  facturaLigada(invoiceId: string): Promise<{ id: string; invoiceNumber: string | null; status: string } | null>;
  /** El modo de cobro GUARDADO del caso. */
  modoDeCobro(): Promise<OrthoBillingMode>;
  /** ¿Es un doctor de esta clínica? (la factura solo atribuye a doctores) */
  esDoctorDeLaClinica(userId: string): Promise<boolean>;
  impuestosDeLaClinica(): Promise<{ taxRate: number; taxIncluded: boolean }>;
  crearFactura(f: FacturaNueva): Promise<{ id: string; invoiceNumber: string | null; total: number; anticipoAplicado: number }>;
  /** Guarda el trato de la factura. `sinTabla`/`fallo` = la factura existe pero el trato no quedó. */
  guardarCondiciones(invoiceId: string, c: CondicionesPago): Promise<{ sinTabla: boolean; fallo: boolean }>;
  /** Liga la factura al caso (`abrirPlanDePago`). */
  ligar(invoiceId: string): Promise<{ ok: true; invoiceId: string; aviso?: string } | { ok: false; error: string }>;
}

export interface FacturaNueva {
  patientId: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; discount?: number; total: number }>;
  subtotal: number;
  discount: number;
  total: number;
  notes: string;
  doctorId: string | null;
  taxRate: number;
  taxIncluded: boolean;
}

export type ResultadoDelPlan =
  | { ok: true; invoiceId: string; invoiceNumber: string | null; total: number; yaExistia: boolean; aviso?: string }
  | { ok: false; error: string; /** La factura sí se creó pero no quedó ligada (para decirlo). */ facturaHuerfana?: string | null };

/**
 * Crea la factura del caso con las condiciones del popup y la liga. Idempotente por caso:
 * si el caso ya tiene una factura vigente NO crea otra y devuelve esa.
 */
export async function crearPlanDelCasoCore(deps: DepsDelPlan, caso: CasoDelPlan, plan: PlanDePagoAlAbrir): Promise<ResultadoDelPlan> {
  // 1. Sin duplicar: una factura vigente ya ligada (doble clic, reintento, otra pestaña) gana.
  if (caso.invoiceId) {
    const ligada = await deps.facturaLigada(caso.invoiceId);
    if (ligada && ligada.status !== "CANCELLED") {
      return { ok: true, invoiceId: ligada.id, invoiceNumber: ligada.invoiceNumber, total: 0, yaExistia: true };
    }
  }

  // 2. El modo lo manda el guardado; si el popup cree otro, no se crea una factura equivocada.
  const modo = await deps.modoDeCobro();
  if (plan.modoDeCobro !== modo) {
    return {
      ok: false,
      error: "El modo de cobro guardado del caso no coincide con el que elegiste. El caso quedó abierto: arma su plan de pago desde Cobro.",
    };
  }
  const esPorControl = modo === "PAGO_POR_CONTROL";

  // 3. El precio: colocación (editable, del popup) o el del caso (guardado). Nunca $0.
  const precioColocacion = plan.precioColocacion;
  if (esPorControl && !(typeof precioColocacion === "number" && precioColocacion > 0 && precioColocacion <= MAX_COSTO_TOTAL)) {
    return { ok: false, error: "Falta el precio de la colocación (mayor que cero)." };
  }
  if (!esPorControl && !(caso.totalCostMxn > 0)) {
    return { ok: false, error: "El caso no tiene costo total: no hay qué cobrar." };
  }

  const borrador = borradorInicialDelCaso(caso, esPorControl, precioColocacion);
  const items = borrador.items.map((it) => ({
    description: String(it.name),
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    ...(it.discount > 0 ? { discount: it.discount } : {}),
    total: Math.round((it.quantity * it.unitPrice - (it.discount || 0)) * 100) / 100,
  }));
  const subtotal = sumInvoiceItems(items);
  const { taxRate, taxIncluded } = await deps.impuestosDeLaClinica();
  const { total } = computeInvoiceTotal(items, 0, taxRate, taxIncluded);

  // 4. Las condiciones (solo «Precio total»): el enganche se acota contra el total de la factura.
  let condiciones: CondicionesPago | null = null;
  if (!esPorControl) {
    if (plan.enganche >= total) return { ok: false, error: "El enganche tiene que ser menor al costo total." };
    condiciones = condicionesDelPlan(plan, total);
  }

  // 5. Doctor tratante solo si es un doctor de la clínica (la API de facturas rechaza cualquier otro).
  const doctorId = caso.treatingDoctorId && (await deps.esDoctorDeLaClinica(caso.treatingDoctorId)) ? caso.treatingDoctorId : null;

  let creada: Awaited<ReturnType<DepsDelPlan["crearFactura"]>>;
  try {
    creada = await deps.crearFactura({
      patientId: caso.patientId,
      items,
      subtotal,
      discount: 0,
      total,
      notes: "",
      doctorId,
      taxRate,
      taxIncluded,
    });
  } catch (e) {
    console.error("[ortho plan-al-abrir] no se pudo crear la factura:", e);
    return { ok: false, error: "No se pudo crear la factura del tratamiento." };
  }

  const avisos: string[] = [];
  if (creada.anticipoAplicado > 0) {
    avisos.push(`Se descontaron ${pesos(creada.anticipoAplicado)} de saldo a favor del paciente en la factura.`);
  }

  // 6. El trato. Si no se guardó, la factura ya existe: se dice, no se esconde.
  if (condiciones) {
    const g = await deps.guardarCondiciones(creada.id, condiciones);
    if (g.sinTabla) {
      avisos.push("El enganche y las mensualidades no se guardaron: a esta instalación le falta el SQL sql/factura-condiciones-pago.sql. La factura sí quedó creada y ligada.");
    } else if (g.fallo) {
      avisos.push("El enganche y las mensualidades no se guardaron (la base no respondió). La factura sí quedó creada: edita su forma de pago desde Facturación.");
    }
  }

  // 7. Ligar al caso. Si otra pestaña ganó, `ligar` devuelve la vigente + aviso.
  const liga = await deps.ligar(creada.id);
  if (liga.ok === false) {
    return {
      ok: false,
      error: `La factura ${creada.invoiceNumber ?? ""} se creó pero no quedó ligada al caso: ${liga.error}`.replace("  ", " "),
      facturaHuerfana: creada.id,
    };
  }
  if (liga.aviso) avisos.push(liga.aviso);

  return {
    ok: true,
    invoiceId: liga.invoiceId,
    invoiceNumber: liga.invoiceId === creada.id ? creada.invoiceNumber : null,
    total,
    yaExistia: false,
    ...(avisos.length > 0 ? { aviso: avisos.join(" ") } : {}),
  };
}
