/**
 * DaleControl INSTITUCIONAL — PAGOS A MESES contra la base de datos.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client". La
 * aritmética (el reparto de centavos, las fechas, el estado derivado) vive
 * en pagos-core.ts; aquí solo hay consultas y escrituras.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LAS CUATRO REGLAS DE ESTE ARCHIVO
 *
 * 1. 🔴 EL SALDO DE UN PLAN NO EXISTE COMO COLUMNA. Se deriva de las
 *    mensualidades sin pago, y el saldo del COBRO se sigue derivando de
 *    los pagos reales (eduApplyEduPaymentInTx, compartido con caja.ts).
 *    Aquí no hay un solo número que alguien pueda teclear.
 *
 * 2. 🔴 PAGAR UNA MENSUALIDAD ES UN PAGO NORMAL. Mismo EduPayment, mismo
 *    método, mismo turno, mismo corte. Lo único extra es el enganche de la
 *    fila (paymentId) y, si fue la última, LIQUIDADO en la MISMA
 *    transacción. Ningún proceso aparte "cierra planes".
 *
 * 3. 🔴 EL MONTO NO VIENE DEL BODY. Se cobra EXACTAMENTE el amountCents
 *    congelado de la mensualidad. El body trae el método y la referencia;
 *    si trajera un monto, se ignora.
 *
 * 4. 🔴 institutionId SIEMPRE del contexto de sesión, alcance de
 *    visibility.ts (recurso "charges": lista blanca, todo o nada), y los
 *    permisos los comprueba el endpoint con eduApiGuard — aquí se
 *    comprueba PERTENENCIA y alcance, que es lo que un permiso no sabe.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId, eduOptionalText, eduSafeTimeZone, eduTodayISO } from "@/lib/edu/agenda-core";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import { eduSearchTokens } from "@/lib/edu/padron-core";
import { eduUserDisplayName } from "@/lib/edu-auth";
import {
  EDU_CAJA_MAX_ROWS,
  EDU_MAX_CHARGE_CENTS,
  eduMoney,
  parseEduMoneyCentsMax,
  parseEduPaymentMethod,
} from "@/lib/edu/dinero-core";
import { eduApplyEduPaymentInTx, getEduOpenCashSession } from "@/lib/edu/caja";
import {
  eduChargeScopeWhere,
  eduInstallmentScopeWhere,
  eduPaymentPlanScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  eduInstallmentStatus,
  eduPlanDueDates,
  eduPlanRequestFailed,
  eduPlanResumen,
  eduPlanSplitCents,
  parseEduPlanRequest,
  type EduInstallmentRow,
  type EduPlanFilters,
  type EduPlanRow,
  type EduPlanesPage,
} from "@/lib/edu/pagos-core";
import { EDU_CASH_METHOD, type EduPaymentMethod } from "@/lib/edu/types";

export { EduPadronError as EduPagosError };

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

/**
 * La puerta del dinero, la misma que la de caja.ts: un plan de pagos ES
 * dinero, y un alumno con "caja.view" encendido por error tiene que chocar
 * con esto igual.
 */
