// «Cobrar hoy» (ws1-t4, ticket 3 de BEVADENT, 8d) — las cuentas de la hoja, PURAS.
//
// La hoja junta en un paso lo que hoy son dos ventanas: crear la nota (POST
// /api/invoices, el MISMO cuerpo que «Nueva factura») y registrar el pago (POST
// /api/invoices/:id, el MISMO que «Registrar pago»). No hay otra contabilidad: la
// nota y el pago son los de siempre, con su folio, su bitácora y su corte de Caja.
//
// Aquí vive lo que la pantalla enseña ANTES de guardar (total, pago, saldo que queda)
// para que sea exactamente lo que el servidor va a guardar: el total sale de
// `computeInvoiceTotal` con los impuestos por defecto de la clínica, igual que el POST.
//
// Sin Prisma ni red: lo usan la hoja y sus pruebas.

import { clinicInvoiceTaxDefaults, computeInvoiceTotal, round2 } from "@/lib/invoice-totals";

export interface ConceptoCobroHoy {
  nombre: string;
  /** Importe del concepto (cantidad 1), en pesos. */
  importe: number;
  /** Del tarifario, si salió de ahí. Solo informa: la nota guarda el nombre y el precio. */
  procedureId?: string | null;
}

export interface ProcedimientoDelCatalogo {
  id: string;
  name: string;
  basePrice: number;
}

/** Lo que impide guardar, en el orden en que se le dice al usuario. */
export type FaltaCobroHoy =
  | "sin_conceptos"
  | "concepto_sin_nombre"
  | "importe_invalido"
  | "total_cero"
  | "pago_invalido"
  | "pago_mayor";

export interface ResumenCobroHoy {
  total: number;
  pago: number;
  /** Lo que queda por cobrar de ESTA nota después del pago de hoy. */
  saldoQueda: number;
  falta: FaltaCobroHoy | null;
}

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/** Los conceptos tal como viajan en `items` de POST /api/invoices (cantidad 1, sin descuento). */
export function itemsDeCobroHoy(conceptos: ConceptoCobroHoy[]) {
  return conceptos.map((c) => {
    const importe = round2(Math.max(0, numero(c.importe) || 0));
    // C-40: el procedimiento del catálogo viaja con el concepto (clave SAT e IVA del CFDI).
    return { description: String(c.nombre ?? "").trim(), ...(c.procedureId ? { procedureId: c.procedureId } : {}), quantity: 1, unitPrice: importe, total: importe };
  });
}

/**
 * Total, pago y saldo que queda — lo que se enseña en vivo. `pago` vacío o 0 es
 * válido: crea el cargo sin pago (queda todo por cobrar). Más que el total no: el
 * sobrante no tiene a qué factura ir (para eso está el anticipo).
 */
export function resumenCobroHoy(input: {
  conceptos: ConceptoCobroHoy[];
  pago: number | string | null | undefined;
  clinicTaxMode?: string | null;
}): ResumenCobroHoy {
  const { taxRate, taxIncluded } = clinicInvoiceTaxDefaults(input.clinicTaxMode);
  const items = itemsDeCobroHoy(input.conceptos);
  const total = round2(computeInvoiceTotal(items, 0, taxRate, taxIncluded).total);
  const pagoCrudo = input.pago === "" || input.pago === null || input.pago === undefined ? 0 : numero(input.pago);
  const pago = Number.isFinite(pagoCrudo) ? round2(pagoCrudo) : 0;
  const saldoQueda = round2(Math.max(0, total - pago));

  let falta: FaltaCobroHoy | null = null;
  if (input.conceptos.length === 0) falta = "sin_conceptos";
  else if (input.conceptos.some((c) => !String(c.nombre ?? "").trim())) falta = "concepto_sin_nombre";
  else if (input.conceptos.some((c) => !(numero(c.importe) >= 0))) falta = "importe_invalido";
  else if (!(total > 0)) falta = "total_cero";
  else if (!Number.isFinite(pagoCrudo) || pagoCrudo < 0) falta = "pago_invalido";
  else if (pago > total + 0.005) falta = "pago_mayor";
  return { total, pago, saldoQueda, falta };
}

