// ═══════════════════════════════════════════════════════════════════════════
// SALDO A FAVOR EN ORTODONCIA (ws1-t4) — el I/O. Las reglas puras están en
// `adelanto-core.ts` (reparto del adelanto) y en `src/lib/patient-credit-core.ts`
// (cuánto saldo cabe en una factura).
//
// Tres cosas, siempre sobre una factura de un caso de ortodoncia (fuera de
// ortodoncia nada de esto se ofrece, y el cobro se queda como estaba):
//
//   1. `infoDeSaldoOrto` — ¿esta factura es de un caso? ¿cuánto tiene a favor
//      el paciente (la MISMA cifra que su resumen)? ¿se puede usar aquí? y las
//      demás facturas del caso por cobrar, para enseñar a dónde va un adelanto.
//
//   2. `usarSaldoAFavorAlCobrar` — «Usar saldo a favor» al cobrar: es el
//      camino YA existente (`aplicarSaldoAFavor`, patient-credit-aplicar.ts:
//      un Payment «anticipo» + su fila negativa en patient_credits, bajo el
//      candado del paciente), con origen «cobro» y el tope de lo que se cobra.
//      No es un cobro nuevo: no entra dinero al cajón (Caja no lo suma como
//      efectivo) y la factura muestra el abono como «Anticipo (saldo a favor)».
//
//   3. `cobrarConAdelanto` — el paciente paga MÁS que el saldo de la factura:
//      en UNA transacción, con las facturas del caso bloqueadas (FOR UPDATE,
//      en orden de id: sin abrazos mortales con otro cobro), cada factura
//      recibe su parte como un Payment con el método REAL (el dinero sí entró:
//      Caja lo cuenta una vez, en el día y el método en que se cobró). Lo que
//      sobra después de saldar todo lo pendiente del caso queda a favor del
//      paciente: un Payment «refund» por esa cantidad en la factura cobrada
//      (lo pagado de la factura nunca pasa de su total) + una fila POSITIVA
//      `excedente_de_cobro` en patient_credits. Es el mismo movimiento que ya
//      hace «dejar a favor» una cita cancelada: el efectivo del cajón cuadra
//      (entró todo), el excedente sale como «reembolso» (no es ingreso) y
//      vuelve a contar el día que se use, como «Anticipo (saldo a favor)».
//
// Aislamiento: `clinicId` sale de la sesión (la ruta), va en cada where; sin
// él no se consulta nada.
// ═══════════════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/invoice-totals";
import { getPatientCreditBalance } from "@/lib/patient-credit";
import { aplicarSaldoAFavor, type ResultadoAplicacion } from "@/lib/patient-credit-aplicar";
import { FUENTE_EXCEDENTE, motivoParaNoAplicar } from "@/lib/patient-credit-core";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { cobranzaDelCasoUnificada } from "../cobranza-caso";
import { normalizarOrthoBillingMode, type OrthoBillingMode } from "../billing-mode";
import { cargarCargosDeControlDelCaso, vencimientoDeFacturaPrincipal } from "../cobranza-controles-db";
import { cargarModoDeCobro } from "../billing-mode-db";
import { repartirCobro, vencimientoPorFactura, type FacturaDelCaso, type RepartoDelCobro } from "./adelanto-core";

type Tx = Prisma.TransactionClient;
type Db = Pick<typeof prisma, "$transaction">;

/** Estados en los que una factura del caso todavía se cobra. */
const COBRABLES = new Set(["PENDING", "PARTIAL", "OVERDUE"]);

export interface CasoDeLaFactura {
  planId: string;
  patientId: string;
  modo: OrthoBillingMode;
  /** La factura principal del caso (plan a plazos, pago único o colocación). */
  facturaPrincipalId: string | null;
}

function faltaColumna(e: any): boolean {
  const code = e?.code ?? e?.meta?.code;
  return code === "P2021" || code === "P2022" || code === "P2010" || code === "42703" || /orthodonticTreatmentPlanId/.test(String(e?.message ?? ""));
}