function requireDinero(ctx: EduClinicaContext): string {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduVisibility(ctx, "charges"))) {
    throw new EduPadronError("Tu rol no ve el dinero de la clínica.", 403);
  }
  return institutionId;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function persona(u: { firstName: string; lastName: string; email: string } | null | undefined): string {
  return u ? eduUserDisplayName(u) : "—";
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA FORMA DE UN PLAN
// ═══════════════════════════════════════════════════════════════════════

const PLAN_SELECT = {
  id: true,
  status: true,
  months: true,
  installmentCents: true,
  downPaymentCents: true,
  dueDay: true,
  createdAt: true,
  cancelledAt: true,
  cancelReason: true,
  settledAt: true,
  charge: { select: { id: true, folio: true, totalCents: true } },
  patient: { select: { id: true, firstName: true, lastName: true, folio: true } },
  createdBy: { select: { firstName: true, lastName: true, email: true } },
  cancelledBy: { select: { firstName: true, lastName: true, email: true } },
  installments: {
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      amountCents: true,
      dueDate: true,
      // Los datos de "cómo se pagó" salen del PAGO, no de columnas
      // copiadas: la mensualidad solo sabe QUÉ pago la liquidó.
      payment: {
        select: {
          paidAt: true,
          method: true,
          receivedBy: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  },
} satisfies Prisma.EduPaymentPlanSelect;

type PlanPayload = Prisma.EduPaymentPlanGetPayload<{ select: typeof PLAN_SELECT }>;

/**
 * 🔴 AQUÍ SE DERIVA TODO. El estado de cada mensualidad sale del
 * calendario (eduInstallmentStatus, contra el hoy del INSTITUTO) y los
 * números del plan salen de sus mensualidades (eduPlanResumen). Ninguna
 * pantalla recibe un saldo guardado.
 */
function toPlanRow(p: PlanPayload, todayISO: string): EduPlanRow {
  const installments: EduInstallmentRow[] = p.installments.map((i) => {
    const dueDateISO = i.dueDate.toISOString().slice(0, 10);
    const paidAt = i.payment?.paidAt ?? null;
    return {
      id: i.id,
      number: i.number,
      amountCents: i.amountCents,
      dueDateISO,
      status: eduInstallmentStatus({ paidAt, dueDateISO }, todayISO),
      paidAt: iso(paidAt),
      method: i.payment?.method ?? null,
      receivedByName: i.payment ? persona(i.payment.receivedBy) : null,
    };
  });

  return {
    id: p.id,
    status: p.status,
    chargeId: p.charge.id,
    chargeFolio: p.charge.folio,
    patientId: p.patient.id,
    patientName: eduPatientFullName(p.patient),
    patientFolio: p.patient.folio,
    months: p.months,
    installmentCents: p.installmentCents,
    downPaymentCents: p.downPaymentCents,
    dueDay: p.dueDay,
    chargeTotalCents: p.charge.totalCents,
    ...eduPlanResumen(installments),
    createdByName: persona(p.createdBy),
    createdAt: p.createdAt.toISOString(),
    cancelledAt: iso(p.cancelledAt),
    cancelledByName: p.cancelledBy ? persona(p.cancelledBy) : null,
    cancelReason: p.cancelReason,
    settledAt: iso(p.settledAt),
    installments,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LECTURAS
//
// Todas reciben la zona del INSTITUTO (ctx.institution.timezone, la pasa
// el endpoint) porque el estado VENCIDA se deriva contra el hoy de la
// escuela: a las 23:30 de México, un "hoy" en UTC ya va en mañana y
// marcaría vencido lo que aún no vence.
// ═══════════════════════════════════════════════════════════════════════

export async function listEduPlanes(
  ctx: EduClinicaContext,
  timeZoneCrudo: string,
  filters: EduPlanFilters,
  now: Date = new Date(),
): Promise<EduPlanesPage> {
  const institutionId = requireDinero(ctx);
  const todayISO = eduTodayISO(eduSafeTimeZone(timeZoneCrudo), now);

  const where = eduPaymentPlanScopeWhere({
    institutionId,
    scope: eduVisibility(ctx, "charges"),
  });
  const and: Prisma.EduPaymentPlanWhereInput[] = [];
  if (filters.status) and.push({ status: filters.status });
  // El mismo troceador y el mismo índice sin acentos que los demás
  // buscadores del vertical: "maria rodriguez" encuentra a María
  // Rodríguez. El folio del COBRO se compara contra su columna, que es
  // ASCII por construcción.
  for (const token of eduSearchTokens(filters.q)) {
    and.push({
      OR: [
        { charge: { folio: { contains: token, mode: "insensitive" } } },
        { patient: { searchIndex: { contains: token } } },
      ],
    });
  }
  if (and.length > 0) where.AND = and;

  const rows = await prisma.eduPaymentPlan.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: EDU_CAJA_MAX_ROWS + 1,
    select: PLAN_SELECT,
  });

  return {
    rows: rows.slice(0, EDU_CAJA_MAX_ROWS).map((p) => toPlanRow(p, todayISO)),
    truncated: rows.length > EDU_CAJA_MAX_ROWS,
    todayISO,
  };
}

/** Los planes de UN paciente (su ficha), más recientes primero. */
export async function listEduPatientPlanes(
  ctx: EduClinicaContext,
  timeZoneCrudo: string,
  patientId: string,
  now: Date = new Date(),
): Promise<EduPlanesPage> {
  const institutionId = requireDinero(ctx);
  const todayISO = eduTodayISO(eduSafeTimeZone(timeZoneCrudo), now);
  const id = eduCleanId(patientId);
  if (!id) return { rows: [], truncated: false, todayISO };

  const rows = await prisma.eduPaymentPlan.findMany({
    where: {
      ...eduPaymentPlanScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      patientId: id,
    },
    orderBy: [{ createdAt: "desc" }],
    take: EDU_CAJA_MAX_ROWS,
    select: PLAN_SELECT,
  });
  return { rows: rows.map((p) => toPlanRow(p, todayISO)), truncated: false, todayISO };
}

/**
 * Un plan, SI le toca a quien pregunta. La fila se busca con el `where`
 * del alcance: un plan de otra escuela se ve igual que uno que no existe.
 */
export async function getEduPlan(
  ctx: EduClinicaContext,
  timeZoneCrudo: string,
  planId: string,
  now: Date = new Date(),
): Promise<EduPlanRow | null> {
  const institutionId = requireDinero(ctx);
  const todayISO = eduTodayISO(eduSafeTimeZone(timeZoneCrudo), now);
  const id = eduCleanId(planId);
  if (!id) return null;

  const p = await prisma.eduPaymentPlan.findFirst({
    where: {
      ...eduPaymentPlanScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      id,
    },
    select: PLAN_SELECT,
  });
  return p ? toPlanRow(p, todayISO) : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · CREAR EL PLAN
// ═══════════════════════════════════════════════════════════════════════

export interface EduPlanCreateInput {
  months?: unknown;
  dueDay?: unknown;
  /**
   * El enganche, opcional, que se cobra EN EL MOMENTO como un pago normal
   * (con su método, su turno y su corte). Lo que se difiere a meses es lo
   * que queda DESPUÉS de él.
   */
  enganche?: unknown;
}

interface EngancheValidado {
  method: EduPaymentMethod;
  amountCents: number;
  reference: string | null;
  notes: string | null;
}

function parseEnganche(raw: unknown): EngancheValidado | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new EduPadronError("El enganche no es válido.");
  }
  const r = raw as Record<string, unknown>;
  const method = r.method === undefined ? EDU_CASH_METHOD : parseEduPaymentMethod(r.method);
  if (!method) throw new EduPadronError("Ese método de pago no existe.");
  const amountCents = parseEduMoneyCentsMax(r.amountCents, EDU_MAX_CHARGE_CENTS);
  if (amountCents === null) throw new EduPadronError("El enganche no es una cantidad válida.");
  if (amountCents <= 0) throw new EduPadronError("El enganche tiene que ser mayor que cero.");
  return {
    method,
    amountCents,
    reference: eduOptionalText(r.reference, 80) ?? null,
    notes: eduOptionalText(r.notes, 300) ?? null,
  };
}

/**
 * 🔴 ARMA EL PLAN: parte el saldo del cobro en N mensualidades ENTERAS.
 *
 * Los centavos no se pierden ni se inventan: eduPlanSplitCents reparte el
 * piso de la división y la diferencia ENTERA va en la PRIMERA mensualidad
 * ($1,000.00 entre 3 = $333.34 + $333.33 + $333.33). La primera SIEMPRE
 * vence el mes siguiente, el día de corte (recortado al mes que lo
 * aguante: corte 31 vence el 28 en febrero).
 *
 * Todo va en UNA transacción — el candado de "un solo plan ACTIVO por
 * cobro", la foto del saldo, el enganche y las mensualidades — porque un
 * fallo a la mitad dejaría un enganche cobrado sin plan, o un plan cuyo
 * calendario no suma el saldo.
 */
export async function createEduPaymentPlan(
  ctx: EduClinicaContext,
  chargeId: string,
  input: EduPlanCreateInput,
  options: { timeZone: string },
  now: Date = new Date(),
): Promise<{
  id: string;
  chargeFolio: string;
  months: number;
  installmentCents: number;
  firstCents: number;
}> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(chargeId);
  if (!id) throw new EduPadronError("Ese cobro no es válido.", 400);

  const pedido = parseEduPlanRequest(input);
  // La guarda y no `!pedido.ok`: con strict:false el booleano no estrecha.
  if (eduPlanRequestFailed(pedido)) throw new EduPadronError(pedido.error, 400);
  const { months } = pedido.plan;
  const enganche = parseEnganche(input.enganche);

  const cobro = await prisma.eduCharge.findFirst({
    where: {
      ...eduChargeScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      id,
    },
    select: { id: true, folio: true, patientId: true, totalCents: true, paidCents: true, status: true },
  });
  if (!cobro) throw new EduPadronError("Ese cobro no es de este instituto.", 404);
  if (cobro.status === "CANCELLED") {
    throw new EduPadronError("Un cobro cancelado no se difiere: no se le debe nada a nadie.", 409);
  }

  const saldo = Math.max(0, cobro.totalCents - cobro.paidCents);
  if (saldo <= 0) {
    throw new EduPadronError("Ese cobro ya está liquidado: no hay nada que diferir.", 409);
  }
  if (enganche && enganche.amountCents >= saldo) {
    throw new EduPadronError(
      `El enganche (${eduMoney(enganche.amountCents)}) no puede ser el saldo completo (${eduMoney(saldo)}): eso es liquidar el cobro, no diferirlo.`,
    );
  }
  const restanteEstimado = saldo - (enganche?.amountCents ?? 0);
  if (restanteEstimado < months) {
    throw new EduPadronError(
      `Con ${eduMoney(restanteEstimado)} por diferir no alcanza ni un centavo por mensualidad en ${months} meses. Baja los meses o el enganche.`,
    );
  }

  // El "hoy" y el día de corte, en la zona del INSTITUTO. Sin dueDay
  // pedido, el corte es el día del mes de HOY: "cada día 28" si el plan
  // se armó un 28.
  const startISO = eduTodayISO(eduSafeTimeZone(options.timeZone), now);
  const dueDay = pedido.plan.dueDay ?? Number(startISO.slice(8, 10));
  const fechas = eduPlanDueDates(startISO, dueDay, months);
  if (!fechas) throw new EduPadronError("No se pudieron calcular las fechas del plan.", 400);

  const sesion = enganche ? await getEduOpenCashSession(ctx) : null;

  const creado = await prisma.$transaction(async (tx) => {
    // 1 · UN solo plan ACTIVO por cobro. Dentro de la transacción, como el
    //     único turno de caja abierto: la ventana de carrera queda en
    //     milisegundos y, si algún día pasa, se ve como dos planes activos
    //     y se cancela uno.
    const activo = await tx.eduPaymentPlan.findFirst({
      where: { institutionId, chargeId: id, status: "ACTIVO" },
      select: { id: true },
    });
    if (activo) {
      throw new EduPadronError(
        "Ese cobro ya tiene un plan de pagos activo. Cancélalo antes de armar otro.",
        409,
      );
    }

    // 2 · La FOTO del cobro se reclama: el reparto de abajo se calculó con
    //     el saldo leído fuera de la transacción, y si otro pago entró en
    //     medio, ese saldo ya no existe. El update condicional toma además
    //     el candado de la fila para el resto de la transacción.
    const foto = await tx.eduCharge.updateMany({
      where: {
        id,
        institutionId,
        status: { not: "CANCELLED" },
        totalCents: cobro.totalCents,
        paidCents: cobro.paidCents,
      },
      data: { updatedAt: now },
    });
    if (foto.count === 0) {
      throw new EduPadronError(
        "Ese cobro cambió mientras armabas el plan (entró otro movimiento). Recarga y vuelve a intentarlo.",
        409,
      );
    }

    // 3 · El enganche, si hay: un pago NORMAL, por el único camino que
    //     toca paidCents. Entra al turno abierto y a su corte, como
    //     cualquier dinero del mostrador.
    let restante = saldo;
    if (enganche) {
      const aplicado = await eduApplyEduPaymentInTx(tx, {
        institutionId,
        chargeId: id,
        method: enganche.method,
        amountCents: enganche.amountCents,
        isRefund: false,
        reference: enganche.reference,
        notes: enganche.notes,
        paidAt: now,
        receivedByUserId: ctx.eduUserId,
        cashSessionId: sesion?.id ?? null,
      });
      restante = aplicado.balanceCents;
    }

    // 4 · 🔴 EL REPARTO. Enteros cuya suma es EXACTAMENTE el restante; la
    //     diferencia de la división va COMPLETA en la primera.
    const montos = eduPlanSplitCents(restante, months);
    if (!montos) {
      throw new EduPadronError(
        `Con ${eduMoney(restante)} por diferir no alcanza ni un centavo por mensualidad en ${months} meses.`,
      );
    }

    // 5 · El plan y su calendario. `installmentCents` es la mensualidad
    //     PAREJA (la última siempre lo es); `downPaymentCents` es lo que
    //     el cobro tenía pagado al nacer el plan, enganche incluido.
    const plan = await tx.eduPaymentPlan.create({
      data: {
        institutionId,
        chargeId: id,
        patientId: cobro.patientId,
        status: "ACTIVO",
        months,
        installmentCents: montos[montos.length - 1],
        downPaymentCents: cobro.totalCents - restante,
        dueDay,
        createdByUserId: ctx.eduUserId,
        createdAt: now,
      },
      select: { id: true },
    });

    await tx.eduInstallment.createMany({
      data: montos.map((amountCents, i) => ({
        institutionId,
        planId: plan.id,
        number: i + 1,
        amountCents,
        // Fecha de calendario a medianoche UTC, como las del contrato.
        dueDate: new Date(`${fechas[i]}T00:00:00.000Z`),
      })),
    });

    return { id: plan.id, montos };
  });

  return {
    id: creado.id,
    chargeFolio: cobro.folio,
    months,
    installmentCents: creado.montos[creado.montos.length - 1],
    firstCents: creado.montos[0],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · COBRAR UNA MENSUALIDAD
// ═══════════════════════════════════════════════════════════════════════

export interface EduInstallmentPayInput {
  method?: unknown;
  reference?: unknown;
  notes?: unknown;
}

/**
 * 🔴 Registra el pago de UNA mensualidad: un EduPayment normal por
 * EXACTAMENTE su monto congelado, la fila enganchada a ese pago, y — si
 * fue la última — el plan LIQUIDADO, todo en la MISMA transacción.
 *
 * Se cobran EN ORDEN (la más vieja sin pagar primero). No es un capricho:
 * pagada la 3 con la 1 vencida, "al corriente" y "vencida" serían las dos
 * verdad a la vez, y la primera es la que carga los centavos del residuo.
 * El paciente que trae dinero para dos meses son dos pagos.
 */
export async function payEduInstallment(
  ctx: EduClinicaContext,
  installmentId: string,
  input: EduInstallmentPayInput,
  now: Date = new Date(),
): Promise<{
  paymentId: string;
  number: number;
  months: number;
  amountCents: number;
  chargeFolio: string;
  chargeStatus: string;
  balanceCents: number;
  planSettled: boolean;
}> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(installmentId);
  if (!id) throw new EduPadronError("Esa mensualidad no es válida.", 400);

  const fila = await prisma.eduInstallment.findFirst({
    where: {
      ...eduInstallmentScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      id,
    },
    select: {
      id: true,
      number: true,
      amountCents: true,
      paymentId: true,
      plan: {
        select: {
          id: true,
          status: true,
          chargeId: true,
          months: true,
          charge: { select: { folio: true } },
        },
      },
    },
  });
  if (!fila) throw new EduPadronError("Esa mensualidad no es de este instituto.", 404);
  if (fila.plan.status === "CANCELADO") {
    throw new EduPadronError(
      "Esa mensualidad es de un plan cancelado: por aquí ya no se cobra. El saldo del cobro se cobra normal, desde su recibo.",
      409,
    );
  }
  if (fila.plan.status !== "ACTIVO") {
    throw new EduPadronError("Ese plan ya está liquidado.", 409);
  }
  if (fila.paymentId) throw new EduPadronError("Esa mensualidad ya está pagada.", 409);

  const siguiente = await prisma.eduInstallment.findFirst({
    where: { institutionId, planId: fila.plan.id, paymentId: null },
    orderBy: { number: "asc" },
    select: { id: true, number: true },
  });
  if (!siguiente || siguiente.id !== fila.id) {
    throw new EduPadronError(
      `Las mensualidades se cobran en orden: toca la ${siguiente?.number ?? 1} de ${fila.plan.months}.`,
      409,
    );
  }

  const method = input.method === undefined ? EDU_CASH_METHOD : parseEduPaymentMethod(input.method);
  if (!method) throw new EduPadronError("Ese método de pago no existe.");
  const reference = eduOptionalText(input.reference, 80) ?? null;
  const notes = eduOptionalText(input.notes, 300) ?? null;

  const sesion = await getEduOpenCashSession(ctx);

  const resultado = await prisma.$transaction(async (tx) => {
    // El pago, por el ÚNICO camino que recalcula el cobro. 🔴 El monto es
    // el congelado de la fila: nadie lo tecleó.
    const aplicado = await eduApplyEduPaymentInTx(tx, {
      institutionId,
      chargeId: fila.plan.chargeId,
      method,
      amountCents: fila.amountCents,
      isRefund: false,
      reference,
      notes,
      paidAt: now,
      receivedByUserId: ctx.eduUserId,
      cashSessionId: sesion?.id ?? null,
    });

    // 🔴 La mensualidad se RECLAMA: solo se engancha si SIGUE sin pago y
    // su plan sigue activo. Si otra caja la cobró hace un instante, esto
    // devuelve 0, la transacción entera se revierte y el pago de arriba
    // nunca existió.
    const link = await tx.eduInstallment.updateMany({
      where: { id: fila.id, institutionId, paymentId: null, plan: { status: "ACTIVO" } },
      data: { paymentId: aplicado.paymentId },
    });
    if (link.count === 0) {
      throw new EduPadronError(
        "Esa mensualidad se estaba cobrando en otra caja (o el plan cambió). Recarga la pantalla.",
        409,
      );
    }

    // ¿Era la última? LIQUIDADO aquí mismo, no en un proceso aparte.
    const sinPagar = await tx.eduInstallment.count({
      where: { institutionId, planId: fila.plan.id, paymentId: null },
    });
    if (sinPagar === 0) {
      await tx.eduPaymentPlan.updateMany({
        where: { id: fila.plan.id, institutionId, status: "ACTIVO" },
        data: { status: "LIQUIDADO", settledAt: now },
      });
    }

    return {
      paymentId: aplicado.paymentId,
      chargeStatus: aplicado.status,
      balanceCents: aplicado.balanceCents,
      planSettled: sinPagar === 0,
    };
  });

  return {
    ...resultado,
    number: fila.number,
    months: fila.plan.months,
    amountCents: fila.amountCents,
    chargeFolio: fila.plan.charge.folio,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · CANCELAR EL PLAN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cancela un plan ACTIVO, con autor y motivo.
 *
 * Lo ya pagado SE QUEDA pagado: son EduPayment reales que están en su
 * corte. Lo que muere es el calendario — las mensualidades sin pagar dejan
 * de deberse como mensualidades, y el saldo del cobro (que nunca dejó de
 * derivarse de los pagos) vuelve a cobrarse normal, o a diferirse en un
 * plan nuevo.
 *
 * El permiso (caja.refund) lo exige el endpoint: cancelar un calendario de
 * cobro es deshacer dinero comprometido, el mismo nivel de confianza que
 * devolverlo.
 */
export async function cancelEduPaymentPlan(
  ctx: EduClinicaContext,
  planId: string,
  input: { reason?: unknown } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(planId);
  if (!id) throw new EduPadronError("Ese plan no es válido.", 400);

  const plan = await prisma.eduPaymentPlan.findFirst({
    where: {
      ...eduPaymentPlanScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      id,
    },
    select: { id: true, status: true },
  });
  if (!plan) throw new EduPadronError("Ese plan no es de este instituto.", 404);
  if (plan.status === "CANCELADO") throw new EduPadronError("Ese plan ya está cancelado.", 409);
  if (plan.status === "LIQUIDADO") {
    throw new EduPadronError("Ese plan ya está liquidado: no hay nada que cancelar.", 409);
  }

  // Condicionado a que SIGA activo: si la última mensualidad se pagó (o
  // alguien lo canceló) entre la lectura y esta línea, no se pisa.
  const res = await prisma.eduPaymentPlan.updateMany({
    where: { id, institutionId, status: "ACTIVO" },
    data: {
      status: "CANCELADO",
      cancelledAt: now,
      cancelledByUserId: ctx.eduUserId,
      cancelReason: eduOptionalText(input.reason, 300) ?? null,
    },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Ese plan cambió mientras lo cancelabas (se liquidó o ya estaba cancelado). Recarga la pantalla.",
      409,
    );
  }
  return { id };
}