/** Cuerpo de POST /api/invoices: el de «Nueva factura» con los impuestos por defecto de la clínica. */
export function cuerpoNotaCobroHoy(input: {
  patientId: string;
  appointmentId?: string | null;
  conceptos: ConceptoCobroHoy[];
  clinicTaxMode?: string | null;
  /** Hoy se registra un pago tras crearla: el servidor exige "billing.charge" ANTES de crear. */
  conPagoHoy?: boolean;
  /**
   * Auditoría de uso C-07: el doctor elegido en la hoja. Texto = ese doctor; `null` =
   * «Sin asignar» elegido a mano; ausente = que el servidor lo herede con la regla de
   * siempre (cita, citas de hoy, plan, cabecera — lib/invoices/doctor-de-factura).
   */
  doctorId?: string | null;
  /**
   * La persona confirmó que es OTRO procedimiento, no el del plan: POST /api/invoices deja crear
   * la nota aunque la cita tenga filas del plan agendadas (sin esto contesta 409 `cita_del_plan`).
   */
  fueraDelPlan?: boolean;
}) {
  const { taxRate, taxIncluded } = clinicInvoiceTaxDefaults(input.clinicTaxMode);
  return {
    patientId: input.patientId,
    ...(input.appointmentId ? { appointmentId: input.appointmentId } : {}),
    items: itemsDeCobroHoy(input.conceptos),
    discount: 0,
    taxRate,
    taxIncluded,
    ...(input.conPagoHoy ? { conPagoHoy: true as const } : {}),
    ...(input.doctorId !== undefined ? { doctorId: input.doctorId } : {}),
    ...(input.fueraDelPlan === true ? { fueraDelPlan: true as const } : {}),
  };
}

/**
 * Permiso que POST /api/invoices pide ADEMÁS de "billing.create". Con `conPagoHoy` la
 * nota se crea para cobrarla en el acto: quien no puede registrar el pago
 * ("billing.charge", p. ej. un doctor) recibe el 403 antes de que nazca la nota, en vez
 * de dejar una nota PENDIENTE huérfana y el 403 en el segundo paso (revisión ws1-t1, 1).
 */
export function permisoExtraParaCrearNota(body: unknown): "billing.charge" | null {
  return body && typeof body === "object" && (body as { conPagoHoy?: unknown }).conPagoHoy === true
    ? "billing.charge"
    : null;
}

/**
 * Lo que la hoja enseña y cobra. Sin "billing.charge" no hay pago: solo se crea el
 * cargo (queda todo por cobrar, para quien sí cobra). Con él, mientras no se toque el
 * monto, «paga hoy» sigue al total.
 */
export function vistaCobroHoy(input: {
  conceptos: ConceptoCobroHoy[];
  puedeCobrar: boolean;
  pagoTocado: boolean;
  pago: number | string | null | undefined;
  clinicTaxMode?: string | null;
}): ResumenCobroHoy {
  const { conceptos, clinicTaxMode } = input;
  if (!input.puedeCobrar) return resumenCobroHoy({ conceptos, pago: 0, clinicTaxMode });
  if (input.pagoTocado) return resumenCobroHoy({ conceptos, pago: input.pago, clinicTaxMode });
  const { total } = resumenCobroHoy({ conceptos, pago: 0, clinicTaxMode });
  return resumenCobroHoy({ conceptos, pago: total, clinicTaxMode });
}

/**
 * Al crearse, la nota puede recibir el saldo a favor del paciente (anticipo) y nacer
 * con MENOS saldo que su total. Lo tecleado se cobra hasta ese saldo, nunca de más.
 */
export function pagoTrasCrear(pagoPedido: number, saldoDeLaNota: number): { monto: number; recortado: boolean } {
  const saldo = round2(Math.max(0, Number(saldoDeLaNota) || 0));
  const pedido = round2(Math.max(0, Number(pagoPedido) || 0));
  return pedido > saldo + 0.005 ? { monto: saldo, recortado: true } : { monto: pedido, recortado: false };
}