/**
 * El caso de ortodoncia al que pertenece una factura: la principal del caso
 * (`orthodontic_treatment_plans.invoiceId`) o una ligada a él
 * (`invoices.orthodonticTreatmentPlanId`: controles y extras). `null` = no es
 * de ortodoncia (o el SQL de la columna aún no está: entonces solo la principal).
 */
export async function casoDeLaFactura(clinicId: string, invoiceId: string): Promise<CasoDeLaFactura | null> {
  if (!clinicId || !invoiceId) return null;
  // `billingMode` no está en el modelo de Prisma a propósito (schema.prisma): va por SQL crudo.
  const select = { id: true, patientId: true, invoiceId: true } as const;
  let plan = await prisma.orthodonticTreatmentPlan.findFirst({ where: { clinicId, invoiceId }, select });
  if (!plan) {
    try {
      const filas = await prisma.$queryRaw<Array<{ planId: string | null }>>`
        SELECT "orthodonticTreatmentPlanId" AS "planId" FROM "invoices"
         WHERE "id" = ${invoiceId} AND "clinicId" = ${clinicId} LIMIT 1`;
      const planId = filas[0]?.planId ?? null;
      if (planId) plan = await prisma.orthodonticTreatmentPlan.findFirst({ where: { id: planId, clinicId }, select });
    } catch (e) {
      if (!faltaColumna(e)) throw e;
    }
  }
  if (!plan) return null;
  return {
    planId: plan.id,
    patientId: plan.patientId,
    modo: normalizarOrthoBillingMode(await cargarModoDeCobro(clinicId, plan.id)),
    facturaPrincipalId: plan.invoiceId ?? null,
  };
}

/**
 * Las facturas del caso que reciben un adelanto: la principal y, en «Pago por
 * control», los controles ya facturados — con lo que les falta y la fecha de
 * su cuota pendiente más vieja (la misma cuenta que Cobranza y la ficha:
 * `cobranzaDelCasoUnificada`). Las saldadas no salen.
 */
export async function facturasPorCobrarDelCaso(
  clinicId: string,
  caso: CasoDeLaFactura,
  ahora: Date = new Date(),
): Promise<FacturaDelCaso[]> {
  const [clinica, principal, cargos] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }),
    caso.facturaPrincipalId
      ? prisma.invoice.findFirst({
          where: { id: caso.facturaPrincipalId, clinicId },
          select: { id: true, invoiceNumber: true, total: true, paid: true, status: true, dueDate: true, createdAt: true },
        })
      : Promise.resolve(null),
    caso.modo === "PAGO_POR_CONTROL" ? cargarCargosDeControlDelCaso(clinicId, caso.planId) : Promise.resolve([]),
  ]);
  const zona = clinica?.timezone || "America/Mexico_City";
  const vigente = principal && principal.status !== "CANCELLED" && principal.status !== "DRAFT" ? principal : null;
  let condiciones: CondicionesPago | null = null;
  if (vigente) {
    const { porFactura } = await leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds: [vigente.id] });
    condiciones = porFactura.get(vigente.id) ?? null;
  }
  const cobranza = cobranzaDelCasoUnificada({
    modo: caso.modo,
    facturaPrincipal: vigente
      ? {
          condiciones,
          totalFactura: vigente.total,
          cobros: [],
          pagado: vigente.paid,
          invoiceId: vigente.id,
          vencimiento: vencimientoDeFacturaPrincipal(caso.modo, vigente.dueDate, vigente.createdAt, zona),
        }
      : null,
    cargosControl: cargos,
    saldoAFavorPrevio: 0,
    ahora,
    zonaHoraria: zona,
  });
  const fechas = vencimientoPorFactura([...(cobranza?.vencidas ?? []), ...(cobranza?.proximas ?? [])], vigente?.id ?? null);

  const salida: FacturaDelCaso[] = [];
  if (vigente && COBRABLES.has(vigente.status)) {
    const falta = round2(vigente.total - vigente.paid);
    if (falta > 0) salida.push({ invoiceId: vigente.id, invoiceNumber: vigente.invoiceNumber, falta, vencimiento: fechas.get(vigente.id) ?? null });
  }
  for (const c of cargos) {
    if (!COBRABLES.has(c.status) || c.invoiceId === vigente?.id) continue;
    const falta = round2(c.total - c.pagado);
    if (falta > 0) salida.push({ invoiceId: c.invoiceId, invoiceNumber: c.invoiceNumber, falta, vencimiento: fechas.get(c.invoiceId) ?? c.vencimiento ?? null });
  }
  return salida;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Lo que la ventana de cobro necesita saber