function normaliza(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Concepto con que nace la hoja abierta desde una cita: el procedimiento del tarifario
 * cuyo nombre es el motivo de la cita (sin importar mayúsculas ni acentos), con su
 * precio; si no hay uno así, el motivo como texto y el importe vacío para que la
 * recepción lo escriba.
 *
 * F5 de la tercera auditoría (resto de N-09): los motivos de la agenda son cortos
 * («Limpieza») y el tarifario dice «Limpieza dental». Se acepta también el ÚNICO
 * procedimiento cuyo nombre empieza con el motivo en palabras completas (o al revés).
 * Si hay dos o más candidatos («Limpieza dental» y «Limpieza profunda»), no se elige:
 * nunca se adivina entre parecidos.
 */
export function conceptoDeLaCita(
  motivo: string | null | undefined,
  catalogo: ProcedimientoDelCatalogo[],
): ConceptoCobroHoy | null {
  const m = normaliza(String(motivo ?? ""));
  if (!m) return null;
  const igual = catalogo.find((p) => normaliza(p.name) === m);
  if (igual) return { nombre: igual.name, importe: round2(Number(igual.basePrice) || 0), procedureId: igual.id };
  const candidatos = catalogo.filter((p) => {
    const n = normaliza(p.name);
    return !!n && (n.startsWith(`${m} `) || m.startsWith(`${n} `));
  });
  if (candidatos.length === 1) {
    const unico = candidatos[0];
    return { nombre: unico.name, importe: round2(Number(unico.basePrice) || 0), procedureId: unico.id };
  }
  return { nombre: String(motivo).trim().slice(0, 200), importe: NaN, procedureId: null };
}

/** Notas del paciente que ya estaban por cobrar (no son las de hoy): se enlazan, no se mezclan. */
export function pendientesPrevios(
  facturas: Array<{ id?: string; status?: string | null; balance?: number | null }>,
  /**
   * v7 (QA de t12): `invoiceId` → lo que aún no se debe de su saldo (por hacer del plan, por vencer de
   * ortodoncia). Sin esto, el aviso decía «$2,050.50 por cobrar» de un plan aceptado sin hacer.
   */
  aunNoSeDebe: Record<string, number> = {},
): { cuantas: number; saldo: number } {
  const queSeDebe = (f: { id?: string; balance?: number | null }) =>
    round2(Number(f.balance ?? 0) - (f.id ? Number(aunNoSeDebe[f.id] ?? 0) : 0));
  const vivas = facturas.filter(
    (f) => ["PENDING", "PARTIAL", "OVERDUE", "DRAFT"].includes(String(f.status ?? "")) && queSeDebe(f) > 0,
  );
  return { cuantas: vivas.length, saldo: round2(vivas.reduce((s, f) => s + queSeDebe(f), 0)) };
}

/**
 * «Cobrar hoy» de un paciente con plan de tratamiento (ws1-t12 · P6): lo de hoy es un ABONO a la
 * nota de cobro del plan (decisión de Rafael, 20-oct-2026), no una nota nueva. El pago va a las
 * notas del plan que siguen por cobrar, de la más vieja a la más nueva, por POST /api/invoices/:id
 * («Registrar pago» de siempre: su folio de pago, su bitácora y su corte de Caja). Nunca más de lo
 * que deben: el sobrante no tiene a qué nota ir (para eso está el anticipo).
 */
export interface NotaDelPlanPorCobrar {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  total: number;
  paid: number;
  /** Para el orden: la más vieja recibe primero. */
  createdAt: string | Date;
}

export interface AbonoAlPlan {
  reparto: Array<{ invoiceId: string; invoiceNumber: string; monto: number }>;
  /** Lo que se abona en total (≤ lo pedido). */
  abonado: number;
  /** Lo que deben las notas del plan antes del abono. */
  debe: number;
  /** Lo que sigue debiendo el plan después. */
  saldoQueda: number;
  falta: "sin_nota" | "pago_invalido" | "pago_mayor" | null;
}

export function abonoAlPlan(notas: NotaDelPlanPorCobrar[], pagoPedido: number | string | null | undefined): AbonoAlPlan {
  const abiertas = notas
    .filter((n) => ["PENDING", "PARTIAL", "OVERDUE"].includes(String(n.status)) && round2((Number(n.total) || 0) - (Number(n.paid) || 0)) > 0)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const debe = round2(abiertas.reduce((s, n) => s + round2((Number(n.total) || 0) - (Number(n.paid) || 0)), 0));
  const crudo = pagoPedido === "" || pagoPedido == null ? 0 : numero(pagoPedido);
  const vacio = { reparto: [], abonado: 0, debe, saldoQueda: debe };
  if (abiertas.length === 0) return { ...vacio, falta: "sin_nota" };
  if (!Number.isFinite(crudo) || crudo <= 0) return { ...vacio, falta: "pago_invalido" };
  const pedido = round2(crudo);
  if (pedido > debe + 0.005) return { ...vacio, falta: "pago_mayor" };
  let resta = pedido;
  const reparto: AbonoAlPlan["reparto"] = [];
  for (const n of abiertas) {
    if (resta <= 0) break;
    const monto = round2(Math.min(resta, round2((Number(n.total) || 0) - (Number(n.paid) || 0))));
    if (monto <= 0) continue;
    reparto.push({ invoiceId: n.invoiceId, invoiceNumber: n.invoiceNumber, monto });
    resta = round2(resta - monto);
  }
  const abonado = round2(pedido - resta);
  return { reparto, abonado, debe, saldoQueda: round2(Math.max(0, debe - abonado)), falta: null };
}