// ═══════════════════════════════════════════════════════════════════════════

export interface InfoDeSaldoOrto {
  /** `null` = la factura no es de un caso de ortodoncia: la ventana de cobro no cambia. */
  caso: { planId: string; modo: OrthoBillingMode } | null;
  /** Saldo a favor del paciente (su libro), la cifra de su resumen. */
  saldoAFavor: number;
  /** Por qué no se puede usar el saldo en ESTA factura (null = se puede). */
  motivoParaNoUsar: string | null;
  /** Las OTRAS facturas del caso por cobrar (a dónde iría un adelanto). */
  otras: FacturaDelCaso[];
}

export async function infoDeSaldoOrto(clinicId: string, invoiceId: string): Promise<InfoDeSaldoOrto> {
  const nada: InfoDeSaldoOrto = { caso: null, saldoAFavor: 0, motivoParaNoUsar: null, otras: [] };
  const caso = await casoDeLaFactura(clinicId, invoiceId);
  if (!caso) return nada;
  const [inv, saldo, porCobrar] = await Promise.all([
    prisma.invoice.findFirst({
      where: { id: invoiceId, clinicId },
      select: { id: true, patientId: true, total: true, paid: true, status: true, cfdiUuid: true, createdAt: true },
    }),
    getPatientCreditBalance(clinicId, caso.patientId),
    facturasPorCobrarDelCaso(clinicId, caso),
  ]);
  if (!inv) return nada;
  const saldoAFavor = Math.max(0, round2(saldo));
  let motivo = motivoParaNoAplicar(inv, "cobro");
  if (!motivo && inv.patientId !== caso.patientId) motivo = "la factura es de otro paciente";
  if (!motivo && !(saldoAFavor > 0)) motivo = "sin saldo a favor";
  if (!motivo && !(round2(inv.total - inv.paid) > 0)) motivo = "la factura no tiene saldo pendiente";
  return {
    caso: { planId: caso.planId, modo: caso.modo },
    saldoAFavor,
    motivoParaNoUsar: motivo,
    otras: porCobrar.filter((f) => f.invoiceId !== invoiceId),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. «Usar saldo a favor» al cobrar
// ═══════════════════════════════════════════════════════════════════════════

export async function usarSaldoAFavorAlCobrar(args: {
  clinicId: string;
  invoiceId: string;
  userId: string;
  /** Lo que se está cobrando (el monto tecleado). Sin él, lo que quepa en la factura. */
  tope: number | null;
  /** Lo pagado que veía la pantalla (idempotencia: ver `aplicarSaldoAFavor`). */
  paidVisto: number;
}): Promise<ResultadoAplicacion & { casoPlanId: string | null }> {
  const caso = await casoDeLaFactura(args.clinicId, args.invoiceId);
  if (!caso) return { aplicado: 0, restanteAFavor: null, factura: null, motivo: "la factura no es de un caso de ortodoncia", casoPlanId: null };
  const r = await aplicarSaldoAFavor({
    clinicId: args.clinicId,
    invoiceId: args.invoiceId,
    userId: args.userId,
    origen: "cobro",
    tope: args.tope,
    paidVisto: args.paidVisto,
  });
  return { ...r, casoPlanId: caso.planId };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Cobro con adelanto
// ═══════════════════════════════════════════════════════════════════════════

export interface ArgsCobroConAdelanto {
  clinicId: string;
  userId: string;
  /** La factura que se está cobrando. */
  invoiceId: string;
  /** El paciente del caso: toda factura tocada tiene que ser suya. */
  patientId: string;
  /** Las demás facturas del caso por cobrar (su fecha decide el orden). */
  otras: FacturaDelCaso[];
  amount: number;
  method: string;
  paidAt: Date;
  reference?: string | null;
  notes?: string | null;
  /** Aviso de «efectivo sin caja abierta» (lo calcula la ruta, como el cobro normal). */
  avisoDeCaja?: string | null;
}

export interface FacturaTocada {
  invoiceId: string;
  invoiceNumber: string;
  monto: number;
  antes: { paid: number; balance: number; status: string };
  despues: { paid: number; balance: number; status: string };
}

export type ResultadoCobroConAdelanto =
  | { ok: true; reparto: RepartoDelCobro; facturas: FacturaTocada[]; aFavor: number }
  | { ok: false; error: string; status: number };

function notaDelPago(base: string, args: ArgsCobroConAdelanto): string {
  const partes = [base];
  if (args.notes) partes.push(args.notes);
  if (args.avisoDeCaja) partes.push(`⚠️ ${args.avisoDeCaja}`);
  return partes.join(" · ");
}

/**
 * Registra el cobro repartido. NUNCA escribe a medias: todo en una
 * transacción; si algo falla, no queda ni un Payment.
 */
export async function cobrarConAdelanto(args: ArgsCobroConAdelanto, db: Db = prisma): Promise<ResultadoCobroConAdelanto> {
  if (!args.clinicId || !args.invoiceId || !args.patientId) return { ok: false, error: "Faltan datos", status: 400 };
  const monto = round2(Number(args.amount));
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: "El monto debe ser mayor a 0", status: 400 };

  // Varias facturas, dos o tres escrituras cada una: más que los 5 s por defecto.
  return db.$transaction(async (tx) => ejecutarEnTx(tx, { ...args, amount: monto }), { timeout: 15_000, maxWait: 5_000 });
}

async function ejecutarEnTx(tx: Tx, args: ArgsCobroConAdelanto): Promise<ResultadoCobroConAdelanto> {
  const { clinicId } = args;
  const ids = Array.from(new Set([args.invoiceId, ...args.otras.map((o) => o.invoiceId)])).sort();
  // El mismo candado de fila que el cobro normal, mark-paid, el reembolso y
  // /cancel; todas a la vez y en orden de id.
  await tx.$queryRaw`SELECT id FROM invoices WHERE id IN (${Prisma.join(ids)}) AND "clinicId" = ${clinicId} ORDER BY id FOR UPDATE`;
  const filas = await tx.invoice.findMany({
    where: { id: { in: ids }, clinicId },
    select: { id: true, invoiceNumber: true, patientId: true, total: true, paid: true, balance: true, status: true },
  });
  const porId = new Map(filas.map((f) => [f.id, f]));
  const cobrada = porId.get(args.invoiceId);
  if (!cobrada) return { ok: false, error: "Not found", status: 404 };
  if (cobrada.status === "DRAFT") return { ok: false, error: "Confirma la factura antes de registrar pagos", status: 400 };
  if (cobrada.status === "CANCELLED") return { ok: false, error: "Esta factura está cancelada", status: 400 };
  if (cobrada.patientId !== args.patientId) return { ok: false, error: "La factura no es de este caso", status: 400 };
  const faltaCobrada = round2(cobrada.total - cobrada.paid);
  if (!(faltaCobrada > 0)) return { ok: false, error: "Esta factura ya no tiene saldo pendiente", status: 400 };

  // Lo que les falta HOY (releído bajo candado), no lo que se vio en pantalla.
  const otras: FacturaDelCaso[] = [];
  for (const o of args.otras) {
    const f = porId.get(o.invoiceId);
    if (!f || f.id === cobrada.id || f.patientId !== args.patientId || !COBRABLES.has(f.status)) continue;
    const falta = round2(f.total - f.paid);
    if (falta > 0) otras.push({ invoiceId: f.id, invoiceNumber: f.invoiceNumber, falta, vencimiento: o.vencimiento });
  }
  const reparto = repartirCobro(
    args.amount,
    { invoiceId: cobrada.id, invoiceNumber: cobrada.invoiceNumber, falta: faltaCobrada, vencimiento: null },
    otras,
  );

  const facturas: FacturaTocada[] = [];
  for (const parte of reparto.partes) {
    const f = porId.get(parte.invoiceId)!;
    // Cada factura, SOLO su parte (un Payment por factura, con el método
    // real). Lo que queda a favor va en su propio Payment, más abajo: así el
    // CFDI por pago de esta factura nunca incluye dinero que no es suyo.
    const nota = parte.esLaCobrada
      ? reparto.excedente > 0
        ? `Cobro de ${args.amount.toFixed(2)} con adelanto: ${reparto.excedente.toFixed(2)} de más sobre esta factura` +
          (reparto.partes.length > 1 ? ` (a las siguientes del caso)` : "") +
          (reparto.aFavor > 0 ? ` · ${reparto.aFavor.toFixed(2)} queda a favor del paciente` : "")
        : "Cobro"
      : `Adelanto: parte del cobro registrado en la factura ${cobrada.invoiceNumber}`;
    await tx.payment.create({
      data: {
        invoiceId: f.id,
        amount: parte.monto,
        method: args.method,
        reference: args.reference ?? null,
        notes: notaDelPago(nota, args),
        paidAt: args.paidAt,
      },
      select: { id: true },
    });
    const paid = round2(f.paid + parte.monto);
    const balance = round2(f.total - paid);
    const status = balance <= 0 ? "PAID" : "PARTIAL";
    await tx.invoice.updateMany({
      where: { id: f.id, clinicId },
      data: {
        paid,
        balance: Math.max(0, balance),
        status: status as any,
        ...(status === "PAID" ? { paidAt: args.paidAt } : {}),
        paymentMethod: args.method,
      },
    });
    facturas.push({
      invoiceId: f.id,
      invoiceNumber: f.invoiceNumber,
      monto: parte.monto,
      antes: { paid: f.paid, balance: f.balance, status: f.status },
      despues: { paid, balance: Math.max(0, balance), status },
    });
  }

  if (reparto.aFavor > 0) {
    // Lo que sobra: el dinero SÍ entró (Payment con el método real: el arqueo
    // de Caja cuadra con el cajón) y en el mismo instante sale de la factura
    // (Payment «refund», que no es ingreso) hacia el libro del paciente. Mismo
    // par que «dejar a favor» una cita cancelada. `paid` no se toca: arriba
    // se sumó solo la parte de la factura. La fila del libro apunta al Payment
    // del excedente: /api/payments/[id]/cfdi no lo deja timbrar (se factura
    // cuando el saldo se use, como «Anticipo (saldo a favor)»).
    const excedente = await tx.payment.create({
      data: {
        invoiceId: cobrada.id,
        amount: reparto.aFavor,
        method: args.method,
        reference: args.reference ?? null,
        notes: notaDelPago(`Excedente del cobro: pasa al saldo a favor del paciente`, args),
        paidAt: args.paidAt,
      },
      select: { id: true },
    });
    await tx.payment.create({
      data: {
        invoiceId: cobrada.id,
        amount: reparto.aFavor,
        method: "refund",
        notes: `Excedente del cobro: pasa al saldo a favor del paciente (no sale dinero de caja).`,
        paidAt: args.paidAt,
      },
    });
    await tx.patientCredit.create({
      data: {
        clinicId,
        patientId: args.patientId,
        amount: reparto.aFavor,
        source: FUENTE_EXCEDENTE,
        invoiceId: cobrada.id,
        paymentId: excedente.id,
        createdById: args.userId,
        creditDate: args.paidAt,
        description:
          `Pagado de más al cobrar la factura ${cobrada.invoiceNumber}, después de saldar lo pendiente del caso de ortodoncia`,
      },
    });
  }

  return { ok: true, reparto, facturas, aFavor: reparto.aFavor };
}
